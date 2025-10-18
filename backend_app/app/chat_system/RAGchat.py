from __future__ import annotations
import asyncio, time
from uuid import uuid4
from typing import AsyncIterable, List, Optional
from fastapi import HTTPException

from crud import SupaRest
from config import DEBUG_TRACE
from schemas.chat_schema import ChatRequest
from utils.see import sse, sse_debug, sse_error_payload
from utils.context import format_hits
from services.openai_client import embed_text, stream_llm
from services.vector_store import rpc_match_by_doc_ids, rpc_match_scoped
from workers.ingest_sync import ingest_sync_from_attachment


# RAG チャットの本体（SSE ジェネレータ）
async def run_rag_chat(req: ChatRequest, token: str) -> AsyncIterable[bytes]:
    last_user = next(
        (m.content for m in reversed(req.messages) if m.role == "user"),
        None,  # メッセージリストの最後のユーザメッセージを取得
    )
    if not last_user:
        raise HTTPException(status_code=400, detail="no user message found")

    async def generator():
        user_client: Optional[SupaRest] = None
        assistant_parts: list[str] = []
        assistant_msg_id: Optional[str] = None
        token_counter = 0
        got_token = False

        yield sse({"type": "start"})

        try:
            # 0) クライアント生成
            try:
                user_client = SupaRest(token)  # RLS 有効
                yield sse_debug("client_init", ok=True)
            except Exception as e:
                yield sse_debug("client_init", ok=False)
                yield sse(sse_error_payload(e, "client_init"))
                return

            # 1) プロジェクトIDの抽出（リクエスト内のスレッドから）
            try:
                t = await user_client.get_one(
                    "threads",
                    select="project_id",
                    id=req.threadId,
                    accept_profile="app",
                )
                if not t:
                    raise HTTPException(status_code=404, detail="thread not found")
                project_id = t["project_id"]
                yield sse_debug("resolve_thread_project", project_id=project_id)
            except Exception as e:
                yield sse(sse_error_payload(e, "resolve_thread_project"))
                return

            # 2) 権限チェック（DB に書かない RPC）
            # try:
            #     await user_client.rpc(
            #         "check_thread_writable",
            #         {"in_thread_id": req.threadId},
            #         accept_profile="app",
            #         content_profile="app",
            #     )
            #     yield sse({"type": "probe_ok"})
            #     yield sse_debug("probe_ok")
            # except Exception as e:
            #     yield sse(sse_error_payload(e, "check_thread_writable"))
            #     return

            # 3) 添付取り込み(ベクトルデータ化)
            try:
                for att_id in req.attachmentIds or []:
                    try:
                        inserted = await ingest_sync_from_attachment(att_id, token)
                        yield sse_debug(
                            "ingest_one", attachment_id=att_id, inserted=inserted
                        )
                    except Exception as ie:
                        yield sse(sse_error_payload(ie, "ingest_one"))
            except Exception as e:
                yield sse(sse_error_payload(e, "ingest_attachments"))

            # 3.1) 添付がある場合は READY になるまで短時間ポーリング
            if req.attachmentIds:
                deadline = time.time() + 8.0
                ready = False
                while time.time() < deadline:
                    docs = await user_client.get(
                        "documents",
                        params={
                            "select": "id,attachment_id,status",
                            "attachment_id": f"in.({','.join(req.attachmentIds)})",
                        },
                        accept_profile="app",
                    )
                    yield sse_debug("ingest_poll", docs=len(docs or []))
                    if isinstance(docs, list) and any(
                        d.get("status") == "ready" for d in docs
                    ):
                        ready = True
                        break
                    await asyncio.sleep(0.5)
                if not ready:
                    yield sse_debug("ingest_timeout", attachmentIds=req.attachmentIds)
                    yield sse(
                        {
                            "type": "error",
                            "where": "ingest_wait",
                            "message": "no ingested documents for given attachments",
                            "attachmentIds": req.attachmentIds,
                        }
                    )
                    return

            # 3.5) 添付がある場合は documents.id を抽出（status='ready'）
            doc_ids: List[str] = []
            if req.attachmentIds:
                try:
                    att_in = f"in.({','.join(req.attachmentIds)})"
                    docs = await user_client.get(
                        "documents",
                        params={
                            "select": "id,attachment_id,status",
                            "attachment_id": att_in,
                            "status": "eq.ready",
                        },
                        accept_profile="app",
                    )
                    if isinstance(docs, list):
                        doc_ids = [d["id"] for d in docs if d.get("id")]
                except Exception as e:
                    yield sse(sse_error_payload(e, "resolve_doc_ids"))
                    return
                if not doc_ids:
                    yield sse_debug("doc_ids", doc_ids=[])
                    yield sse(
                        sse_error_payload(
                            HTTPException(
                                status_code=400,
                                detail="no ingested documents for given attachments",
                            ),
                            "resolve_doc_ids",
                        )
                    )
                    return
                else:
                    yield sse_debug("doc_ids", doc_ids=doc_ids)

            # 4) 埋め込み & ベクトル検索
            try:
                q_emb = await embed_text(last_user)
                yield sse_debug("embed_text_ok")
            except Exception as e:
                yield sse(sse_error_payload(e, "embed_text"))
                return

            try:
                # 添付画像あり
                if doc_ids:
                    hits = await rpc_match_by_doc_ids(
                        user_client,
                        {
                            "query_embedding": q_emb,
                            "match_count": 5,
                            "in_document_ids": doc_ids,  # 添付ファイルのアドレス
                        },
                    )
                # 添付画像なし（他の紐づけファイル探索）
                else:
                    hits = await rpc_match_scoped(
                        user_client,
                        {
                            "query_embedding": q_emb,
                            "match_count": 5,
                            "in_thread_id": req.threadId,
                            "in_project_id": project_id,
                        },
                    )
                n_hits = len(hits or [])  # 検索結果の数
                yield sse_debug("vector_search", hits=n_hits, scoped=bool(not doc_ids))
                context = format_hits(hits or [])  # 検索結果
                yield sse_debug("context_ready", context_chars=len(context))
            except Exception as e:
                yield sse(sse_error_payload(e, "vector_search"))
                return

            # 5) LLM ストリーム
            history = [
                {"role": m.role, "content": m.content}
                for m in req.messages
                if m.role in ("user", "assistant", "system")
            ]
            yield sse_debug("llm_begin")
            try:
                for delta in stream_llm(
                    history, last_user, context
                ):  # チャット送信（delta: 返信の一部）
                    got_token = True
                    assistant_parts.append(delta)
                    token_counter += 1
                    yield sse({"type": "chunk", "delta": delta})

                    # 最初のトークンでドラフト保存
                    if assistant_msg_id is None and len(assistant_parts) >= 1:
                        assistant_msg_id = str(uuid4())
                        try:
                            await user_client.upsert(
                                "messages",
                                json={
                                    "id": assistant_msg_id,
                                    "thread_id": req.threadId,
                                    "role": "assistant",
                                    "content": "".join(assistant_parts),
                                },
                                on_conflict="id",
                                content_profile="app",
                            )
                            yield sse_debug("draft_saved", id=assistant_msg_id)
                            yield sse(
                                {
                                    "type": "saved",
                                    "who": "assistant",
                                    "mode": "draft",
                                    "id": assistant_msg_id,
                                }
                            )
                        except Exception as e_upsert:
                            yield sse(sse_error_payload(e_upsert, "draft_upsert"))
                            assistant_msg_id = None

                    # 周期的な上書き
                    if assistant_msg_id and token_counter % 30 == 0:
                        try:
                            await user_client.upsert(
                                "messages",
                                json={
                                    "id": assistant_msg_id,
                                    "thread_id": req.threadId,
                                    "role": "assistant",
                                    "content": "".join(assistant_parts),
                                },
                                on_conflict="id",
                                content_profile="app",
                                returning=False,
                            )
                            yield sse_debug(
                                "mid_update", id=assistant_msg_id, tokens=token_counter
                            )
                        except Exception as e_mid:
                            yield sse(sse_error_payload(e_mid, "mid_update"))
            except Exception as e:
                yield sse(sse_error_payload(e, "openai_stream"))

        except asyncio.CancelledError:
            raise
        except Exception as e:
            yield sse(sse_error_payload(e, "top_level"))
        finally:
            # トークン未受信時のフォールバック（エラーハンドリング）
            if not got_token:
                yield sse(
                    {
                        "type": "error",
                        "where": "openai_stream",
                        "message": "no_tokens_emitted",
                    }
                )
                try:
                    fallback = "[assistant empty response]"
                    await user_client.post(
                        "messages",
                        json={
                            "thread_id": req.threadId,
                            "role": "assistant",
                            "content": fallback,
                        },
                        content_profile="app",
                        prefer="return=representation",
                    )
                    yield sse({"type": "saved", "who": "assistant", "mode": "fallback"})
                except Exception:
                    pass

            # 最終保存
            try:
                if user_client:
                    final_text = "".join(assistant_parts).strip()  # 回答全文
                    if final_text:
                        if (
                            assistant_msg_id
                        ):  # メッセージIDがある場合（chatAPIからのメッセージを正常に保存できた場合）
                            try:
                                # 最終の文章を保存する
                                await user_client.upsert(
                                    "messages",
                                    json={
                                        "id": assistant_msg_id,
                                        "thread_id": req.threadId,
                                        "role": "assistant",
                                        "content": final_text,
                                    },
                                    on_conflict="id",
                                    content_profile="app",
                                    returning=False,
                                )
                                yield sse_debug(
                                    "final_saved",
                                    id=assistant_msg_id,
                                    chars=len(final_text),
                                )
                                yield sse(
                                    {
                                        "type": "saved",
                                        "who": "assistant",
                                        "mode": "final",
                                        "id": assistant_msg_id,
                                    }
                                )
                            except Exception as e_final_up:
                                yield sse(sse_error_payload(e_final_up, "final_upsert"))
                        else:
                            try:
                                # 通信エラーなどで、下書きの保存が行われなければ
                                created = await user_client.post(
                                    "messages",
                                    json={
                                        "thread_id": req.threadId,
                                        "role": "assistant",
                                        "content": final_text,
                                    },
                                    content_profile="app",
                                    prefer="return=representation",
                                )
                                new_id = (
                                    created[0]["id"]
                                    if isinstance(created, list) and created
                                    else None
                                )
                                yield sse_debug(
                                    "final_inserted", id=new_id, chars=len(final_text)
                                )
                                yield sse(
                                    {
                                        "type": "saved",
                                        "who": "assistant",
                                        "mode": "final",
                                        "id": new_id,
                                    }
                                )
                            except Exception as e_post:
                                yield sse(sse_error_payload(e_post, "final_insert"))
            except Exception as e:
                yield sse(sse_error_payload(e, "final_block"))

            yield sse_debug("end")
            yield sse({"type": "end"})
            yield sse("done", event="done")

    # generator をそのまま返す
    async for chunk in generator():
        yield chunk
