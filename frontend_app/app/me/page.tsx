"use client";

import { useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AppRail } from "@/components/custom_ui/app-rail";
import { useStore } from "@/store/state";
import { MessageSquare, FolderOpen, Code2, History, FileText, User } from "lucide-react";

// 今いるURLから先頭セグメント(userId or "me")を作る
function useUserPrefix() {
  const pathname = usePathname() || "/";
  const m = pathname.match(/^\/([^/]+)/);
  const routeUserId = m?.[1];
  // /[userId]/... にいるならそれを、そうでなければ /me を使う
  return `/${routeUserId ?? "me"}`;
}

export default function StartPage() {
  const router = useRouter();
  const selectedThreadId = useStore((s) => s.selectedThreadId);

  const prefix = useUserPrefix(); // 例: "/me" または "/12345678-...."
  // 共通 push（userId/{アプリケーション名}/(オプション)）
  const push = (subpath: string) => router.push(`${prefix}${subpath}`);

  // レールと同じ6機能を「大きめタイルのボタン」で並べる
  const tiles = useMemo(
    () => [
      {
        label: "チャット", icon: MessageSquare, onClick: () => push(
          selectedThreadId
            ? `/chat-page/${encodeURIComponent(selectedThreadId)}`
            : "/chat-page/placeholder"
        )
      },
      { label: "画像・ファイル", icon: FolderOpen, onClick: () => push("/files") },
      { label: "カスタム関数", icon: Code2, onClick: () => push("/functions") },
      { label: "履歴", icon: History, onClick: () => push("/history") },
      { label: "論文推敲", icon: FileText, onClick: () => push("/paper") },
      { label: "ユーザ管理", icon: User, onClick: () => push("/user") },
    ],
    [router, selectedThreadId]
  );

  return (
    <div className="flex h-screen w-full bg-muted/40">
      <AppRail />
      <main className="flex-1 p-6 md:p-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">スタート</h1>
          <p className="text-muted-foreground mt-2">やりたいことを選んでください。</p>
        </header>

        {/* 大きめの正方形カードボタン。行・列揃い＆崩れない */}
        <section className="grid gap-6 sm:gap-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map(({ label, icon: Icon, onClick }) => (
            <Button
              key={label}
              onClick={onClick}
              variant="outline"
              className="
                h-48 sm:h-56 w-full               
                rounded-3xl
                shadow-sm hover:shadow-md
                transition-transform duration-150 hover:scale-[1.01]
                flex flex-col items-center justify-center gap-4
                text-2xl
                [&_svg]:!size-24 sm:[&_svg]:!size-28 lg:[&_svg]:!size-32
              "
              aria-label={label}
            >
              <Icon className="w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24" strokeWidth={1} />
              <span className="font-semibold">{label}</span>
            </Button>
          ))}
        </section>
      </main>
    </div>
  );
}
