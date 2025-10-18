from __future__ import annotations
from typing import Any, Dict
from crud import SupaRest


# スコープ付きのベクトル検索 RPC
async def rpc_match_scoped(client: SupaRest, args: Dict[str, Any]):
    return await client.post(
        "rpc/match_documents_scoped", json=args, content_profile="app"
    )


# ドキュメントID限定のベクトル検索 RPC
async def rpc_match_by_doc_ids(client: SupaRest, args: Dict[str, Any]):
    return await client.post(
        "rpc/match_by_document_ids", json=args, content_profile="app"
    )
