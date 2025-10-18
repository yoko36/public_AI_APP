from __future__ import annotations
from typing import Iterable, List, Dict
from openai import OpenAI
from config import OPENAI_API_KEY, EMBED_MODEL

CHAT_MODEL = "gpt-5-mini"

# OpenAI クライアント（シングルトン的に使う想定）
oai = OpenAI(api_key=OPENAI_API_KEY)


# テキスト→ベクトルへ（埋め込み）
async def embed_text(text: str) -> List[float]:
    # OpenAI の Embeddings API は同期 I/O だが、
    # 呼び出し側の整合をとるため async 関数として定義
    r = oai.embeddings.create(model=EMBED_MODEL, input=text)
    return r.data[0].embedding


# LLM からストリーミング出力を得るジェネレータ
# Responses API を利用し、差分テキストを yield


def stream_llm(history: list[dict], question: str, context: str) -> Iterable[str]:
    system = "あなたは根拠ベースで回答します。最後に [1],[2],… の参照番号のみ列挙してください。"
    # メッセージリスト
    msgs = (
        [{"role": "system", "content": system}]  # システムプロンプトの追加
        + history  # 履歴の追加
        + [
            {
                "role": "user",
                "content": f"質問: {question}\n\n参照コンテキスト:\n{context}",
            }
        ]  # 質問文の追加
    )
    with oai.responses.stream(
        model=CHAT_MODEL,
        input=msgs,  # プロンプト
        temperature=0,
    ) as stream:
        for event in stream:  # モデルがトークンを生成するたびに、差分を呼び出し元に返す
            if event.type == "response.output_text.delta":
                yield event.delta
            elif event.type == "response.error":
                raise RuntimeError(getattr(event, "error", "response.error"))
