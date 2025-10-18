# api/v1/files.py
from __future__ import annotations

from typing import Optional, Any, Dict
from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Path,
    Query,
    Request,
    status,
)
from pydantic import BaseModel, Field
from crud import SupaRest  # ← 提示された crud.py を同じ階層に置く想定

router = APIRouter(tags=["files"])


# ========= Pydantic Schemas =========
class FileCreate(BaseModel):
    storage_path: str
    mime: str
    size: int
    title: Optional[str] = None
    project_id: Optional[str] = None
    thread_id: Optional[str] = None


class FileUpdate(BaseModel):
    project_id: Optional[str] = Field(default=None)
    thread_id: Optional[str] = Field(default=None)
    title: Optional[str] = Field(default=None)


# ========= helpers =========
def get_access_token(
    authorization: Optional[str] = Header(None),
    cookie_header: Optional[str] = Header(None, alias="cookie"),
) -> str:
    """
    優先順:
    1) Authorization: Bearer <token>
    2) Cookie の sb-access-token / access_token
    いずれも無ければ 401
    """
    # 1) Authorization ヘッダ優先
    if authorization:
        parts = authorization.split(" ", 1)
        if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
            return parts[1].strip()

    # 2) Cookie から取得（必要に応じてキー名を調整）
    if cookie_header:
        try:
            # 超シンプルなパーサ（= を含むペアのみ拾う）
            cookies = dict(
                c.strip().split("=", 1) for c in cookie_header.split(";") if "=" in c
            )
        except Exception:
            cookies = {}

        token = cookies.get("sb-access-token") or cookies.get("access_token")
        if token:
            return token

    # 3) どちらも無ければ 401
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token"
    )


# postgREST（CRUD）のためのヘルパクラスを呼び出す関数を作成
def supa(access_token: str = Depends(get_access_token)) -> SupaRest:
    return SupaRest(access_token=access_token, profile="app")


# ========= CRUD =========
@router.get("/files")
async def list_files(
    supabase: SupaRest = Depends(supa),
    project_id: Optional[str] = Query(None),
    thread_id: Optional[str] = Query(None),
    mime_prefix: str = Query("image/"),  # 画像のみ表示する既定
):
    """
    自分の画像（RLSで制限）を一覧。必要に応じて project / thread で絞り込み。
    画像のみ（mime LIKE 'image/%'）を既定に。
    """
    params: Dict[str, Any] = {
        "order": "created_at.desc",
        "select": "id,storage_path,mime,size,owner_user_id,project_id,thread_id,title,created_at",
        "mime": f"like.{mime_prefix}%" if mime_prefix else None,
    }
    if project_id:
        params["project_id"] = f"eq.{project_id}"
    if thread_id:
        params["thread_id"] = f"eq.{thread_id}"

    # None はクエリから除く
    params = {k: v for k, v in params.items() if v is not None}

    rows = await supabase.get("attachments", params=params)
    return rows or []


@router.post("/files", status_code=status.HTTP_201_CREATED)
async def create_file(payload: FileCreate, supabase: SupaRest = Depends(supa)):
    """
    新しい添付（attachments）を追加。owner_user_id は DB 側 RPC で auth.uid() を使用して付与。
    """
    args = {
        "in_storage_path": payload.storage_path,
        "in_mime": payload.mime,
        "in_size": payload.size,
        "in_title": payload.title,
        "in_project_id": payload.project_id,
        "in_thread_id": payload.thread_id,
    }
    row = await supabase.rpc("add_attachment", args)
    return row


@router.patch("/files/{file_id}")
async def update_file(
    file_id: str = Path(..., description="attachments.id"),
    payload: FileUpdate = ...,
    supabase: SupaRest = Depends(supa),
):
    """
    紐づけ（project_id / thread_id / title）を部分更新。
    RLS のもとで自分の行のみ更新可能。
    """
    # RPC（ownerチェック + 更新 + 返却）
    args = {
        "in_id": file_id,
        "in_project_id": payload.project_id,
        "in_thread_id": payload.thread_id,
        "in_title": payload.title,
    }
    row = await supabase.rpc("reassign_attachment", args)
    return row


@router.delete("/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: str = Path(..., description="attachments.id"),
    supabase: SupaRest = Depends(supa),
):
    """
    attachments を削除（documents/chunks は ON DELETE CASCADE）。
    RLS により自分の行のみ削除可能。
    必要なら将来、ストレージ物理削除は別途（署名URL/サービスキー経由）で実装。
    """
    print(file_id)
    # RLS 下で安全に削除するため RPC を利用（owner チェック込み）
    await supabase.rpc("delete_attachment", {"in_id": file_id})
    return None
