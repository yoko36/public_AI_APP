from __future__ import annotations
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from deps import bearer_token
from schemas.chat_schema import ChatRequest
from chat_system.RAGchat import run_rag_chat

router = APIRouter(tags=["chat"])


async def _safe_stream(gen):
    async for chunk in gen:
        if chunk is None:  # ← None は捨てる
            continue
        if isinstance(chunk, str):  # ← 念のため文字列は bytes に
            chunk = chunk.encode("utf-8")
        yield chunk


@router.post("/chatbot")
async def rag_chat(req: ChatRequest, token: str = Depends(bearer_token)):
    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(
        _safe_stream(run_rag_chat(req, token)),
        headers=headers,
    )
