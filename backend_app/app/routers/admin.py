# backend/routers/admin.py
from __future__ import annotations

import os
from functools import lru_cache
from urllib.parse import urlparse
from typing import List, Optional, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, EmailStr

from deps import bearer_token  # 既存: ヘッダ/CookieからJWTを取り出す
from crud import SupaRest  # 既存: PostgREST 薄ラッパ（get/upsert/rpc等）

# ================================
# ヘルパ関数
# ================================


@lru_cache(maxsize=1)
def get_supabase_url() -> str:
    val = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    if not val:
        raise RuntimeError("SUPABASE_URL is not set")
    p = urlparse(val)
    if p.scheme not in ("http", "https"):
        raise RuntimeError(
            f"SUPABASE_URL must start with http:// or https:// (got: {val})"
        )
    return val


@lru_cache(maxsize=1)
def get_service_role_key() -> str:
    val = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not val:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not set")
    return val


@lru_cache(maxsize=1)
def get_auth_base_url() -> str:
    # auth専用URLがあれば優先、無ければ SUPABASE_URL + /auth/v1
    return (os.getenv("SUPABASE_AUTH_URL") or (get_supabase_url() + "/auth/v1")).rstrip(
        "/"
    )


router = APIRouter(prefix="/admin", tags=["admin"])  # main.pyで /api/v1 を付ける運用


# ================================
# 型定義
# ================================
class AdminUser(BaseModel):
    id: str
    email: str
    created_at: Optional[str] = None
    last_sign_in_at: Optional[str] = None
    name: str
    role: str


class CreateUserPayload(BaseModel):
    email: EmailStr
    name: str = ""
    role: str = "user"  # 'admin' | 'developer' | 'user'（初期値は 'user' 推奨）
    # 必要なら password: Optional[str] = None


# ================================
# authz: admin/superuser 判定
# ================================
async def require_admin_or_403(token: str) -> None:
    """
    呼び出しユーザが admin/superuser かを DB 関数で検査。
    SQL 側の定義に合わせて is_admin_or_superuser() を使う。
    """
    client = SupaRest(access_token=token)
    is_admin = await client.rpc("is_admin_or_superuser")  # ← bool が返る想定
    if not is_admin:
        raise HTTPException(status_code=403, detail="admin only")


# ================================
# GET /admin/users : 一覧取得（安全RPC）
# ================================
@router.get("/users", response_model=List[AdminUser])
async def list_users(token: str = Depends(bearer_token)):
    await require_admin_or_403(token)
    client = SupaRest(access_token=token)
    # SQL 側は email::text などで TEXT 型に揃えておく（型不一致 42804 を避ける）
    rows = await client.rpc("admin_list_users")
    return rows


# ================================
# POST /admin/users : 新規作成
# ================================
@router.post("/users")
async def create_user(payload: CreateUserPayload, token: str = Depends(bearer_token)):
    """
    新規ユーザ作成（admin/superuserのみ）
    1) GoTrue Admin APIでユーザ作成（Service Role Key）
    2) profiles / user_roles に反映（Service Roleでupsert）
    """
    await require_admin_or_403(token)  # ← 忘れず await

    auth_base = get_auth_base_url()
    service_key = get_service_role_key()

    # 1) GoTrue Admin API: /admin/users
    #    Authorization: Bearer <service_key> と apikey を付与
    async with httpx.AsyncClient(base_url=auth_base, timeout=30.0) as http:
        resp = await http.post(
            "/admin/users",
            headers={
                "Authorization": f"Bearer {service_key}",
                "apikey": service_key,  # 環境により必須。不要なら削除可
                "Content-Type": "application/json",
            },
            json={
                "email": payload.email,
                "email_confirm": True,  # 招待フローにするなら False に
                # "password": "Password1234",
                "user_metadata": {"name": payload.name},
                "app_metadata": {"role": payload.role},  # 参考メタ（実権限はDB）
            },
        )
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            # 409 (User already registered) などを拾って分かりやすく返す
            detail = None
            try:
                j = e.response.json()
                detail = j.get("msg") or j.get("error_description") or j.get("error")
            except Exception:
                detail = e.response.text
            raise HTTPException(
                status_code=e.response.status_code,
                detail=detail or "failed to create user",
            )

    user = resp.json()
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=502, detail="invalid admin response: no id")

    # 2) profiles / user_roles に反映（Service Role で実行）
    #    ※ SQLの列名は user_roles.role_key なので注意
    admin_client = SupaRest(service_key=service_key)

    # profiles: PK は user_id。upsert 時は on_conflict="user_id"
    await admin_client.upsert(
        "profiles",
        json={"user_id": user_id, "name": payload.name},
        on_conflict="user_id",
        returning=False,  # 成功可否だけ分かれば良い
    )

    # user_roles: PK は user_id。upsert 時は on_conflict="user_id"
    await admin_client.upsert(
        "user_roles",
        json={"user_id": user_id, "role_key": payload.role},
        on_conflict="user_id",
        returning=False,
    )

    return {"ok": True, "user_id": user_id}


VALID_ROLES = {"user", "developer", "admin", "superuser"}


class RoleUpdatePayload(BaseModel):
    role: Literal["user", "developer", "admin", "superuser"]


