// src/lib/repository/admin.ts
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/backend";

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member" | "viewer" | string;
  created_at: string | null;
  last_sign_in_at: string | null;
};

export function listAdminUsers() {
  return apiGet<AdminUser[]>("/api/v1/admin/users");
}

export function createAdminUser(input: { email: string; name?: string; role?: "admin" | "developer" | "user" }) {
  return apiPost<{ ok: boolean; user_id: string }>("/api/v1/admin/users", input);
}

export function deleteAdminUser(userId: string) {
  return apiDelete(`/api/v1/admin/users/${userId}`);
}

export function updateAdminUserRole(
  userId: string,
  role: "user" | "developer" | "admin" | "superuser"
) {
  return apiPatch<{ ok: boolean }>(`/api/v1/admin/users/${userId}/role`, { role });
}
