"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AppRail } from "@/components/custom_ui/app-rail";
import { useStore } from "@/store/state";
import { MessageSquare, FolderOpen, Code2, History, FileText, User } from "lucide-react";

const appName = "agent";

export default function StartPage() {
  const router = useRouter();
  const selectedThreadId = useStore((s) => s.selectedThreadId);

  // 共通 push（/{userId}/{subpath}）
  const push = (subpath: string) => router.push(`${appName}${subpath}`);

  // レールと同じ機能を「大きめタイルのボタン」で並べる
  const tiles = useMemo(
    () => [
      {
        label: "チャット",
        icon: MessageSquare,
        onClick: () =>
          push(
            selectedThreadId
              ? `/chat/${encodeURIComponent(selectedThreadId)}`
              : "/chat/placeholder"
          ),
      },
      { label: "画像・ファイル", icon: FolderOpen, onClick: () => push("/files") },
      { label: "カスタム関数", icon: Code2, onClick: () => push("/functions") },
      { label: "履歴", icon: History, onClick: () => push("/history") },
      { label: "論文推敲", icon: FileText, onClick: () => push("/paper") },
      { label: "ユーザ管理", icon: User, onClick: () => push("/admin") },
    ],
    [selectedThreadId]
  );

  return (
    <div className="relative flex h-dvh w-full overflow-hidden">
      {/* 左ナビ（固定） */}
      <AppRail />

      {/* 背景：ログインページと同系色のグラデ＆発光ブラー */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-fuchsia-500 to-rose-500 opacity-60" />
        <div className="absolute -top-28 -left-28 h-80 w-80 rounded-full bg-white/30 blur-3xl" />
        <div className="absolute -bottom-28 -right-28 h-96 w-96 rounded-full bg-white/20 blur-3xl" />
        {/* 薄いノイズ／グリッド感（好みで） */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:24px_24px]" />
      </div>

      {/* メイン */}
      <main className="flex-1 overflow-y-auto px-6 py-8 md:px-10">
        <div className="mx-auto w-full max-w-7xl">
          {/* ヘッダ：ガラスカード */}
          <header className="mb-8 rounded-2xl border border-white/20 bg-white/70 p-6 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-white/10">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">スタート</h1>
            <p className="mt-2 text-slate-700/80 dark:text-white/80">やりたいことを選んでください。</p>
          </header>

          {/* タイル：ガラスカード + ホバーアニメ */}
          <section
            aria-label="アプリ機能タイル"
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {tiles.map(({ label, icon: Icon, onClick }) => (
              <Button
                key={label}
                onClick={onClick}
                variant="outline"
                aria-label={label}
                className="h-48 w-full select-none rounded-3xl border-white/30 bg-white/80 shadow-xl backdrop-blur-xl transition duration-200 ease-out hover:translate-y-[-2px] hover:shadow-2xl focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-white/10 dark:bg-white/10"
              >
                <div className="flex h-full w-full flex-col items-center justify-center gap-4">
                  <Icon className="h-24 w-24 sm:h-28 sm:w-28 lg:h-32 lg:w-32" strokeWidth={1} />
                  <span className="text-2xl font-semibold text-slate-900 dark:text-white">{label}</span>
                </div>
              </Button>
            ))}
          </section>

          {/* 補助：ショートカットやヒント（任意） */}
          <section className="mt-8 rounded-2xl border border-white/20 bg-white/70 p-4 text-sm text-slate-700/90 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-white/10 dark:text-white/80">
            <ul className="list-disc space-y-1 pl-5">
              <li>チャットは直近のスレッドを表示します。</li>
              <li>Esc で現在のモーダルやポップオーバーを閉じます。</li>
              <li>Tab / Shift+Tab でタイル間を移動できます。</li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
