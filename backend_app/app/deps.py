# 認証情報をリクエストから抜き出す処理を行う（一応ローカルストレージ版も残しておく）
from fastapi import Header, Request, HTTPException


def bearer_token(
    request: Request,
    authorization: str | None = Header(default=None),
) -> str:
    # 1) ローカルストレージ
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()

    # 2) Cookie
    token = request.cookies.get("sb-access-token")
    if token:
        return token

    raise HTTPException(status_code=401, detail="missing token")
