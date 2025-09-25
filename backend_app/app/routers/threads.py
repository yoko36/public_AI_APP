from fastapi import APIRouter, Depends, Query, HTTPException, Response, status
from pydantic import BaseModel, Field
from typing import Optional
from uuid import uuid4

from crud import SupaRest
from deps import bearer_token

# このファイル内のルートは"route/api/v1/threads"から始まるようにする
router = APIRouter(prefix="/threads", tags=["threads"])


# ==================================================
## 型定義
# ==================================================
class ThreadCreate(BaseModel):
    # フロントは camelCase で送ってくる
    id: Optional[str] = Field(None, description="Client-assigned UUID (optional)")
    projectId: str = Field(..., description="Project UUID")
    name: str = Field(..., min_length=1, description="Thread name")


class ThreadUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1)


# ==================================================
## CRUD 定義
# ==================================================


@router.get("", include_in_schema=False)
async def list_threads(
    projectId: str = Query(..., alias="projectId"),  # 取得先のプロジェクトを指定
    token: str = Depends(bearer_token),
):
    client = SupaRest(token)
    params = {
        "select": "id,name,project_id,created_at,updated_at",
        "project_id": f"eq.{projectId}",
        "order": "created_at.asc",
    }
    try:
        return await client.get("threads", params=params)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"list_threads failed: {e}")


@router.post("", status_code=201)
async def create_thread(payload: ThreadCreate, token: str = Depends(bearer_token)):
    client = SupaRest(token)

    tid = payload.id or str(
        uuid4()
    )  # 受け取ったデータ(payload)の中にidがない場合はランダムなUUIDを作成
    safe_name = (
        payload.name or ""
    ).strip() or "新しいチャット"  # チャット(スレッド)に名前が記入されていないときに「新しいチャット」という名前で追加する
    body = {
        "id": tid,
        "project_id": payload.projectId,
        "name": safe_name,
    }  # リクエストボディを作成

    try:
        rows = await client.post(
            "threads",
            json=body,
            prefer="return=representation",
        )
        if isinstance(rows, list) and rows:
            return rows[0]
        raise HTTPException(status_code=500, detail="created but row not found")

    except HTTPException as e:
        # ← PostgREST からのエラーがここに入る（status_code/detail を必ず表示）
        raise
    except Exception as e:
        # ← それ以外の例外も握りつぶさず 400 で返す
        raise HTTPException(status_code=400, detail=f"create_thread failed: {e}")


@router.patch("/{thread_id}")
async def rename_thread(
    thread_id: str, payload: ThreadUpdate, token: str = Depends(bearer_token)
):
    client = SupaRest(token)
    params = {"id": f"eq.{thread_id}"}
    try:
        rows = await client.patch(
            "threads",
            params=params,
            json=payload.model_dump(exclude_none=True),
            prefer="return=representation",
        )
        return rows[0] if isinstance(rows, list) and rows else None
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"rename_thread failed: {e}")


@router.delete("/{thread_id}", status_code=204)
async def delete_thread(thread_id: str, token: str = Depends(bearer_token)):
    client = SupaRest(token)
    params = {"id": f"eq.{thread_id}"}
    try:
        # 返り値の行は不要：204で本文なしにする
        await client.delete("threads", params=params)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as e:
        # すでに削除済み / 見つからない等は冪等 DELETE として 204 を返す
        msg = str(e).lower()
        if any(
            s in msg
            for s in ["not found", "no row", "already delete", "does not exist"]
        ):
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        raise HTTPException(status_code=400, detail=f"delete_thread failed: {e}")
