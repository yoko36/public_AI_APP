from __future__ import annotations
import json, traceback
from typing import Any, Optional
from fastapi import HTTPException
from config import DEBUG_TRACE


# SSE: data と event を整形
def sse(data: Any, event: Optional[str] = None) -> bytes:
    if not isinstance(data, str):
        data = json.dumps(data, ensure_ascii=False)  # リストや配列をJSONに変換
        lines = []
        if event:
            lines.append(f"event: {event}")
        for line in str(data).splitlines():
            lines.append(f"data: {line}")
        return ("\n".join(lines) + "\n\n").encode("utf-8")


# デバッグ用 SSE ペイロード（type=debug）
def sse_debug(stage: str, **kwargs) -> bytes:
    payload = {"type": "debug", "stage": stage}
    if kwargs:
        payload.update(kwargs)
    return sse(payload)


# 例外→エラーペイロード（type=error）
def sse_error_payload(exc: Exception, where: str) -> dict:
    if isinstance(exc, HTTPException):
        msg = exc.detail
        code = exc.status_code
    else:
        msg = str(exc)
        code = None
    payload = {
        "type": "error",
        "where": where,
        "message": msg,
    }
    if code is not None:
        payload["status"] = code
    if DEBUG_TRACE:
        payload["trace"] = traceback.format_exc()
    return payload
