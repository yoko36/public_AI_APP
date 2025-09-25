# crud.py
# ------------------------------------------------------------
# PostgREST を叩く薄いクライアント。
# ・ユーザーのアクセストークン（JWT） or Service Role Key を Authorization に付与
# ・常に "app" スキーマで読み書き（Accept-Profile / Content-Profile）
# ・PostgREST の 4xx/5xx は FastAPI の HTTPException に変換（500を避け、原因が見える）
# ------------------------------------------------------------

import os
from typing import Any, Dict, Optional
import httpx
from fastapi import HTTPException  # ← FastAPI 側の例外で返すため

# PostgREST ベースURL（例: http://<host>:8000/rest/v1）
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL is not set")
ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
if not ANON_KEY:
    raise RuntimeError("SUPABASE_ANON_KEY is not set")
# DB接続用URL
REST_BASE = f"{SUPABASE_URL}/rest/v1"


class SupaRest:
    """
    PostgREST を使いやすくするためのヘルパ関数
    - ユーザーの access_token を Authorization に付与して RLS を効かせる
    - 公開スキーマが複数ある環境で複雑にならないよう、スキーマ「プロファイル」をヘッダで指定する
      * 読み込み系:    Accept-Profile: <schema>
      * 書き込み/RPC:  Content-Profile: <schema>
    - 非 2xx は FastAPI の HTTPException に張り替える（エラーをわかりやすくするため）。
    """

    def __init__(
        self,
        access_token: Optional[str] = None,
        *,
        profile: str = "app",  # ← 既定で app スキーマを見る
        service_key: Optional[str] = None,  # ← サーバ側で RLS 無視が必要な場合
        timeout: float = 30.0,
    ):
        self._timeout = timeout
        self._profile = profile

        # apikey は「サービスキー優先、なければ anon」
        apikey = service_key or ANON_KEY

        # Authorization は「サービスキー優先、なければユーザーアクセストークン」
        bearer = service_key or access_token
        # 未認証ユーザからのリクエストをはじく
        if not bearer:
            raise ValueError("SupaRest: either access_token or service_key is required")

        # ベースヘッダ（GET と WRITE で使い分ける）
        base_headers = {
            "apikey": apikey,  # 通常は anon をセット（レート制限/識別用）
            "Authorization": f"Bearer {bearer}",  # 認証キー
            "Content-Type": "application/json",  # JSON固定
            "Prefer": "resolution=merge-duplicates",  # 複数行をupsertするときの解決戦略を指定
        }
        # 読み込み系（Accept-Profile）
        self._headers_get = {**base_headers, "Accept-Profile": self._profile}
        # 書き込み/RPC 系（Content-Profile）
        self._headers_write = {**base_headers, "Content-Profile": self._profile}

    # ==================================================
    ## ヘルパ関数
    # ==================================================
    # ヘッダーに要素追加する関数
    def _merge_headers(self, base: dict, extra: dict | None = None) -> dict:
        # 呼び出し元からの追加ヘッダを安全にマージ
        if not extra:
            return dict(base)
        merged = dict(base)
        merged.update(extra)
        return merged

    # ==================================================
    ## 内部共通：実際にpostgRESTにリクエストを送る処理を定義
    # ==================================================
    async def _request(
        self,
        method: str,  # CRUDを指定
        path: str,  # リクエスト先
        *,
        headers: Optional[
            Dict[str, str]
        ] = None,  # 追加のHTTPヘッダを上書きしたいときに使用
        **kwargs,
    ):
        h = {**(headers or {})}  # ヘッダー(辞書型)をアンパック
        url = f"{REST_BASE}/{path.lstrip('/')}"  # URLを作成
        # クライアントライブラリ(httpx)内の非同期メソッドを使用して通信を行う
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            r = await client.request(
                method, url, headers=h, **kwargs
            )  # あて先に任意のメソッドを送信
        try:
            r.raise_for_status()  # 成功通知(2xx)以外の通知で例外発生させる
        # FastAPI側にpostgRESTのエラーコードがそのまま転送
        except httpx.HTTPStatusError as e:
            # PostgREST のメッセージをそのまま detail に載せる
            detail = e.response.text
            raise HTTPException(status_code=e.response.status_code, detail=detail)
        # レスポンスが空もしくはステータスコードが204(No Content)のとき
        if r.status_code == 204 or not r.content:
            return None
        # JSONでレスポンスが返ってくることを期待して一度投げて、JSON出ないときはそのまま返す
        try:
            return r.json()
        except ValueError:
            return r.text

    # ---- CRUD / RPC の公開メソッド ----

    # データの取得(Read)
    async def get(
        self,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        headers: dict | None = None,  # 追加ヘッダー
        accept_profile: str | None = None,  # 読み取りスキーマを上書きしたい場合
    ):
        # PostgREST は select 指定が推奨。未指定なら * を付ける
        # paramsにselectの初期値を指定する
        qp: Dict[str, Any] = {"select": "*"}
        if params:
            qp.update(params)
        # 追加するものがあれば追加する
        h = self._merge_headers(self._headers_get, headers)
        if accept_profile:  # 任意で Accept-Profile を上書き
            h["Accept-Profile"] = accept_profile
        return await self._request(
            "GET", path, headers=h, params=qp
        )  # GETメソッドを発行

    # データの登録(Create)
    async def post(
        self,
        path: str,
        json: Dict[str, Any],
        headers: dict | None = None,  # 追加ヘッダ
        content_profile: str | None = None,
        prefer: str | None = None,
    ):
        # ヘッダーを追加
        h = self._merge_headers(self._headers_write, headers)
        if prefer:
            h["Prefer"] = (h.get("Prefer") + "," + prefer) if "Prefer" in h else prefer
        if content_profile:
            h["Content-Profile"] = content_profile
        return await self._request("POST", path, headers=h, json=json)

    # データの部分更新(Update)
    async def patch(
        self,
        path: str,
        params: Optional[Dict[str, Any]] = None,  # IDなど対象行を指定する要素
        json: Optional[Dict[str, Any]] = None,  # 変更差分
        headers: dict | None = None,  # 追加ヘッダ
        prefer: str | None = None,
        content_profile: str | None = None,  # 変更対象スキーマを切り替える用途
    ):
        h = self._merge_headers(self._headers_write, headers)
        if prefer:
            h["Prefer"] = (h.get("Prefer") + "," + prefer) if "Prefer" in h else prefer
        if content_profile:
            h["Content-Profile"] = content_profile
        return await self._request(
            "PATCH",
            path,
            headers=h,
            params=(params or None),
            json=(json or {}),
        )

    # データの削除(Delete)
    async def delete(
        self,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        headers: dict | None = None,  # 追加ヘッダ
        content_profile: str | None = None,  # 削除対象スキーマを切り替える用途
    ):
        h = self._merge_headers(self._headers_write, headers)
        if content_profile:
            h["Content-Profile"] = content_profile
        return await self._request("DELETE", path, headers=h, params=params)

    # upsert: 存在すれば更新、無ければ挿入を行う
    async def upsert(
        self,
        table: str,  # 対象テーブル
        json: Dict[str, Any] | list[Dict[str, Any]],  # 挿入、更新するデータ
        *,
        on_conflict: Optional[
            str
        ] = None,  # キーを受け取り既存かどうかで更新か追加を選択
        returning: bool = True,  # 挿入、更新結果の行データを返すかを選択
        headers: dict | None = None,  # 追加ヘッダ
        content_profile: str | None = None,  # upsert対象スキーマを切り替える
    ):
        # Prefer ヘッダで upsert 指示（一意制約にぶつかる行があれば、新しいデータで更新と指示）
        prefer = "resolution=merge-duplicates"
        # 挿入、更新結果は要求するかを決定
        if not returning:
            prefer += ",return=minimal"
        # ヘッダーを作成
        h = self._merge_headers(self._headers_write, headers)
        h["Prefer"] = (h.get("Prefer") + "," + prefer) if "Prefer" in h else prefer
        if content_profile:
            h["Content-Profile"] = content_profile
        # 対象行についてデータをparamsとして送信
        params: Dict[str, Any] = {}
        if on_conflict:
            params["on_conflict"] = on_conflict

        return await self._request(
            "POST", table, headers=h, params=params, json=json
        )  # POSTメソッドを使用してUPSERTを実現

    # RPC（DBに定義したストアド関数） 呼び出し（/rest/v1/rpc/<fn> に POST）
    async def rpc(
        self,
        fn: str,  # 呼び出す関数を指定
        args: Optional[Dict[str, Any]] = None,  # ストアド関数渡す引数
        *,
        profile: Optional[str] = None,  # 適用対象スキーマを上書き
        headers: dict | None = None,  # ヘッダ追加
        accept_profile: str | None = None,  # 応答側スキーマ上書き
        content_profile: str | None = None,  # 呼び出し側スキーマ上書き
        prefer: str | None = None,
    ):
        # RPC は通常 Content-Profile(書き込み系) が見られるが、応答の型不一致を避けるため Accept-Profile(読み込み系) も付ける
        h = self._merge_headers(self._headers_write, headers)
        prof = profile or self._profile
        # 応答スキーマの明示（型不一致対策）
        h["Accept-Profile"] = accept_profile or prof
        if content_profile:
            h["Content-Profile"] = content_profile
        if prefer:
            h["Prefer"] = (h.get("Prefer") + "," + prefer) if "Prefer" in h else prefer

        return await self._request(
            "POST", f"rpc/{fn}", headers=h, json=(args or {})
        )  # POSTメソッドでストアド関数を呼び出す
