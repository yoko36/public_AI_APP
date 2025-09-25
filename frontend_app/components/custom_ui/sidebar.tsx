"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronDown, Settings, MoreHorizontal, FolderPlus, MessageSquarePlus, AlertTriangle, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import { NewModal } from "@/components/custom_ui/new_dialog";
// 状態管理
import { useStore } from "@/store/state";

// DB連携用フック
import { useProjects } from "@/hooks/useProjects";
import { useThreads } from "@/hooks/useThreads";
import type { Project } from "@/types/chat-app";

// selectorの既定値を設定し、新規配列を生成しないようにする
const EMPTY_IDS: ReadonlyArray<string> = Object.freeze([]);

export function Sidebar() {
  const router = useRouter();
  // 選択中のスレッドが含まれているプロジェクト（開いたままにするため）
  const [openProjectValue, setOpenProjectValue] = useState<string>("");

  // 現在のユーザID
  const currentUserId = useStore((s) => (s as any).currentUserId) ?? "1";

  // DBからプロジェクト取得（Zustand ストアへは useProjects 内で反映）
  const { projects, addProject } = useProjects(currentUserId);

  // 選択中のスレッド
  const selectThread = useStore((s) => s.selectThread);

  // 新規プロジェクトを登録
  const registerNewProject = useCallback(
    (name: string, overview?: string) => addProject(name, overview),
    [addProject]
  );

  // ページ遷移関数（スレッド移動時）
  const navigateToPage = (threadId: string) => {
    selectThread(threadId); // 選択中のスレッドを更新
    router.push(`/agent/chat/${encodeURIComponent(threadId)}`); // ページ遷移
  };

  return (
    <aside className="w-[15%] min-w-60 bg-gray-100 text-foreground border-r border-border h-screen flex flex-col text-lg">
      <div className="p-6 border-b border-border space-y-4">
        <h2 className="text-2xl font-semibold">チャット</h2>
        <NewModal
          onCreate={registerNewProject}
          buttonName="新規プロジェクト"
          isOverviewNeeded={true}
          icon={<FolderPlus className="w-4 h-4 mr-2" />}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <Accordion
          type="single"
          collapsible
          className="w-full space-y-2"
          value={openProjectValue}
          onValueChange={(v) => setOpenProjectValue(v ?? "")}
        >
          {(projects ?? []).map((project) => (
            <ProjectSection
              key={String(project.id)}
              project={project}
              onNewThreadNavigate={navigateToPage}
              ensureOpen={(val) => setOpenProjectValue(val ?? "")}
            />
          ))}
        </Accordion>
      </div>
    </aside>
  );
}

