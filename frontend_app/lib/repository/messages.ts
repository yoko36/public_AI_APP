// メッセージを取得、送信する際の要求関数
import { Message } from "@/types/chat-app"
import { apiGet, apiPost } from "@/lib/backend";

// メッセージリストの取得（api/で定義しているプロキシに送信）
export function listMessages(threadId: string) {
  return apiGet<Message[]>("/api/main/messages", { threadId }); // プロキシに送信
}

// 新規メッセージの追加（api/で定義しているプロキシに送信）
export function createMessage(input: { threadId: string; role: "user" | "assistant"; content: string }) {
  const body = {
    threadId: input.threadId,
    role: input.role,
    content: input.content,
  };
  return apiPost<Message[] | Message>("/api/main/messages", body);  // プロキシに送信
}