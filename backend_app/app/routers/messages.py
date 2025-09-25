from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Literal
from crud import SupaRest
from deps import bearer_token

# このファイルに指定されているアドレスは”root/api/v1/messages”が先頭につく
router = APIRouter(prefix="/messages", tags=["messages"])

# ==================================================
## 型定義
# ==================================================
Role = Literal["user", "assistant"]


class MessageCreate(BaseModel):
    threadId: str
    role: Role
    content: str


# ==================================================
## CRUD 定義
# ==================================================
@router.get("")
async def list_messages(threadId: str = Query(...), token: str = Depends(bearer_token)):
    # トークンを入れて認証ユーザとしての通信で使用する関数を群を呼び出す
    client = SupaRest(token)
    params = {
        "select": "*",
        "thread_id": f"eq.{threadId}",
        "order": "created_at.asc",
    }  # クエリの作成
    return await client.get("messages", params=params)  # GETメソッドの発行


@router.post("")
async def create_message(payload: MessageCreate, token: str = Depends(bearer_token)):
    # トークンを入れて認証ユーザとしての通信で使用する関数を群を呼び出す
    client = SupaRest(token)
    body = {
        "thread_id": payload.threadId,
        "role": payload.role,
        "content": payload.content,
    }  # リクエストボディを作成
    return await client.post(
        "messages",
        json=body,
        prefer="return=representation",
        content_profile="app",
    )  # POSTメソッドの発行
