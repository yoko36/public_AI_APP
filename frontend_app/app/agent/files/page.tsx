"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { AppRail } from "@/components/custom_ui/app-rail";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { Filter, Link2, Link2Off, Loader2, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";

// ============ 型 ============
export type ProjectLite = { id: string; name: string };
export type ThreadLite = { id: string; name: string; projectId: string };
export type AttachmentImage = {
  id: string;
  storage_path: string;
  mime: string;
  size: number;
  title: string | null;
  created_at: string;
  project_id: string | null;
  thread_id: string | null;
  signedUrl?: string | null; // FastAPI 側が返す場合
};

// ============ 小さなAPIクライアント（/api/file 経由） ============
const API_BASE = "/api/file"; // Next.js 内のプロキシ（app/api/file/route.ts）

async function apiJson<T>(path: string, init?: RequestInit & { params?: Record<string, string | number | undefined | null> }): Promise<T> {
  const usp = new URLSearchParams();
  usp.set("path", path.replace(/^\/+/, ""));
  if (init?.params) {
    for (const [k, v] of Object.entries(init.params)) {
      if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
    }
  }
  const url = `${API_BASE}?${usp.toString()}`;
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : (res.text() as any)) as Promise<T>;
}

// リスト取得
async function listProjects(): Promise<ProjectLite[]> {
  // FastAPI 側: GET /api/v1/projects → [{id,name,...}]
  return apiJson<ProjectLite[]>("projects", { method: "GET" });
}
async function listThreads(projectId: string): Promise<ThreadLite[]> {
  // FastAPI 側: GET /api/v1/threads?project_id=... → [{id,name,projectId}]
  return apiJson<ThreadLite[]>("threads", { method: "GET", params: { projectId: projectId } });
}
async function listImages(opts: { projectId?: string; threadId?: string }): Promise<AttachmentImage[]> {
  // FastAPI 側: GET /api/v1/attachments?project_id=&thread_id= → attachments 配列
  const rows = await apiJson<any[]>("files", { method: "GET", params: { project_id: opts.projectId, thread_id: opts.threadId } });
  // 画像のみ抽出 + フィールド名の揺れ(signed_url/url)吸収
  return rows
    .filter((r) => typeof r?.mime === "string" && r.mime.startsWith("image/"))
    .map((r) => ({
      id: r.id,
      storage_path: r.storage_path ?? r.path ?? r.key,
      mime: r.mime,
      size: r.size ?? 0,
      title: r.title ?? null,
      created_at: r.created_at ?? new Date().toISOString(),
      project_id: r.project_id ?? null,
      thread_id: r.thread_id ?? null,
      signedUrl: r.signedUrl ?? r.signed_url ?? r.url ?? null,
    })) as AttachmentImage[];
}

