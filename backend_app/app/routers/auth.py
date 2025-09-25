# auth.py
import os
from functools import lru_cache
from urllib.parse import urlparse
import httpx
from fastapi import APIRouter, HTTPException, Response, Request
from pydantic import BaseModel, EmailStr

# ==================================================
## env読み出し（機密情報の読み出し）
# ==================================================
_SUPABASE_URL_RAW = os.getenv("SUPABASE_URL", "").rstrip("/")
_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

SECURE_COOKIE = (
    os.getenv("COOKIE_SECURE", "false").lower() == "true"
)  # https 環境なら true
SAMESITE_RAW = os.getenv("COOKIE_SAMESITE", "lax").lower()  # lax | strict | none
COOKIE_DOMAIN = (
    os.getenv("COOKIE_DOMAIN", "") or None
)  # 例: ".example.com"（不要なら空）

router = APIRouter(prefix="/auth", tags=["auth"])


# ==================================================
## ヘルパ関数
# ==================================================
# SameSite の設定を受け取り、検証して正規化した値を返す内部関数
def _ensure_samesite(s: str) -> str:
    s = s.lower()  # 小文字に変換（大小の混在を予防）
    if s not in ("lax", "strict", "none"):  # SameSiteは左の三つのみ
        raise RuntimeError(f"COOKIE_SAMESITE must be lax|strict|none (got: {s})")
    if s == "none" and not SECURE_COOKIE:  # samesiteがnoneならsecureCookieは必須
        raise RuntimeError("When COOKIE_SAMESITE=none, COOKIE_SECURE must be true")
    return s


# 環境変数の再変換(読み込み)を防ぐためのデコレータ（関数の返り値を一つキャッシュして再計算を防ぐ）
@lru_cache(maxsize=1)
def get_supabase_url() -> str:
    val = _SUPABASE_URL_RAW
    if not val:
        raise RuntimeError("SUPABASE_URL is not set")
    p = urlparse(val)  # URLを構文解析を行い分解する
    if p.scheme not in ("http", "https"):  # http、https以外はエラー
        raise RuntimeError(
            f"SUPABASE_URL must start with http:// or https:// (got: {val})"
        )
    return val


# 環境変数の再変換(読み込み)を防ぐためのデコレータ（関数の返り値を一つキャッシュして再計算を防ぐ）
@lru_cache(maxsize=1)
def get_anon_key() -> str:
    if not _ANON_KEY:
        raise RuntimeError("SUPABASE_ANON_KEY is not set")
    return _ANON_KEY


# SameSiteを取得
SAMESITE = _ensure_samesite(SAMESITE_RAW)


# ==================================================
## 型定義
# ==================================================
class LoginReq(BaseModel):
    id: EmailStr
    password: str


class LoginRes(BaseModel):
    ok: bool


class MeRes(BaseModel):
    ok: bool
    user: dict | None = None


# ==================================================
## 認証基盤関数（ヘルパー関数）
# ==================================================
# Supabase のパスワード認証（password grant）を実行し、トークン類を含む JSON を辞書で返す非同期ヘルパー関数
async def _supabase_password_grant(email: str, password: str) -> dict:
    base = get_supabase_url()  # ベースURLを取得
    headers = {
        "apikey": get_anon_key(),
        "Content-Type": "application/json",
    }  # ヘッダー作成
    # クライアントライブラリ(httpx)内の非同期メソッドを使用して通信を行う
    async with httpx.AsyncClient(base_url=base, timeout=30.0) as client:
        # ユーザが入力したemailとパスワードで認証を試みる
        r = await client.post(
            "/auth/v1/token",
            params={"grant_type": "password"},  # 認証種別を設定(パスワードを使用)
            headers=headers,
            json={"email": email, "password": password},
        )
        try:
            r.raise_for_status()  # エラー確認(200番台以外は例外処理)
        except httpx.HTTPStatusError as e:
            try:
                j = e.response.json()
                detail = j.get("error_description") or j.get("error") or e.response.text
            except Exception:
                detail = e.response.text
            raise HTTPException(
                status_code=401, detail=detail or "authentication failed"
            ) from e
        return (
            r.json()
        )  # アクセストークン、リフレッシュトークンなどを含むJSONボディを辞書型データとして返す。


# ユーザが保持しているアクセストークンでユーザ情報を問い合わせる非同期ヘルパ関数
async def _supabase_get_user(access_token: str) -> dict:
    base = get_supabase_url()  # ベースURLを取得
    headers = {
        "apikey": get_anon_key(),
        "Authorization": f"Bearer {access_token}",
    }  # Authorization ヘッダーを作成
    # クライアントライブラリ(httpx)内の非同期メソッドを使用して通信を行う
    async with httpx.AsyncClient(base_url=base, timeout=15.0) as client:
        r = await client.get("/auth/v1/user", headers=headers)
        r.raise_for_status()  # 200番台以外の場合例外発生
        return r.json()  #


