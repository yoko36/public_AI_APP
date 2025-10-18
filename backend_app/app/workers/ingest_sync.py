# backend/services/ingest_sync.py
from __future__ import annotations

import os
from typing import Optional

from supabase import create_client, Client
from crud import SupaRest

# あなたが既に作成済みの汎用インジェスト関数（Storage → 抽出 → チャンク化 → 埋め込み → INSERT）
# 例: workers/ingest_any.py にある ingest_from_storage を利用

# RAG関連のインポート
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings

EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-small")
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "500"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))
emb = OpenAIEmbeddings(model=EMBED_MODEL, api_key=os.environ["OPENAI_API_KEY"])


# ======== 環境変数（server-side only）========
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
DEFAULT_STORAGE_BUCKET = os.getenv("STORAGE_PRIVATE_BUCKET", "private")


def _admin_sb() -> Client:
    """サービスロールで Supabase クライアントを作成（DB/Storage 挿入用）"""
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def _split_storage_path(storage_path: str) -> tuple[str, str]:
    """
    storage_path から (bucket, object_path) を返す。
    例: "private/thread-123/123-abc.pdf" -> ("private", "thread-123/123-abc.pdf")
        "thread-123/123-abc.pdf"         -> (DEFAULT_STORAGE_BUCKET, "thread-123/123-abc.pdf")
    """
    if not storage_path:
        return (DEFAULT_STORAGE_BUCKET, "")
    if "/" in storage_path:
        head, tail = storage_path.split("/", 1)
        # 先頭が既知の bucket 名っぽい場合はそれを採用、違えばデフォルト bucket 扱い
        if head in {"private", "public"} or head == DEFAULT_STORAGE_BUCKET:
            return (head, tail)
    return (DEFAULT_STORAGE_BUCKET, storage_path)


def _is_image(mime: Optional[str], object_path: str) -> bool:
    """
    画像はスキップ対象（RAGのテキスト抽出対象外）
    画像はテキストではないため個別に処理
    """
    if mime and mime.startswith("image/"):
        return True
    lower = object_path.lower()
    return lower.endswith(
        (
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".webp",
            ".bmp",
            ".svg",
            ".tif",
            ".tiff",
            ".heic",
            ".ico",
        )
    )


async def ingest_sync_from_attachment(attachment_id: str, user_token: str) -> int:
    user_client = SupaRest(user_token)

    # attachments を取得
    att = await user_client.get_one(
        "attachments",
        select="id, thread_id, project_id, owner_user_id, storage_path, mime, size, title",
        id=attachment_id,
        accept_profile="app",
    )
    if not att:
        raise ValueError(f"attachment not found: {attachment_id}")

    thread_id = att["thread_id"]
    project_id = att["project_id"]
    owner_user_id = att["owner_user_id"]
    storage_path: str = att.get("storage_path") or ""
    mime: str | None = att.get("mime")
    title: str = att.get("title") or "Untitled"

    bucket, object_path = _split_storage_path(storage_path)
    if not object_path:
        raise ValueError(f"invalid storage_path: {storage_path!r}")

    if _is_image(mime, object_path):
        print(f"Skipping image file: {object_path}")
        return 0  # チャンクは0件（テキスト抽出しない）

    # PDF/テキスト抽出（既存ロジックを簡約）
    sb = _admin_sb()  # ストレージのRLSは強力でservice_role出ないと使用不可
    raw: bytes = sb.storage.from_(bucket).download(
        object_path
    )  # ストレージからデータ抽出
    if not isinstance(raw, (bytes, bytearray)):
        raw = raw["data"]

    from workers.ingest_RAG_document import (
        _guess_mime,
        _extract_pdf,
        _extract_docx,
        _extract_pptx,
        _extract_markdown,
        _extract_html,
        _extract_json,
        _extract_plain,
        _extract_csv_like,
        _TEXT_MIME,
        _DOC_MIME,
        _PPT_MIME,
        _PDF_MIME,
        _CSV_MIME,
    )

    mime = _guess_mime(object_path, mime)
    if mime in _PDF_MIME or object_path.lower().endswith(".pdf"):
        extracted = _extract_pdf(raw)  # List[(text, page)]
    elif mime in _DOC_MIME or object_path.lower().endswith(".docx"):
        extracted = _extract_docx(raw)
    elif mime in _PPT_MIME or object_path.lower().endswith(".pptx"):
        extracted = _extract_pptx(raw)
    elif mime in _TEXT_MIME or object_path.lower().endswith(
        (".txt", ".md", ".markdown", ".html", ".htm", ".json")
    ):
        if str(mime).startswith("text/markdown") or object_path.lower().endswith(
            (".md", ".markdown")
        ):
            extracted = _extract_markdown(raw)
        elif str(mime) == "text/html" or object_path.lower().endswith(
            (".html", ".htm")
        ):
            extracted = _extract_html(raw)
        elif str(mime) == "application/json" or object_path.lower().endswith(".json"):
            extracted = _extract_json(raw)
        else:
            extracted = _extract_plain(raw)
    elif mime in _CSV_MIME or object_path.lower().endswith((".csv", ".tsv")):
        extracted = _extract_csv_like(raw)
    else:
        extracted = _extract_plain(raw)

    # ドキュメント行を作成（status=ready）
    doc_row = await user_client.post(
        "documents",
        json={
            "attachment_id": attachment_id,
            "owner_user_id": owner_user_id,
            "project_id": project_id,
            "thread_id": thread_id,
            "title": title,
            "status": "ready",
            "meta": {"source": f"{bucket}/{object_path}"},
        },
        content_profile="app",
        prefer="return=representation",
    )
    document_id = doc_row[0]["id"]

    # チャンク化
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP
    )
    chunks_to_insert: list[dict] = []
    chunk_idx = 0
    for text, page in extracted:
        if not (text and text.strip()):
            continue
        for piece in splitter.split_text(text):
            vec = emb.embed_query(piece)
            chunks_to_insert.append(
                {
                    # app.chunks スキーマに合わせる
                    "document_id": document_id,
                    "owner_user_id": owner_user_id,
                    "project_id": project_id,
                    "thread_id": thread_id,
                    "chunk_index": chunk_idx,
                    "text": piece,
                    "embedding": vec,
                    "meta": {
                        "page": page,
                        "title": title,
                        "source": f"{bucket}/{object_path}",
                    },
                }
            )
            chunk_idx += 1

    # 一括INSERT（大きければ分割）
    inserted = 0
    BATCH = 100
    for i in range(0, len(chunks_to_insert), BATCH):
        batch = chunks_to_insert[i : i + BATCH]
        if not batch:
            continue
        await user_client.post(
            "chunks",
            json=batch,
            content_profile="app",
            prefer="return=minimal",
        )
        inserted += len(batch)

    return inserted
