# backend_app/app/routers/projects.py
from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Response
from pydantic import BaseModel, Field

from deps import bearer_token
from crud import SupaRest  # ← あなたの PostgREST クライアント

# このファイル内のルートは"route/api/v1/projects"から始まるように設定（main.pyでv1まで指定）
router = APIRouter(prefix="/projects", tags=["projects"])

# ==================================================
## 型定義
# ==================================================


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    overview: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    overview: Optional[str] = None


class Project(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    overview: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ==================================================
## CRUD 定義
# ==================================================


@router.get("", response_model=List[Project])
async def list_projects(token: str = Depends(bearer_token)):
    client = SupaRest(token)
    # 自分のプロジェクトのみ（RLSで自動的に絞られる前提）
    params = {"select": "*", "order": "created_at.desc"}
    try:
        return await client.get("projects", params=params)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"list_priojects failed: {e}")


@router.post(
    "",
    response_model=Project,
    status_code=status.HTTP_201_CREATED,
    summary="Create a project for the current user (RPC)",
)
async def create_project(
    payload: ProjectCreate,
    token: str = Depends(bearer_token),
):
    """
    app.create_project(name, overview) を呼び出して新規作成。
    - user_id は送らない（DB/RPC が auth.uid() を使ってセット）
    - RLS と完全整合（WITH CHECK user_id = auth.uid()）
    """
    client = SupaRest(token)

    # RPCを呼び出してプロジェクトを作成
    # Supabase の REST 仕様: /rest/v1/rpc/<function_name>
    try:
        created = await client.post(
            "rpc/create_project",
            json={"name": payload.name, "overview": payload.overview},
        )
    except Exception as e:
        # PostgREST が返すエラーを適切にラップ（必要に応じて分岐）
        raise HTTPException(status_code=400, detail=str(e))
    # RPC は 1 行（projects 型）を返す設計
    return created


@router.patch("/{project_id}", response_model=Project)
async def update_project(
    project_id: UUID, payload: ProjectUpdate, token: str = Depends(bearer_token)
):
    client = SupaRest(token)
    body = payload.model_dump(exclude_none=True)  # 更新に必要なデータを辞書型に変換
    if not body:
        raise HTTPException(status_code=400, detail="no updatable fields")
    params = {"id": f"eq.{project_id}"}  # 更新先のデータの形式変換
    try:
        # patchメソッドを発行
        rows = await client.patch(
            "projects", params=params, json=body, prefer="return=representation"
        )
        if isinstance(rows, list) and rows:
            return rows[0]
        raise HTTPException(status_code=404, detail="project not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"update_project failed: {e}")


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: UUID, token: str = Depends(bearer_token)):
    client = SupaRest(token)
    params = {"id": f"eq.{project_id}"}  # 更新先のデータの形式変換
    try:
        # 返り値の行は不要：204で本文なしにする
        await client.delete("projects", params=params)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as e:
        # すでに削除済み / 見つからない等は冪等 DELETE として 204 を返す
        msg = str(e).lower()
        if any(
            k in msg
            for k in ["not found", "no row", "already delete", "does not exist"]
        ):
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        raise HTTPException(status_code=400, detail=f"delete_project failed: {e}")
