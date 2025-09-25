// プロジェクトを取得、追加、削除、更新する機能群
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/backend";

import { Project } from "@/types/chat-app"

// プロジェクトリストの取得（api/で定義しているプロキシに送信）
export function listProjects() {
  return apiGet<Project[]>("/api/main/projects");
}

// 新規プロジェクトを追加（api/で定義しているプロキシに送信）
export function createProject(input: { name: string; overview?: string | null }) {
  // RPCを使う実装なら /api/projects は内部で rpc/create_project を叩く
  return apiPost<Project | Project[]>("/api/main/projects", input);
}

// プロジェクトの情報（名前、概要）を変更（api/で定義しているプロキシに送信）
export function updateProject(id: string, patch: Partial<Pick<Project, "name"|"overview">>) {
  return apiPatch<Project[]>("/api/main/projects/" + id, patch);
}

// プロジェクトの削除（api/で定義しているプロキシに送信）
export function deleteProject(id: string) {
  return apiDelete("/api/main/projects/" + id);
}