# リフレッシュトークンから新しいアクセストークン等を発行してもらう非同期ヘルパ関数
async def _supabase_refresh(refresh_token: str) -> dict:
    base = get_supabase_url()
    headers = {"apikey": get_anon_key(), "Content-Type": "application/json"}
    # クライアントライブラリ(httpx)内の非同期メソッドを使用して通信を行う
    async with httpx.AsyncClient(base_url=base, timeout=15.0) as client:
        r = await client.post(
            "/auth/v1/token",
            params={
                "grant_type": "refresh_token"
            },  # 認証種別を設定(リフレッシュトークンを使用)
            headers=headers,
            json={"refresh_token": refresh_token},
        )
        r.raise_for_status()  # 200番台以外の場合例外発生
        return (
            r.json()
        )  # 新しいアクセストークンや有効期限などを含む JSON を辞書型データで返す


# ==================================================
## エンドポイント定義
# ==================================================
# ログイン処理
@router.post("/login", response_model=LoginRes)
async def login(req: LoginReq, response: Response):
    data = await _supabase_password_grant(str(req.id), req.password)  # 認証処理
    access_token = data.get("access_token")  # アクセストークンを取得
    refresh_token = data.get("refresh_token")  # リフレッシュトークンを取得
    expires_in = int(data.get("expires_in", 3600))  # 有効期限
    if not access_token or not refresh_token:
        raise HTTPException(status_code=502, detail="invalid token response from auth")
    # 新しく取得したトークンをCookieに保存する
    cookie_kwargs = dict(
        httponly=True,
        secure=SECURE_COOKIE,
        samesite=SAMESITE,
        path="/",
        domain=COOKIE_DOMAIN,
    )
    # アクセストークンをCookieに設定
    response.set_cookie(
        "sb-access-token", access_token, max_age=expires_in, **cookie_kwargs
    )
    # リフレッシュトークンをCookieに設定
    response.set_cookie(
        "sb-refresh-token", refresh_token, max_age=60 * 60 * 24 * 14, **cookie_kwargs
    )
    return LoginRes(ok=True)  # ログイン完了レスポンスを返す


# ログアウト処理
@router.post("/logout", response_model=LoginRes)
async def logout(response: Response):
    # Cookie を削除
    for name in ("sb-access-token", "sb-refresh-token"):
        response.delete_cookie(name, path="/", domain=COOKIE_DOMAIN)
    return LoginRes(ok=True)


# Cookie からトークンを使ってユーザ情報を取得し、期限切れならリフレッシュして更新する
@router.get("/me", response_model=MeRes)
async def me(request: Request, response: Response):
    # リクエストからトークンを取得
    access = request.cookies.get("sb-access-token")
    refresh = request.cookies.get("sb-refresh-token")
    if not access:
        raise HTTPException(status_code=401, detail="no access token")
    #
    try:
        user = await _supabase_get_user(access)  # DBにアクセスし、ユーザ情報を取得
        return MeRes(
            ok=True, user=user
        )  # ユーザ情報を含むセッション成功レスポンスを返す
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401 and refresh:
            # 期限切れ → リフレッシュ
            try:
                data = await _supabase_refresh(
                    refresh
                )  # リフレッシュトークンからアクセストークンを生成(新しいリフレッシュトークンも取得)
                new_access = data.get("access_token")
                new_refresh = data.get("refresh_token") or refresh
                expires_in = int(data.get("expires_in", 3600))
                if not new_access:
                    raise HTTPException(status_code=401, detail="refresh failed")

                # 生成したトークンからCookieを再構築
                response.set_cookie(
                    "sb-access-token",
                    new_access,
                    max_age=expires_in,
                    httponly=True,
                    secure=SECURE_COOKIE,
                    samesite=SAMESITE,
                    path="/",
                    domain=COOKIE_DOMAIN,
                )
                response.set_cookie(
                    "sb-refresh-token",
                    new_refresh,
                    max_age=60 * 60 * 24 * 14,
                    httponly=True,
                    secure=SECURE_COOKIE,
                    samesite=SAMESITE,
                    path="/",
                    domain=COOKIE_DOMAIN,
                )

                user = await _supabase_get_user(
                    new_access
                )  # DBにアクセスし、ユーザ情報を取得
                return MeRes(
                    ok=True, user=user
                )  # ユーザ情報を含むセッション成功レスポンスを返す
            # トークンの再構築失敗
            except Exception:
                raise HTTPException(status_code=401, detail="refresh failed")
        # 未認証ユーザとして処理
        raise HTTPException(status_code=401, detail="unauthorized")
    except httpx.RequestError as e:
        # ネットワーク系（DNS/接続/タイムアウト）は 503 に統一
        raise HTTPException(
            status_code=503, detail=f"auth upstream unavailable: {e.__class__.__name__}"
        )
    except Exception as e:
        # 予期せぬ例外は 500
        raise HTTPException(
            status_code=500, detail=f"auth me failed: {e.__class__.__name__}"
        )
