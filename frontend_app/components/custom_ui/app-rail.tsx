"use client";

import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Home, MessageSquare, FolderOpen, Code2, History, FileText, User } from "lucide-react";
import { useStore } from "@/store/state";

// 今いるURLから先頭セグメント(userId or "me")を作る
function useUserPrefix() {
  const pathname = usePathname() || "/";
  const m = pathname.match(/^\/([^/]+)/);
  const routeUserId = m?.[1];
  // /[userId]/... にいるならそれを、そうでなければ /me を使う
  return `/${routeUserId ?? "me"}`;
}

type ItemProps = {
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  onClick: () => void;
  active?: boolean;
};

const RailItem = ({ label, icon: Icon, onClick, active }: ItemProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        onClick={onClick}
        className="h-12 w-12 rounded-xl data-[active=true]:bg-muted"
        data-active={active}
      >
        <Icon className="h-6 w-6" />
        <span className="sr-only">{label}</span>
      </Button>
    </TooltipTrigger>
    <TooltipContent side="right" className="text-sm">{label}</TooltipContent>
  </Tooltip>
);

export function AppRail() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const prefix = useUserPrefix(); // 例: "/me" または "/12345678-...."

  const selectedThreadId = useStore((s) => s.selectedThreadId);

  // 共通 push（userId/{アプリケーション名}/(オプション)）
  const push = (subpath: string) => router.push(`${prefix}${subpath}`);

  // 各種ページへのルーティング
  const goHome = () => push(`/`);
  const goChat = () => {
    if (selectedThreadId) {
      push(`/chat-page/${encodeURIComponent(selectedThreadId)}`);
    } else {
      push(`/chat-page/placeholder`);
    }
  };
  const goFiles = () => push(`/files`);
  const goFunctions = () => push(`/functions`);
  const goHistory = () => push(`/history`);
  const goPaper = () => push(`/paper`);
  const goUser = () => push(`/user`);

  // active 表示（現在のURLが prefix+… で始まるか）
  const isActive = (seg: string) => pathname.startsWith(`${prefix}${seg}`);

  return (
    <TooltipProvider delayDuration={120}>
      <aside className="sticky top-0 h-screen w-16 shrink-0 border-r bg-background/95 backdrop-blur flex flex-col items-center justify-between py-4">
        <div className="flex flex-col items-center gap-2">
          <RailItem label="トップページ" icon={Home} onClick={goHome} active={isActive("/")} />
          <RailItem label="チャット" icon={MessageSquare} onClick={goChat} active={isActive("/chat-page")} />
          <RailItem label="画像・ファイル" icon={FolderOpen} onClick={goFiles} active={isActive("/files")} />
          <RailItem label="カスタム関数" icon={Code2} onClick={goFunctions} active={isActive("/functions")} />
          <RailItem label="チャット履歴" icon={History} onClick={goHistory} active={isActive("/history")} />
          <RailItem label="論文推敲" icon={FileText} onClick={goPaper} active={isActive("/paper")} />
        </div>
        <div className="flex flex-col items-center">
          <RailItem label="ユーザ管理" icon={User} onClick={goUser} active={isActive("/user")} />
        </div>
      </aside>
    </TooltipProvider>
  );
}
