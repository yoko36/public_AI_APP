import os

# Pythonのデータ型ヒントを定義するモジュール
from typing import List, Literal, Optional

# バリデーションを定義するためのモジュール
from pydantic import BaseModel, Field

# 非同期処理の基盤モジュール
import asyncio, inspect

# fastAPIの読み込み
from fastapi import FastAPI, HTTPException

# チャットシステムの呼び出し
from chatbot import chat_to_chatbot  # question: str -> str  を想定
from chatagent import chat_to_agent  # question: str -> str  を想定

# ---- 入出力スキーマ ----
Role = Literal["user", "assistant", "system"]


class Message(BaseModel):
    role: Role
    content: str


class ChatRequest(BaseModel):
    projectId: Optional[str] = None
    messages: List[Message] = Field(min_items=1)


class ChatResponse(BaseModel):
    reply: str


app = FastAPI()


@app.get("/health")
def health():
    return {"status": "ok"}


# チャットボット用リクエスト受付
@app.post("/api/chatbot", response_model=ChatResponse)
async def res_chatbot(req: ChatRequest):  # postメソッドの定義
    # 最後の user メッセージを取り出す
    last_user = next(
        (m.content for m in reversed(req.messages) if m.role == "user"), None
    )
    if not last_user:
        raise HTTPException(status_code=400, detail="no user message found")

    # chat_to_chatbot が 同期/非同期 どちらでも動くようにする
    try:
        if inspect.iscoroutinefunction(chat_to_chatbot):
            reply = await chat_to_chatbot(last_user)  # async 関数の場合
        else:
            loop = asyncio.get_running_loop()
            reply = await loop.run_in_executor(
                None, chat_to_chatbot, last_user
            )  # sync 関数をスレッドで実行
    except Exception as e:
        # エラー処理
        raise HTTPException(status_code=500, detail=str(e))

    return ChatResponse(reply=reply)


# agent用リクエスト受付
@app.post("/api/agent", response_model=ChatResponse)
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
