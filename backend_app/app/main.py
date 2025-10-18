import os

# Pythonのデータ型ヒントを定義するモジュール
from typing import List, Literal, Optional, Any, AsyncGenerator, Generator

# バリデーションを定義するためのモジュール
from pydantic import BaseModel, Field

# 非同期処理の基盤モジュール
import asyncio, inspect, json

# fastAPIの読み込み
from fastapi import FastAPI, HTTPException, Depends, Request

from fastapi.middleware.cors import CORSMiddleware

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse


from dotenv import load_dotenv

from routers import auth, projects, threads, messages, admin, attachments, chat, files

# ---- 入出力スキーマ ----
Role = Literal["user", "assistant", "system"]


class Message(BaseModel):
    role: Role
    content: str


class ChatRequest(BaseModel):
    projectId: Optional[str] = None
    threadId: str
    messages: List[Message] = Field(min_items=1)


class ChatResponse(BaseModel):
    reply: str


load_dotenv()
app = FastAPI(title="Chat Backend (FastAPI to Supabase)")

# CORS 設定（本番は厳密に）
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],  # 正確に指定
    allow_credentials=True,  # ← Cookie を許可
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth、CRUD のルータの登録（/api 配下にまとめる）
# 今後のために一応バージョンを組み込み
app.include_router(auth.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(threads.router, prefix="/api/v1")
app.include_router(messages.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(attachments.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(files.router, prefix="/api/v1")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # ← 422 の詳細をログ出力
    print("422 details:", exc.errors())
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


# -------------------------------------------------
# agent用リクエスト受付
# -------------------------------------------------
@app.post("/api/v1/agent", response_model=ChatResponse)
async def res_agent(req: ChatRequest):  # postメソッドの定義
    # 最後の user メッセージを取り出す
    last_user = next(
        (m.content for m in reversed(req.messages) if m.role == "user"), None
    )
    if not last_user:
        raise HTTPException(status_code=400, detail="no user message found")

    try:
        if inspect.iscoroutinefunction(chat_to_agent):
            reply = await chat_to_agent(last_user)  # async 関数の場合
        else:
            loop = asyncio.get_running_loop()
            reply = await loop.run_in_executor(
                None, chat_to_agent, last_user
            )  # sync 関数をスレッドで実行
    except Exception as e:
        # エラー処理
        raise HTTPException(status_code=500, detail=str(e))

    return ChatResponse(reply=reply)
