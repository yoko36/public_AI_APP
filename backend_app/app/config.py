from __future__ import annotations
import os

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-small")
DEBUG_TRACE = os.getenv("DEBUG_SSE_TRACE", "1") == "1"  # ← 本番は0に