// 更新/削除
async function relinkAttachment(id: string, payload: { project_id: string | null; thread_id: string | null }) {
  // FastAPI 側: PATCH /api/v1/attachments/{id}
  await apiJson("files/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(payload) });
}
async function removeAttachment(id: string) {
  // FastAPI 側: DELETE /api/v1/attachments/{id}
  await apiJson("files/" + encodeURIComponent(id), { method: "DELETE" });
}

// ============ ページ本体 ============
export default function AgentFilesPage() {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [threads, setThreads] = useState<ThreadLite[]>([]);
  const [images, setImages] = useState<AttachmentImage[]>([]);

  const [loading, setLoading] = useState(true);
  const [projectFilter, setProjectFilter] = useState<string | "all">("all");
  const [threadFilter, setThreadFilter] = useState<string | "all">("all");
  const [keyword, setKeyword] = useState("");

  const [relLinkOpen, setRelLinkOpen] = useState(false);
  const [targetForRelink, setTargetForRelink] = useState<AttachmentImage | null>(null);
  const [newProjectId, setNewProjectId] = useState<string | "none" | "">("");
  const [newThreadId, setNewThreadId] = useState<string | "none" | "">("");

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AttachmentImage | null>(null);

  // 初期ロード
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [prjs, imgs] = await Promise.all([
          listProjects(),
          listImages({}),
        ]);
        if (!mounted) return;
        setProjects(prjs);
        setImages(imgs);
      } catch (e: any) {
        toast({ variant: "destructive", title: "読み込みに失敗", description: e?.message ?? String(e) });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [toast]);

  // プロジェクト選択 → スレッド候補更新
  useEffect(() => {
    (async () => {
      if (projectFilter === "all") { setThreads([]); setThreadFilter("all"); return; }
      try {
        const ts = await listThreads(projectFilter);
        setThreads(ts);
        setThreadFilter("all");
      } catch (e: any) {
        toast({ variant: "destructive", title: "スレッド取得に失敗", description: e?.message ?? String(e) });
      }
    })();
  }, [projectFilter, toast]);

  // フィルタ後
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return images.filter(img => {
      if (projectFilter !== "all" && img.project_id !== projectFilter) return false;
      if (threadFilter !== "all" && img.thread_id !== threadFilter) return false;
      if (kw) {
        const hay = `${img.title ?? ""} ${img.storage_path}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [images, projectFilter, threadFilter, keyword]);

  // 再読み込み（現在のフィルタをAPIに反映）
  const refresh = async () => {
    setLoading(true);
    try {
      const imgs = await listImages({
        projectId: projectFilter === "all" ? undefined : projectFilter,
        threadId: threadFilter === "all" ? undefined : threadFilter,
      });
      setImages(imgs);
    } catch (e: any) {
      toast({ variant: "destructive", title: "再読み込みに失敗", description: e?.message ?? String(e) });
    } finally { setLoading(false); }
  };

  // 紐づけ変更（モーダル開く）
  const openRelink = (img: AttachmentImage) => {
    setTargetForRelink(img);
    setNewProjectId(img.project_id ?? "none");
    setNewThreadId(img.thread_id ?? "none");
    setRelLinkOpen(true);
  };

  // 紐づけ保存（API反映）
  const applyRelink = async () => {
    if (!targetForRelink) return;
    startTransition(async () => {
      try {
        const pid = newProjectId === "none" || newProjectId === "" ? null : newProjectId;
        const tid = newThreadId === "none" || newThreadId === "" ? null : newThreadId;
        await relinkAttachment(targetForRelink.id, { project_id: pid, thread_id: tid });
        setImages(prev => prev.map(it => it.id === targetForRelink.id ? { ...it, project_id: pid, thread_id: tid } : it));
        toast({ title: "紐づけを更新しました" });
        setRelLinkOpen(false);
      } catch (e: any) {
        toast({ variant: "destructive", title: "更新に失敗", description: e?.message ?? String(e) });
      }
    });
  };

  // 削除確認
  const askDelete = (img: AttachmentImage) => { setDeleteTarget(img); setConfirmDeleteOpen(true); };

  // 削除実行（API→ローカル更新）
  const doDelete = async () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      try {
        await removeAttachment(deleteTarget.id);
        setImages(prev => prev.filter(x => x.id !== deleteTarget.id));
        toast({ title: "画像を削除しました" });
      } catch (e: any) {
        toast({ variant: "destructive", title: "削除に失敗", description: e?.message ?? String(e) });
      } finally { setConfirmDeleteOpen(false); }
    });
  };

  return (
    <div className="relative flex h-dvh w-full overflow-hidden">
      <AppRail />

      <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto w-full max-w-7xl">
          {/* ヘッダ */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">ファイル管理</h1>
              <p className="text-sm text-muted-foreground">ユーザに紐づく画像の一覧、プロジェクト/スレッドでの絞り込み、紐づけ変更と削除ができます。</p>
            </div>
            <div className="flex items-center gap-2">
              <Input placeholder="タイトル検索…" className="w-48" value={keyword} onChange={(e) => setKeyword(e.currentTarget.value)} />
              <Button variant="outline" onClick={refresh} disabled={loading || isPending}>
                {loading || isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}再読み込み
              </Button>
            </div>
          </div>

          {/* フィルターバー */}
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium flex items-center gap-2"><Filter className="h-4 w-4" /> 表示の絞り込み</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label>プロジェクト</Label>
                <Select value={projectFilter} onValueChange={v => setProjectFilter(v as any)}>
                  <SelectTrigger><SelectValue placeholder="すべて" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">すべて</SelectItem>
                    {projects.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>スレッド</Label>
                <Select value={threadFilter} onValueChange={v => setThreadFilter(v as any)} disabled={projectFilter === "all"}>
                  <SelectTrigger><SelectValue placeholder={projectFilter === "all" ? "プロジェクトを選択" : "すべて"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">すべて</SelectItem>
                    {threads.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>ヒント</Label>
                <p className="text-sm text-muted-foreground">プロジェクト→スレッドの順に絞れます。未紐づけは「すべて」で確認できます。</p>
              </div>
            </CardContent>
          </Card>

          {/* グリッド */}
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Card key={i} className="overflow-hidden">
                  <Skeleton className="h-40 w-full" />
                  <CardContent className="p-4 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map(img => (
                <Card key={img.id} className="group overflow-hidden">
                  <div className="relative aspect-video w-full bg-muted/40">
                    {img.signedUrl ? (
                      <Image src={img.signedUrl} alt={img.title ?? img.storage_path} fill className="object-cover" sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">🖼️</div>
                    )}
                    {/* カード右上メニュー */}
                    <div className="absolute right-2 top-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="secondary" className="h-9 w-9 rounded-full bg-white/80 backdrop-blur group-hover:opacity-100">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuLabel>操作</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openRelink(img)}>
                            <Link2 className="mr-2 h-4 w-4" /> 紐づけを変更
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => askDelete(img)}>
                            <Trash2 className="mr-2 h-4 w-4" /> 画像を削除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <CardHeader className="pb-2">
                    <CardTitle className="truncate text-base" title={img.title ?? img.storage_path}>
                      {img.title ?? img.storage_path}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-sm text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{(img.size / 1024).toFixed(1)} KB</Badge>
                      <Badge variant="outline">{img.mime}</Badge>
                      {img.project_id ? <Badge>prj:{short(img.project_id)}</Badge> : <Badge variant="outline"><Link2Off className="mr-1 h-3 w-3"/>未紐づけ</Badge>}
                      {img.thread_id && <Badge variant="secondary">th:{short(img.thread_id)}</Badge>}
                    </div>
                  </CardContent>
                  <CardFooter className="justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => openRelink(img)}><Link2 className="mr-2 h-4 w-4"/>紐づけ</Button>
                    <Button size="sm" variant="destructive" onClick={() => askDelete(img)}><Trash2 className="mr-2 h-4 w-4"/>削除</Button>
                  </CardFooter>
                </Card>
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full rounded-xl border p-8 text-center text-sm text-muted-foreground">
                  条件に一致する画像がありません。
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* 紐づけ変更ダイアログ */}
      <Dialog open={relLinkOpen} onOpenChange={(v) => setRelLinkOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>紐づけ先を変更</DialogTitle>
            <DialogDescription>画像を関連付けるプロジェクトとスレッドを選択してください（空欄で未紐づけ）。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>プロジェクト</Label>
              <Select value={newProjectId ?? "none"} onValueChange={async (v) => {
                setNewProjectId(v);
                if (v === "none" || v === "") { setNewThreadId("none"); return; }
                try {
                  const ts = await listThreads(v);
                  // 直前の newThreadId がこのプロジェクトに属していなければリセット
                  setNewThreadId(prev => (ts.some(t => t.id === prev) ? prev : "none"));
                } catch (e: any) {
                  toast({ variant: "destructive", title: "スレッド取得に失敗", description: e?.message ?? String(e) });
                }
              }}>
                <SelectTrigger><SelectValue placeholder="選択してください"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">（未設定）</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>スレッド</Label>
              <Select value={newThreadId ?? "none"} onValueChange={setNewThreadId} disabled={!newProjectId || newProjectId === "none"}>
                <SelectTrigger><SelectValue placeholder="プロジェクトを先に選択"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">（未設定）</SelectItem>
                  {/* newProjectId が選ばれていたら、そのプロジェクトのスレッド候補 */}
                  {threads.filter(t => t.projectId === newProjectId).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRelLinkOpen(false)}>キャンセル</Button>
            <Button onClick={applyRelink} disabled={isPending}>{isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認 */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>画像を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              紐づけ先すべてで削除されます。関連するドキュメントやベクトルはサーバ側の処理/DB制約に従い連鎖削除されます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={doDelete}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4"/>}
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============ ヘルパ ============
function short(id: string, n = 6) { return id.slice(0, n); }
