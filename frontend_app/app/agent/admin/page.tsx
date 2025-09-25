"use client";

import { useEffect, useMemo, useState } from "react";
import {
  listAdminUsers,
  createAdminUser,
  // ★ 変更: 後述のリポジトリ追記分
  deleteAdminUser,
  updateAdminUserRole,
  type AdminUser,
} from "@/lib/repository/admin";
import { listProjects } from "@/lib/repository/projects";
import { listThreads } from "@/lib/repository/threads";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  RefreshCcw,
  ChevronRight,
  // ★ 変更: ソート＆操作アイコン
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  Trash2,
  Shield,
} from "lucide-react";

// ★ 変更: 破壊的操作に AlertDialog、通常モーダルに Dialog を使用
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// customUI
import { AppRail } from "@/components/custom_ui/app-rail";

import type { Thread, Project } from "@/types/chat-app";

// ==== 日付フォーマット関数 ====

// 日本時間で YYYY-MM-DD
function formatDateJP(dateString?: string | null): string {
  if (!dateString) return "-";
  const d = new Date(dateString);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const da = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${da}`;
}

// 日本時間で YYYY-MM
function formatMonthJP(dateString?: string | null): string {
  if (!dateString) return "-";
  const d = new Date(dateString);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

// 相対時間
function formatLastLogin(dateString?: string | null): string {
  if (!dateString) return "-";
  const date = new Date(dateString);
  const now = new Date();

  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "たった今";

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}秒前`;
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffHour < 24) return `${diffHour}時間前`;
  if (diffDay < 30) return `${diffDay}日前`;
  return formatMonthJP(dateString);
}

type ProjectWithOwner = Project & { user_id?: string };
// ★ 変更: 役割の型を定義
type Role = "user" | "developer" | "admin" | "superuser";

