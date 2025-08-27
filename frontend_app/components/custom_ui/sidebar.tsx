"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation"
import { Triangle, Settings } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

import { NewModal } from "@/components/custom_ui/new_dialog"
// 状態管理
import { useStore } from "@/store/state"

const userId = "1"
// selectorの既定値を設定し、新規配列を生成しないようにする
const EMPTY_IDS: ReadonlyArray<string> = Object.freeze([]);

export function Sidebar() {
  const router = useRouter();

  // const getProjectByUserId = useStore((s) => s.getProjectByUserId);
  // const getThreadsByProjectId = useStore((s) => s.getThreadsByProjectId);
  // 上記のコードがダメなのはuseStoreの仕様が「戻り値のデータが変化したら再レンダリングする」であるため(useStoreで変数そのものを指定することで解決)
  // ログイン中のユーザのプロジェクト一覧
  const projectIds = useStore((s) => s.projectIdsByUserId[userId] ?? EMPTY_IDS);
  const projectsById = useStore((s) => s.projectsById);
  // プロジェクト一覧を作成(ログインユーザのプロジェクトのID一覧と全ユーザのプロジェクト一覧を)
  const projects = useMemo(
    () => projectIds.map((id) => projectsById[id]).filter(Boolean),             // 必要に応じて型ガードを導入する
    [projectIds, projectsById]
  );  // スレッド参照用変数(辞書型)
  const threadIdsByProjectId = useStore((s) => s.threadIdsByProjectId);
  const threadsById = useStore((s) => s.threadsById);

  const createProject = useStore((s) => s.createProject);
  const createThread = useStore((s) => s.createThread);
  const selectThread = useStore((s) => s.selectThread);

  // 新しいプロジェクト
  const registerNewProject = (name: string, overview?: string) => {
    createProject(name, userId, overview); // 概要を使うなら第3引数に overview を渡す
  };

  // 新しいスレッド（プロジェクトごとに作成）
  const registerNewChat = (projectId: string) => (name: string) => {
    createThread(name, projectId);
  };

  // チャットボタンを押して際のページ遷移
  const navigateToPage = (threadId: string) => {
    selectThread(threadId);
    router.push(`/me/chat-page/${encodeURIComponent(threadId)}`);
    // 最終的
    // router.push(`/${encodeURIComponent(userId)}/chat-page/${encodeURIComponent(threadId)}`);
  };

  return (
    <aside className="w-[15%] min-w-60 bg-gray-100 text-foreground border-r border-border h-screen flex flex-col text-lg">

      <div className="p-6 border-b border-border space-y-4">
        <h2 className="text-2xl font-semibold">プロジェクト</h2>
        <NewModal onCreate={registerNewProject} buttonName="新しいプロジェクト" isOverviewNeeded={true} />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <Accordion type="single" collapsible className="w-full space-y-2">
          {(projects ?? []).map((project) => {
            const threadIds = threadIdsByProjectId[project.id] ?? EMPTY_IDS;
            const threads = threadIds.map((tid) => threadsById[tid]).filter(Boolean);

            return (
              <AccordionItem
                key={project.id}
                value={`project-${project.id}`}
                className="border rounded-xl overflow-hidden"
              >
                <AccordionTrigger className="group bg-muted rounded-xl px-4 py-3 text-xl font-semibold hover:bg-muted/70 data-[state=open]:bg-muted/90">
                  <div className="flex items-center w-full justify-between">
                    <span>{project.name}</span>
                    <Triangle className="ml-auto w-4 h-4 fill-current text-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 py-2 space-y-1 bg-background">
                  <div className="text-lg">
                    <NewModal className="text-lg" onCreate={registerNewChat(project.id)} buttonName="新しいチャット" isOverviewNeeded={false} />
                  </div>
                  <p
                    className=" pt-2 text-lg text-muted-foreground leading-none select-none "
                  >
                    チャット
                  </p>
                  {(threads ?? []).map((thread) => (
                    <button
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-muted text-lg "
                      key={thread.id}
                      onClick={() => { navigateToPage(thread.id) }}>
                      {thread.name}
                    </button>
                  ))}

                  <Settings
                    className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  />
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </aside>
  );
}