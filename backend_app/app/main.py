import os

# Pythonのデータ型ヒントを定義するモジュール
from typing import List, Literal, Optional, Any, AsyncGenerator, Generator

# バリデーションを定義するためのモジュール
from pydantic import BaseModel, Field

# 非同期処理の基盤モジュール
import asyncio, inspect, json

# fastAPIの読み込み
from fastapi import FastAPI, HTTPException, Depends

from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from dotenv import load_dotenv

# チャットシステムの呼び出し
from chat_system.chatbot import (
    chat_to_chatbot,
)  # question: str -> str  を想定
from chat_system.chatagent import chat_to_agent  # question: str -> str  を想定
from routers import auth, projects, threads, messages, admin
from crud import SupaRest
from deps import bearer_token

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


@app.get("/health")
def health():
    return {"status": "ok"}


# -------------------------------------------------
# SSEユーティリティ（イベント1件をWire形式に整形）
# -------------------------------------------------
def sse(data: Any, event: str | None = None) -> bytes:
    """
    Server-Sent Events 1メッセージ分を bytes に整形して返す。
    data は str でも dict(JSON形式) でもよい(クライアント側で制御する)
    """
    # string型でない場合はdataをJSON形式にする
    if not isinstance(data, str):
        data = json.dumps(data, ensure_ascii=False)
    lines = []  # 最終的に作成するデータ列の箱を作成
    # 終了時の"done"などのイベントが含まれている場合は、イベント行を作成
    if event:
        lines.append(f"event: {event}")
    # dataを行単位で分割し、lineに格納
    for line in str(data).splitlines():
        lines.append(f"data: {line}")
    # 空行でメッセージの終端を表現する
    return ("\n".join(lines) + "\n\n").encode("utf-8")


# -------------------------------------------------
# チャットボット用：SSE
# -------------------------------------------------
@app.post("/api/v1/chatbot")
async def res_chatbot(req: ChatRequest, token: str = Depends(bearer_token)):
    """
    data: {"type":"start"}           ... 開始通知
    data: {"type":"chunk","delta":…} ... トークン/文字の差分
    event: done
    data: {"type":"end"}             ... 終了通知
    """
    # 直近のユーザのメッセージ（質問）を取得
    last_user = next(
        (m.content for m in reversed(req.messages) if m.role == "user"), None
    )
    # 発言がないときはエラーを出力
    if not last_user:
        raise HTTPException(status_code=400, detail="no user message found")

    # ジェネレータ関数を定義(ユーザから質問を受け取り、回答を返信する)
    async def generator():
        # 受信した返信テキストを貯めるバッファ
        # データベースへの保存で使用
        assistant_parts: list[str] = []

        # yieldのタイミングで回答の1イベントを送信できる
        # 開始イベントを送信
        yield sse({"type": "start"})

        try:
            # 1) chat_to_chatbot が「非同期ジェネレータ関数」の場合
            if inspect.isasyncgenfunction(chat_to_chatbot):
                # チャットボットにユーザからのメッセージを送信し、チャンクごとにイベントをクライアントに送る
                async for chunk in chat_to_chatbot(last_user):
                    if not chunk:
                        continue
                    # バッファに断片的なデータを保存
                    assistant_parts.append(str(chunk))
                    yield sse({"type": "chunk", "delta": str(chunk)})

            # 2)  chat_to_chatbot が「同期ジェネレータ関数」の場合（イベントループをブロックする可能性がある）
            elif inspect.isgeneratorfunction(chat_to_chatbot):
                loop = asyncio.get_running_loop()  # イベントループを取得

                # 同期ジェネレータを別スレッドで回して逐次取り出す関数(ラップ)
                def run_sync_gen() -> (
                    Generator[str, None, None]
                ):  # (yield型, send型, return型) = (str, None, None)
                    # チャットボットにユーザからのメッセージを転送し、ストリーミングで受け取ってその都度出力
                    for c in chat_to_chatbot(last_user):  # type: ignore
                        yield str(c)

                # run_sync_gen()を呼び出してチャットボットからの返信を取得する
                gen = run_sync_gen()
                # 差分を作成してクライアントに送信
                while True:
                    try:
                        chunk = await loop.run_in_executor(
                            None, lambda: next(gen)
                        )  # 差分を取得
                    except StopIteration:
                        break
                    # バッファに断片的なデータを保存
                    assistant_parts.append(str(chunk))
                    yield sse(
                        {"type": "chunk", "delta": chunk}
                    )  # クライアントにイベントを送信

            # 3) 文字列を一括返却　→ 疑似ストリーム化
            else:
                if inspect.iscoroutinefunction(chat_to_chatbot):
                    text = await chat_to_chatbot(last_user)  # type: ignore
                else:
                    loop = asyncio.get_running_loop()  # イベントループを取得
                    text = await loop.run_in_executor(None, chat_to_chatbot, last_user)

                # まとめて返るパスは全文を保存
                assistant_parts.append(text)
                # 疑似的に小分け送信（速度は任意に調整可）
                CHUNK = 20
                for i in range(0, len(text), CHUNK):
                    yield sse(
                        {"type": "chunk", "delta": text[i : i + CHUNK]}
                    )  # イベントをクライアントに送信
                    await asyncio.sleep(0)  # イベントループに譲る（詰まり防止）

        except asyncio.CancelledError:
            # クライアント側で中断された
            yield sse({"type": "end", "reason": "client_cancel"})
            return
        except Exception as e:
            # エラー通知
            yield sse({"type": "error", "message": str(e)})
            return
        finally:
            # Nginx等のアイドル切断の対策としてハートビートを入れる
            # yield b":heartbeat\n\n"
            ...
        # ==== 正常終了時：まず DB に保存してから end を送る ====
        try:
            assistant = "".join(
                assistant_parts
            ).strip()  # 収集した断片的なデータを前後の空白や改行を除去して保存
            if assistant:
                # データベースに保存
                client = SupaRest(token)
                body = {
                    "thread_id": req.threadId,
                    "role": "assistant",
                    "content": assistant,
                }
                # POSTメソッドを使用してメッセージテーブルにテキストを保存(savedは通知に使用)
                saved = await client.post(
                    "messages",
                    json=body,  # ボディをjsonで送信
                    content_profile="app",  # アクセス先のスキーマを指定(書き込み系は Content-Profileで指定)
                    prefer="return=representation",  # 保存後のデータを取得
                )
                # 必要なら保存IDを通知（クライアントが使うなら）
                # msg_id = (saved[0] if isinstance(saved, list) else saved).get("id")
                # if msg_id: yield sse({"type":"saved","assistant_msg_id": msg_id})
        except Exception as e:
            # 保存失敗を通知（ストリームは終わらせる）
            yield sse({"type": "error", "message": f"save failed: {e}"})

        # 正常終了（DB保存が終わったら end / done を送る）
        yield sse({"type": "end"})  # 終了の合図を送信
        yield sse("done", event="done")  # done(終了)イベント行を作成

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",  # nginx のバッファリング抑止
    }
    # ストリーミング形式でデータをクライアントサイドに送信
    return StreamingResponse(generator(), headers=headers)


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