// =========================
// // 子コンポーネント：各プロジェクト配下のスレッド取得・表示
// =========================
function ProjectSection({
  project,
  onNewThreadNavigate,  // 指定したスレッドに遷移
  ensureOpen, // 開いているプロジェクトを指定（指定しているスレッドを含むプロジェクト）
}: {
  project: Project;
  onNewThreadNavigate: (threadId: string) => void;
  ensureOpen: (value: string) => void;
}) {
  // スレッド一覧とスレッドの追加フックを取得
  const { threads, addThread } = useThreads(String(project.id));
  // 選択中のスレッドID
  const selectedThreadId = useStore((s: any) => s.selectedThreadId as string | undefined);
  // スレッド作成関数
  const handleCreateThread = useCallback(
    async (name: string) => {
      const value = `project-${String(project.id)}`;
      ensureOpen(value);
      const created = await addThread(name);  // スレッド追加
      if (created && (created as any).id) {
        onNewThreadNavigate(String((created as any).id)); // 作成したスレッドに遷移
      }
    },
    [addThread, onNewThreadNavigate]
  );

  return (
    <AccordionItem
      value={`project-${String(project.id)}`}
      className="border rounded-xl overflow-hidden"
    >
      <AccordionTrigger className="group bg-muted rounded-xl px-4 py-3 text-xl font-semibold hover:bg-muted/70 data-[state=open]:bg-muted/90">
        <div className="flex items-center w-full justify-between">
          <span>{project.name}</span>
          <span className="ml-auto inline-flex items-center">
            <ChevronRight className="w-4 h-4 text-foreground transition-opacity duration-200 group-data-[state=open]:opacity-0" />
            <ChevronDown className="w-4 h-4 text-foreground transition-opacity duration-200 opacity-0 group-data-[state=open]:opacity-100 -ml-4" />
          </span>
        </div>
      </AccordionTrigger>

      <AccordionContent className="px-4 py-2 space-y-1 bg-background">
        <div className="text-lg">
          <NewModal
            className="text-lg"
            onCreate={handleCreateThread}
            buttonName="新しいチャット"
            isOverviewNeeded={false}
            icon={<MessageSquarePlus className="w-4 h-4 mr-2" />}
          />
        </div>

        <p className="pt-2 text-lg text-muted-foreground leading-none select-none">
          チャット
        </p>

        {(threads ?? EMPTY_IDS).map((thread: any) => {
          const selected = String(selectedThreadId) === String(thread.id);
          return (
            <div
              role="button"
              tabIndex={0}
              className={[
                "group w-full px-3 py-2 rounded-md flex items-center justify-between text-lg transition-colors",
                selected
                  ? "bg-primary/25 text-primary font-semibold shadow-sm ring-1 ring-primary/30"
                  : "hover:bg-muted",
              ].join(" ")}
              key={String(thread.id)}
              onClick={() => {
                ensureOpen(`project-${String(project.id)}`);
                onNewThreadNavigate(String(thread.id));
              }}
            >
              <span className="truncate">{thread.name}</span>
              {/* ▼ 右端『…』メニュー（ホバーで見える） */}
              <ThreadMenu threadId={String(thread.id)} currentName={String(thread.name ?? "")} />
            </div>
          );
        })}
        <div className="pt-2">
          <ProjectMenu project={project} />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

// =========================
// スレッドメニュー（リネーム／削除）
// =========================
function ThreadMenu({ threadId, currentName }: { threadId: string; currentName: string }) {
  const { editThreadName, removeThread } = useThreads(); // projectId なしで関数だけ使う

  // モーダル状態
  const [openRename, setOpenRename] = useState(false);
  const [renameValue, setRenameValue] = useState(currentName);
  const [openDelete, setOpenDelete] = useState(false);

  // メニュー制御（“閉じてから開く”を保証）
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          onClick={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => e.preventDefault()} // 自動フォーカス返しを抑止
        >
          {/* 名前変更：まずメニューを閉じ、次フレームで Dialog を開く */}
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              requestAnimationFrame(() => {
                setRenameValue(currentName);
                setOpenRename(true);  // 名前変更モーダルの表示
              });
            }}
          >
            名前変更
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* 削除：同じく“閉じ→次フレームで開く” */}
          <DropdownMenuItem
            className="text-red-600 focus:text-red-600"
            onSelect={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              requestAnimationFrame(() => {
                setOpenDelete(true);
              });
            }}
          >
            削除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* リネーム用モーダル（メニューの外に配置） */}
      <Dialog open={openRename} onOpenChange={setOpenRename}>
        <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>スレッド名を変更</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Label htmlFor="thread-new-name">新しい名前</Label>
            <Input
              id="thread-new-name"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && renameValue.trim()) {
                  await editThreadName(threadId, renameValue.trim());
                  setOpenRename(false);
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenRename(false)}>
              キャンセル
            </Button>
            <Button
              onClick={async () => {
                if (!renameValue.trim()) return;
                await editThreadName(threadId, renameValue.trim());
                setOpenRename(false);
              }}
            >
              変更
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認モーダル（同様にメニューの外） */}
      <AlertDialog open={openDelete} onOpenChange={setOpenDelete}>
        <AlertDialogContent className="sm:max-w-[420px] rounded-2xl border border-destructive/20 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="mt-1 inline-flex size-9 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <div className="flex-1">
              <AlertDialogHeader className="space-y-1">
                <AlertDialogTitle className="text-destructive">スレッドを削除します</AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground">
                  この操作は取り消せません。
                </AlertDialogDescription>
              </AlertDialogHeader>
            </div>
          </div>
          <AlertDialogFooter className="sm:justify-end gap-2">
            <AlertDialogCancel className="mt-2 sm:mt-0">キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={async () => {
                await removeThread(threadId);
              }}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ==================================================
// // プロジェクトメニュー（名前、概要変更　/　削除）
// ==================================================
function ProjectMenu({ project }: { project: Project }) {
  const { editProject, removeProject } = useProjects(String(project.userId ?? "")); // userId が無い型なら適当に
  const [openEdit, setOpenEdit] = useState(false);
  const [name, setName] = useState(project.name);
  const [overview, setOverview] = useState(project.overview ?? "");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted">
            <Settings className="w-4 h-4" />
            <span className="text-sm">プロジェクト設定</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpenEdit(true); }}>
            名前・概要を変更
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <ConfirmDeleteProject id={String(project.id)} removeProject={removeProject} />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 編集ダイアログ */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="z-[70]">
          <DialogHeader>
            <DialogTitle>プロジェクトを編集</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label>名前</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>概要</Label>
              <Input value={overview} onChange={(e) => setOverview(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenEdit(false)}>
              キャンセル
            </Button>
            <Button
              onClick={async () => {
                await editProject(String(project.id), { name, overview: overview || undefined });
                setOpenEdit(false);
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ==================================================
// // 削除時の確認モーダル
// ==================================================
function ConfirmDeleteProject({
  id,
  removeProject,
}: {
  id: string;
  removeProject: (id: string) => Promise<boolean>;
}) {
  return (
    <AlertDialog>
      {/* Dropdown の項目自体をトリガーにする。onSelect でデフォルト動作を抑止 */}
      <AlertDialogTrigger asChild>
        <DropdownMenuItem
          className="text-red-600 focus:text-red-600"
          onSelect={(e) => e.preventDefault()}
        >
          削除
        </DropdownMenuItem>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-[420px] rounded-2xl border border-destructive/20 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="mt-1 inline-flex size-9 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
          <div className="flex-1">
            <AlertDialogHeader className="space-y-1">
              <AlertDialogTitle className="text-destructive">プロジェクトを削除します</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                この操作は取り消せません。プロジェクト配下のスレッドやメッセージも（実装により）削除される場合があります。
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>
        </div>
        <AlertDialogFooter className="sm:justify-end gap-2">
          <AlertDialogCancel className="mt-2 sm:mt-0">キャンセル</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            onClick={async () => {
              await removeProject(id);
            }}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            削除する
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
