from __future__ import annotations
from typing import List, Dict


# ベクトル検索のヒットを LLM 入力用のテキストに整形
# テキスト（str型）でLLMに入力
# metadata.title / metadata.source / metadata.page を考慮
def format_hits(hits: List[Dict]) -> str:
    lines = []
    for i, h in enumerate(hits or [], 1):
        meta = h.get("metadata") or {}
        title = meta.get("title") or meta.get("source") or ""
        page = meta.get("page")
        src = meta.get("source") or ""
        tag = f"[{i}] {title}"
        if page:
            tag += f" p.{page}"
        if src:
            tag += f" {src}"
        text = h.get("text") or ""
        lines.append(f"{tag}\n{text}")
    return "\n\n".join(
        lines
    )  # 質問の後に改行を二つ挟んで検索でヒットしたデータ（テキスト）をLLMに送信
