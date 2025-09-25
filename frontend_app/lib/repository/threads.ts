// プロジェクトを取得、追加、削除、更新する機能群
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/backend";

import { Thread } from "@/types/chat-app"

// スレッドリストの取得（api/で定義しているプロキシに送信）
export async function listThreads(projectId: string) {
  const params = new URLSearchParams({ projectId });
  return apiGet(`/api/main/threads/?${params.toString()}`);
}

// 新規スレッドの追加（api/で定義しているプロキシに送信）
export async function createThread(input: { projectId: string, name: string }) {
  const id = crypto.randomUUID();
  const payload = { id, projectId: input.projectId, name: input.name };
  return apiPost("/api/main/threads/", payload);
}

// スレッドの名前変更（api/で定義しているプロキシに送信）
export function renameThread(id: string, name: string) {
  return apiPatch<Thread[]>("/api/main/threads/" + id, { name });
}

// スレッドの削除（api/で定義しているプロキシに送信）
export function deleteThread(id: string) {
  return apiDelete("/api/main/threads/" + id);
}