async def is_superuser(token: str) -> Optional[bool]:
    """
    呼び出しユーザが superuser かどうか。
    SQL 側に is_superuser() があれば true/false を返す想定。
    無ければ None を返して上位でフォールバック。
    """
    client = SupaRest(access_token=token)
    try:
        ok = await client.rpc("is_superuser")
        if isinstance(ok, bool):
            return ok
    except Exception:
        pass
    return None


async def count_superusers_via_rpc_or_none() -> Optional[int]:
    """
    残存 superuser の人数。SQL 側に count_superusers() があれば使う。
    無ければ None（= チェックをスキップ）。
    """
    try:
        admin_client = SupaRest(service_key=get_service_role_key())
        n = await admin_client.rpc("count_superusers")
        if isinstance(n, int):
            return n
    except Exception:
        pass
    return None


# ================================
# PATCH /admin/users/{id}/role : 権限変更
# ================================
@router.patch("/users/{user_id}/role")
async def change_user_role(
    payload: RoleUpdatePayload,
    user_id: str = Path(..., description="対象ユーザID (auth.users.id)"),
    token: str = Depends(bearer_token),
):
    """
    対象ユーザの role を更新。
    - 実権限は user_roles.role_key を upsert で反映（Service Role 使用）
    - superuser 付与は superuser のみ許可（is_superuser() が無い環境では許可を拒否）
    - 最後の superuser を降格させることを防止（count_superusers() が無い環境ではスキップ）
    """
    await require_admin_or_403(token)

    new_role = payload.role
    if new_role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="invalid role")

    # superuser 付与の制御
    if new_role == "superuser":
        caller_is_su = await is_superuser(token)
        if caller_is_su is False:
            # RPC があって false なら拒否
            raise HTTPException(
                status_code=403, detail="only superuser can grant superuser"
            )
        if caller_is_su is None:
            # 判定RPCが無い環境では安全側に倒す
            raise HTTPException(
                status_code=403,
                detail="superuser grant not allowed (missing is_superuser rpc)",
            )

    # 最後の superuser の降格を阻止（RPC があれば）
    if new_role != "superuser":
        n = await count_superusers_via_rpc_or_none()
        if n is not None:
            # 対象が superuser かどうかを確認（無ければ簡易判定）
            try:
                admin_client = SupaRest(service_key=get_service_role_key())
                # SupaRest の get 実装に合わせて select を指定
                # 例: /user_roles?user_id=eq.<id>&select=role_key
                rows = await admin_client.get(
                    "user_roles",
                    params={"user_id": f"eq.{user_id}", "select": "role_key"},
                )
                target_is_su = bool(rows and rows[0].get("role_key") == "superuser")
            except Exception:
                target_is_su = False

            if target_is_su and n <= 1:
                raise HTTPException(
                    status_code=409, detail="cannot demote the last superuser"
                )

    # 反映
    admin_client = SupaRest(service_key=get_service_role_key())
    try:
        await admin_client.upsert(
            "user_roles",
            json={"user_id": user_id, "role_key": new_role},
            on_conflict="user_id",
            returning=False,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"failed to update role: {e}")

    return {"ok": True, "user_id": user_id, "role": new_role}


# ================================
# DELETE /admin/users/{id} : アカウント削除
# ================================
@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str = Path(..., description="対象ユーザID (auth.users.id)"),
    token: str = Depends(bearer_token),
):
    """
    ユーザを削除。
    - 先に「最後の superuser」の削除を防止（count_superusers() が無ければスキップ）
    - GoTrue Admin API で /admin/users/{id} を DELETE
    - 参照整合性は DB 側の FK on delete cascade に委ねる（推奨）
    """
    await require_admin_or_403(token)

    # 最後の superuser の削除を防止（RPC があれば）
    n = await count_superusers_via_rpc_or_none()
    if n is not None:
        try:
            admin_client = SupaRest(service_key=get_service_role_key())
            rows = await admin_client.get(
                "user_roles", params={"user_id": f"eq.{user_id}", "select": "role_key"}
            )
            target_is_su = bool(rows and rows[0].get("role_key") == "superuser")
        except Exception:
            target_is_su = False

        if target_is_su and n <= 1:
            raise HTTPException(
                status_code=409, detail="cannot delete the last superuser"
            )

    # GoTrue Admin API で物理削除
    auth_base = get_auth_base_url()
    service_key = get_service_role_key()
    async with httpx.AsyncClient(base_url=auth_base, timeout=30.0) as http:
        resp = await http.delete(
            f"/admin/users/{user_id}",
            headers={
                "Authorization": f"Bearer {service_key}",
                "apikey": service_key,  # 必要な環境のみ。不要なら削除可
            },
        )

    # 404 は「既に無い」＝冪等的に成功とみなす
    if resp.status_code not in (200, 204, 404):
        try:
            msg = resp.json().get("msg") or resp.text
        except Exception:
            msg = resp.text
        raise HTTPException(status_code=resp.status_code, detail=msg or "delete failed")

    # 以降のアプリ側テーブルは FK on delete cascade を推奨。
    # もし FK が無い場合は、ここで app.* テーブルを Service Role で掃除する。
    # 例:
    # admin_client = SupaRest(service_key=service_key)
    # await admin_client.delete("app.projects", params={"user_id": f"eq.{user_id}"})
    # …etc

    return {"ok": True, "user_id": user_id}