export default function AdminPage() {
  // ---- Users ----
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [uLoading, setULoading] = useState(false);

  // Create user form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Exclude<Role, "superuser">>("user"); // superuser は作成UIでは非表示

  // ---- Projects & Threads ----
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [pLoading, setPLoading] = useState(false);
  const [tLoading, setTLoading] = useState(false);

  // ---- Tabs ----
  const [tab, setTab] = useState<"users" | "projects" | "threads">("users");

  // ★ 変更: ソート状態
  const [sortKey, setSortKey] = useState<"name" | "role" | "email">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const collJa = useMemo(
    () => new Intl.Collator("ja", { numeric: true, sensitivity: "base" }),
    []
  );
  const roleRank: Record<Role, number> = {
    superuser: 3,
    admin: 2,
    developer: 1,
    user: 0,
  };

  // ★ 変更: 操作モーダルの状態（削除／権限変更）
  const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [userToChangeRole, setUserToChangeRole] = useState<AdminUser | null>(null);
  const [newRole, setNewRole] = useState<Role>("user");
  const [changingRole, setChangingRole] = useState(false);

  // ========== Users ==========
  async function refreshUsers() {
    setULoading(true);
    try {
      const data = await listAdminUsers();
      setUsers(data);
    } catch (e: any) {
      toast?.error(e.message ?? "ユーザ一覧の取得に失敗しました");
    } finally {
      setULoading(false);
    }
  }

  async function handleCreateUser() {
    if (!email) return toast?.warning("メールアドレスを入力してください");
    if (!role) return toast?.warning("新規ユーザに権限(user, developer, admin)を与えてください");
    try {
      await createAdminUser({ email, name, role });
      toast?.success("ユーザを作成しました");
      setEmail("");
      setName("");
      setRole("user");
      refreshUsers();
    } catch (e: any) {
      toast?.error(e.message ?? "ユーザ作成に失敗しました");
    }
  }

  // ========== Projects & Threads ==========
  async function refreshProjects(userId: string) {
    if (!userId) {
      setProjects([]);
      return;
    }
    setPLoading(true);
    try {
      const data = await listProjects(); // NOTE: API 側で userId による絞込が理想
      setProjects(data);
    } catch (e: any) {
      toast?.error(e.message ?? "プロジェクト取得に失敗しました");
    } finally {
      setPLoading(false);
    }
  }

  async function refreshThreads(pid: string) {
    if (!pid) return setThreads([]);
    setTLoading(true);
    try {
      const data = await listThreads(pid);
      setThreads(data);
    } catch (e: any) {
      toast?.error(e.message ?? "スレッド取得に失敗しました");
    } finally {
      setTLoading(false);
    }
  }

  // ---- Effects ----
  useEffect(() => {
    refreshUsers();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      refreshProjects(selectedUserId);
    } else {
      setProjects([]);
      setSelectedProjectId("");
    }
  }, [selectedUserId]);

  const projectsOfUser = useMemo(() => {
    if (!selectedUserId) return [] as ProjectWithOwner[];
    return (projects as ProjectWithOwner[]).filter(
      (p) => !p.user_id || p.user_id === selectedUserId
    );
  }, [projects, selectedUserId]);

  useEffect(() => {
    if (!selectedUserId) return;
    if (!projectsOfUser.length) {
      setSelectedProjectId("");
      return;
    }
    setSelectedProjectId((prev) =>
      projectsOfUser.some((p) => p.id === prev) ? prev : projectsOfUser[0].id
    );
  }, [projectsOfUser, selectedUserId]);

  useEffect(() => {
    if (selectedProjectId) {
      refreshThreads(selectedProjectId);
    } else {
      setThreads([]);
    }
  }, [selectedProjectId]);

  const selectedProject = useMemo(
    () => projectsOfUser.find((p) => p.id === selectedProjectId),
    [projectsOfUser, selectedProjectId]
  );

  // ---- UI helpers ----
  // ★ 変更: 役割の見やすいフォント＆強調（等幅・大文字・字間）
  const roleBadge = (r: Role) => {
    const common = "font-mono uppercase tracking-wider text-[12px]";
    if (r === "superuser")
      return (
        <Badge variant="destructive" className={`${common} ring-1 ring-destructive`}>
          superuser
        </Badge>
      );
    if (r === "admin")
      return (
        <Badge variant="destructive" className={common}>
          admin
        </Badge>
      );
    if (r === "developer")
      return (
        <Badge variant="secondary" className={common}>
          developer
        </Badge>
      );
    return (
      <Badge variant="outline" className={common}>
        user
      </Badge>
    );
  };

  // ★ 変更: ソートユーティリティ
  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  function SortIcon({ k }: { k: typeof sortKey }) {
    if (sortKey !== k) return <ChevronsUpDown className="h-4 w-4 opacity-60" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-4 w-4" />
    ) : (
      <ArrowDown className="h-4 w-4" />
    );
  }
  const sortedUsers = useMemo(() => {
    const arr = [...users];
    arr.sort((a, b) => {
      if (sortKey === "name") {
        const cmp = collJa.compare(a.name ?? "", b.name ?? "");
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "email") {
        const cmp = collJa.compare(a.email ?? "", b.email ?? "");
        return sortDir === "asc" ? cmp : -cmp;
      }
      // role
      const ra = roleRank[(a.role as Role) ?? "user"] ?? -1;
      const rb = roleRank[(b.role as Role) ?? "user"] ?? -1;
      const cmp = ra - rb; // 弱→強 なので後で反転
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [users, sortKey, sortDir, collJa]);

  async function handleConfirmDelete() {
    if (!userToDelete) return;
    setDeleting(true);
    try {
      await deleteAdminUser(userToDelete.id);
      toast.success("ユーザを削除しました");
      setUserToDelete(null);
      refreshUsers();
    } catch (e: any) {
      toast.error(e.message ?? "ユーザ削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }

  // ★ 変更: 権限変更実行
  async function handleConfirmChangeRole() {
    if (!userToChangeRole) return;
    setChangingRole(true);
    try {
      await updateAdminUserRole(userToChangeRole.id, newRole);
      toast.success("権限を更新しました");
      setUserToChangeRole(null);
      refreshUsers();
    } catch (e: any) {
      toast.error(e.message ?? "権限更新に失敗しました");
    } finally {
      setChangingRole(false);
    }
  }

  return (
    <div className="flex">
      <AppRail />
      <main className="flex-1 p-8 max-w-7xl mx-auto space-y-8">      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">管理ページ</h1>
        </div>
        <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
          {selectedUserId && (
            <>
              <span className="px-2 py-1 rounded-full bg-muted">
                選択中ユーザ: <code className="font-mono">{selectedUserId}</code>
              </span>
              {selectedProjectId && (
                <span className="px-2 py-1 rounded-full bg-muted">
                  選択中プロジェクト:{" "}
                  <code className="font-mono">{selectedProjectId}</code>
                </span>
              )}
            </>
          )}
        </div>
      </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="space-y-6">
          <TabsList className="bg-muted/60 p-1 rounded-xl backdrop-blur">
            <TabsTrigger value="users" className="px-4">
              ユーザ
            </TabsTrigger>
            <TabsTrigger value="projects" className="px-4" disabled={!selectedUserId}>
              プロジェクト
            </TabsTrigger>
            <TabsTrigger value="threads" className="px-4" disabled={!selectedProjectId}>
              スレッド
            </TabsTrigger>
          </TabsList>

          {/* ===== Users Tab ===== */}
          <TabsContent value="users" className="space-y-6">
            {/* 作成フォーム */}
            <Card className="rounded-2xl border shadow-sm">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">新規ユーザ作成</h2>
                </div>
                <div className="grid md:grid-cols-4 gap-4">
                  <div className="grid gap-2">
                    <Label>メールアドレス</Label>
                    <Input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="user@example.com"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>ユーザ名</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="任意"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>ロール</Label>
                    <Select value={role} onValueChange={(v) => setRole(v as any)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="選択してください" />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-white text-gray-900 shadow-lg border">
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="developer">developer</SelectItem>
                        <SelectItem value="user">user</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button onClick={handleCreateUser}>作成</Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ユーザ一覧 */}
            <Card className="rounded-2xl border shadow-sm">
              <CardContent className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold">ユーザ一覧</h2>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={refreshUsers}
                      disabled={uLoading}
                      title="再読み込み"
                    >
                      <RefreshCcw className="h-5 w-5" />
                      <span className="sr-only">再読み込み</span>
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="py-2 px-4 text-left">ID</th>
                        <th className="py-2 px-4 text-left">
                          <button
                            type="button"
                            onClick={() => toggleSort("email")}
                            className="inline-flex items-center gap-1 hover:opacity-80"
                            title="メールでソート"
                          >
                            Email <SortIcon k="email" />
                          </button>
                        </th>
                        <th className="py-2 px-4 text-left">
                          <button
                            type="button"
                            onClick={() => toggleSort("name")}
                            className="inline-flex items-center gap-1 hover:opacity-80"
                            title="名前（あいうえお順）でソート"
                          >
                            Name <SortIcon k="name" />
                          </button>
                        </th>
                        <th className="py-2 px-4 text-left">
                          <button
                            type="button"
                            onClick={() => toggleSort("role")}
                            className="inline-flex items-center gap-1 hover:opacity-80"
                            title="権限の強さでソート"
                          >
                            Role <SortIcon k="role" />
                          </button>
                        </th>
                        <th className="py-2 px-4 text-left">作成日</th>
                        <th className="py-2 px-4 text-left">最終ログイン</th>
                        <th className="py-2 px-4 text-left">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedUsers.map((u) => (
                        <tr
                          key={u.id}
                          className="odd:bg-muted/20 hover:bg-muted/30 transition-colors"
                        >
                          <td className="py-2 px-4 font-mono text-xs">{u.id}</td>
                          <td className="py-2 px-4">{u.email}</td>
                          <td className="py-2 px-4">{u.name}</td>
                          <td className="py-2 px-4">
                            <div className="inline-flex items-center gap-1">
                              <span className="inline-flex">{roleBadge(u.role as Role)}</span>
                              {/* ちょいアイコンで視認性UP */}
                              {u.role === "admin" || u.role === "superuser" ? (
                                <Shield className="h-4 w-4 opacity-70" />
                              ) : null}
                            </div>
                          </td>
                          <td className="py-2 px-4">{formatDateJP(u.created_at as any)}</td>
                          <td className="py-2 px-4">
                            {formatLastLogin(u.last_sign_in_at as any)}
                          </td>
                          <td className="py-2 px-4">
                            <div className="flex items-center gap-2">
                              {/* ★ 変更: 権限変更モーダル */}
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setUserToChangeRole(u);
                                  setNewRole((u.role as Role) ?? "user");
                                }}
                              >
                                権限変更
                              </Button>

                              {/* ★ 変更: 削除モーダル起動 */}
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setUserToDelete(u)}
                                className="gap-1"
                              >
                                <Trash2 className="h-4 w-4" />
                                削除
                              </Button>

                              {/* 既存: プロジェクトへ */}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedUserId(u.id);
                                  setTab("projects");
                                }}
                                className="gap-1"
                              >
                                プロジェクトを見る
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!sortedUsers.length && (
                        <tr>
                          <td
                            className="py-6 text-center text-muted-foreground"
                            colSpan={7}
                          >
                            ユーザがいません
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== Projects Tab ===== */}
          <TabsContent value="projects" className="space-y-6">
            <Card className="rounded-2xl border shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">プロジェクト一覧</h2>
                    {selectedUserId && (
                      <span className="text-xs text-muted-foreground">
                        for <code className="font-mono">{selectedUserId}</code>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => refreshProjects(selectedUserId)}
                      disabled={pLoading || !selectedUserId}
                      title="再読み込み"
                    >
                      <RefreshCcw className="h-5 w-5" />
                      <span className="sr-only">再読み込み</span>
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="py-2 px-4 text-left">ID</th>
                        <th className="py-2 px-4 text-left">Name</th>
                        <th className="py-2 px-4 text-left">Overview</th>
                        <th className="py-2 px-4 text-left">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectsOfUser.map((p) => (
                        <tr
                          key={p.id}
                          className="odd:bg-muted/20 hover:bg-muted/30 transition-colors"
                        >
                          <td className="py-2 px-4 font-mono text-xs">{p.id}</td>
                          <td className="py-2 px-4">{p.name}</td>
                          <td className="py-2 px-4">{(p as any).overview ?? "-"}</td>
                          <td className="py-2 px-4">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedProjectId(p.id);
                                setTab("threads");
                              }}
                              className="gap-1"
                            >
                              スレッドを見る
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {!projectsOfUser.length && (
                        <tr>
                          <td
                            className="py-6 text-center text-muted-foreground"
                            colSpan={4}
                          >
                            {selectedUserId
                              ? "このユーザのプロジェクトがありません"
                              : "左のタブでユーザを選択してください"}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== Threads Tab ===== */}
          <TabsContent value="threads" className="space-y-6">
            <Card className="rounded-2xl border shadow-sm">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">スレッド一覧</h2>
                    {selectedProject && (
                      <span className="text-xs text-muted-foreground">
                        in <code className="font-mono">{selectedProject.name}</code>
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => refreshThreads(selectedProjectId)}
                    disabled={tLoading || !selectedProjectId}
                    title="再読み込み"
                  >
                    <RefreshCcw className="h-5 w-5" />
                    <span className="sr-only">再読み込み</span>
                  </Button>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="py-2 px-4 text-left">Thread ID</th>
                        <th className="py-2 px-4 text-left">Name</th>
                        <th className="py-2 px-4 text-left">Project</th>
                      </tr>
                    </thead>
                    <tbody>
                      {threads.map((t) => (
                        <tr
                          key={t.id}
                          className="odd:bg-muted/20 hover:bg-muted/30 transition-colors"
                        >
                          <td className="py-2 px-4 font-mono text-xs">{t.id}</td>
                          <td className="py-2 px-4">{t.name}</td>
                          <td className="py-2 px-4">
                            {selectedProject?.name ?? selectedProjectId}
                          </td>
                        </tr>
                      ))}
                      {!threads.length && (
                        <tr>
                          <td
                            className="py-6 text-center text-muted-foreground"
                            colSpan={3}
                          >
                            {selectedProjectId
                              ? "スレッドがありません"
                              : "プロジェクトを選択してください"}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ★ 変更: 削除モーダル（AlertDialog） */}
        <AlertDialog open={!!userToDelete} onOpenChange={(o) => !o && setUserToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ユーザを削除しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                この操作は取り消せません。<br />
                <span className="font-semibold">関連するプロジェクト・データがある場合、影響が及ぶ可能性があります。</span>
                <br />
                対象:{" "}
                <code className="font-mono">
                  {userToDelete?.name ?? userToDelete?.email} ({userToDelete?.id})
                </code>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-6">
              <AlertDialogCancel disabled={deleting}>キャンセル</AlertDialogCancel>
              <AlertDialogAction
                // asChild を使わず Action 自体を赤ボタン化
                onClick={handleConfirmDelete}
                // Action は <button>としてレンダリングされます
                // 念のため type を明示
                asChild={false}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 py-2
               bg-red-600 text-white hover:bg-red-700
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2
               disabled:opacity-50"
              >
                {deleting ? "削除中..." : "削除する"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent >
        </AlertDialog>
        {/* ★ 変更: 権限変更モーダル（Dialog） */}
        <Dialog
          open={!!userToChangeRole}
          onOpenChange={(o) => !o && setUserToChangeRole(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>権限の変更</DialogTitle>
              <DialogDescription>
                対象:{" "}
                <code className="font-mono">
                  {userToChangeRole?.name ?? userToChangeRole?.email} (
                  {userToChangeRole?.id})
                </code>
                <br />
                サーバ側での検証（誰が誰に何の権限を付与できるか）は必須です。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <Label>新しい権限</Label>
              <Select
                value={newRole}
                onValueChange={(v) => setNewRole(v as Role)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="権限を選択" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-white text-gray-900 shadow-lg border">
                  {/* superuser 付与は UI 上は表示しますが、サーバで制御してください */}
                  <SelectItem value="superuser">superuser</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                  <SelectItem value="developer">developer</SelectItem>
                  <SelectItem value="user">user</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="mt-6">
              <Button
                variant="ghost"
                onClick={() => setUserToChangeRole(null)}
                disabled={changingRole}
              >
                キャンセル
              </Button>
              <Button onClick={handleConfirmChangeRole} disabled={changingRole} className="bg-blue-600 text-white hover:bg-blue-700">
                {changingRole ? "更新中..." : "付与"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>);
}
