from __future__ import annotations
from typing import List, Literal, Optional
from pydantic import BaseModel, Field


Role = Literal["user", "assistant", "system"]


class Message(BaseModel):
    role: Role
    content: str


class ChatRequest(BaseModel):
    projectId: Optional[str] = None
    threadId: str
    messages: List[Message] = Field(min_items=1)
    attachmentIds: Optional[List[str]] = None
