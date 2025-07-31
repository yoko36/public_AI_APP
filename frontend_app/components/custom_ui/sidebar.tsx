"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Sidebar() {
  const handleNewChat = () => {
    console.log("新しいチャットを作成します");
    // TODO: 実際にはAPIや状態更新など
  };

  return (
    <aside className="w-96 bg-background text-foreground border-r border-border h-screen flex flex-col text-lg">

      <div className="p-6 border-b border-border space-y-4">
        <h2 className="text-2xl font-semibold">プロジェクト</h2>
        <Button
          variant="secondary"
          className="w-full justify-start gap-2 text-xl"
          onClick={handleNewChat}
        >
          <Plus className="w-5 h-5" />
          新しいプロジェクト
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        <Link href="/chat-page/user-name/0" passHref>
        <Button variant="ghost" className="w-full justify-start px-4 text-lg">
          プロジェクトA
        </Button>
        </Link>
        <Link href="/chat-page/user-name/1" passHref>
        <Button variant="ghost" className="w-full justify-start px-4 text-lg">
          プロジェクトB
        </Button>
        </Link>
      </nav>

      {/* フッター */}
      <div className="sticky bottom-4 px-4">
        <div className="w-full rounded-xl bg-muted p-4 shadow border border-border">
          <p className="text-lg text-muted-foreground">ユーザ名: <span className="font-medium">test user</span></p>
        </div>
      </div>
    </aside>
  );
}
