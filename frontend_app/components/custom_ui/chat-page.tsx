"use client";

import { useState, useRef, useEffect, useMemo } from "react";
// shadcn UI
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
// lucide icon
import { Plus, SendHorizonal } from "lucide-react";

// custom UI
import { Sidebar } from "@/components/custom_ui/sidebar";
import { MarkdownMessage } from "@/components/custom_ui/markdown-message";
import { AppRail } from "@/components/custom_ui/app-rail";

// 状態管理
import { useStore, Message } from "@/store/state"


export default function ChatPage({ threadId }: { threadId: string }) {
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const endRef = useRef<HTMLDivElement>(null);

    const EMPTY_IDS: ReadonlyArray<string> = Object.freeze([]);

    const messageIds = useStore((s) => s.messageIdsByThreadId[threadId] ?? EMPTY_IDS);
    const messagesById = useStore((s) => s.messagesById);
    const messages = useMemo(
        () =>
            messageIds
                .map((id) => messagesById[id])
                .filter((m): m is Message => m !== undefined),   // Messageに型を固定する
        [messageIds, messagesById]
    );
    const createMessage = useStore((s) => s.createMessage);
    const selectThread = useStore((s) => s.selectThread);

    // 表示中のスレッドを設定(プロジェクトも同様)
    useEffect(() => {
        if (threadId) selectThread(threadId);
    }, [threadId, selectThread]);

    // 新規メッセージ追加後に最下部へスクロール
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // チャットを送信する関数
    const handleSend = async () => {
        const content = input.trim();
        if (!content || !threadId) return;

        setInput("");
        setLoading(true);

        // ユーザーメッセージを即時反映
        createMessage(content, threadId, "user");

        try {
            // サーバへ送信（roleとcontentを渡す）
            const state = useStore.getState();
            const ids = state.messageIdsByThreadId[threadId] ?? [];
            const history = ids
                .map((id) => state.messagesById[id])
                .filter((m): m is Message => m != null)                 // Messageに型を固定する
                .map((m) => ({ role: m.role, content: m.content }));

            const res = await fetch("/api-route/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ threadId, messages: history }),
            });

            if (!res.ok) throw new Error("chat api failed");

            const data = await res.json();
            const replyText: string = data.reply ?? "…";

            // 返答を反映
            createMessage(replyText, threadId, "assistant");
        } catch (e) {
            // エラー時もメッセージで通知
            createMessage("エラーが発生しました。もう一度お試しください。", threadId, "assistant");
        } finally {
            setLoading(false);
        }
    };
    // ファイルをアップロードする関数
    // const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    //     const file = e.target.files?.[0];
    //     if (!file) return;

    //     // アップロード処理（例：サーバへPOST、画像表示など）
    //     console.log("アップロードされたファイル:", file);

    //     // メッセージ欄に仮表示してみる（必要に応じて変更）
    //     setMessages((prev) => [
    //         ...prev,
    //         { role: "user", content: ` ファイルをアップロードしました: ${file.name}` },
    //     ]);
    // };


    return (
        <div className="flex h-screen w-full bg-muted/40">
            <AppRail />
            <Sidebar />
            <div className="flex flex-col flex-1">
                <header className="px-6 py-4 bg-background shadow-sm">
                    <h1 className="text-3xl font-bold tracking-tight text-center">AI ChatBot</h1>
                </header>

                <main className="flex-1 min-h-0 overflow-y-auto px-4 py-6 scroll-pb-40">
                    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 sm:px-8 flex flex-col min-h-full">
                        <div className="space-y-4 flex-1">
                            {messages.map((msg) => {
                                const isUser = msg.role === "user";
                                return (
                                    <div
                                        key={msg.id}
                                        className="flex"
                                    >
                                        <Card
                                            className={[
                                                "w-full md:max-w-[85%] lg:max-w-[80%]", // 画面サイズで動的にサイズを変更
                                                // 左右の寄せ（userは右/assistantは左）
                                                isUser ? "ml-auto" : "mr-auto",
                                                "rounded-2xl",
                                                isUser ? "bg-primary text-primary-foreground" : "bg-background",
                                            ].join(" ")}
                                        >
                                            <CardContent className="p-0">
                                                <div className="px-6 sm:px-8 lg:px-10 xl:px-12 py-4 md:py-5">
                                                    <div className="max-w-none">
                                                        {isUser ? (
                                                            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">
                                                                {msg.content}
                                                            </p>
                                                        ) : (
                                                            <MarkdownMessage text={msg.content} />
                                                        )}
                                                        <span className="text-xs opacity-70">{msg.created_at}</span>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>
                                )
                            })}
                            <div ref={endRef} /> {/* スクロール用アンカー */}
                        </div>
                        {/* フッター要素 */}
                        <div className="sticky bottom-3 z-50">
                            <div className="mx-auto w-[min(100%,48rem)] px-3">
                                <div className="rounded-2xl bg-background/90 backdrop-blur shadow-lg">
                                    <div className="flex items-center justify-center gap-4 p-3 sm:p-4">
                                        {/* 画像/ファイルアップロード用ボタン */}
                                        <div className="relative">
                                            <input
                                                type="file"
                                                accept="image/*,application/pdf"
                                                // onChange={handleFileUpload}
                                                className="absolute inset-0 opacity-0 cursor-pointer"
                                            />
                                            <Button size="icon" className="rounded-full w-14 h-14 shrink-0">
                                                <Plus className="w-7 h-7" />
                                            </Button>
                                        </div>
                                        <div className="flex-1">
                                            <div className=" shadow rounded-3xl bg-background overflow-hidden">
                                                <Textarea
                                                    placeholder="質問してみよう"
                                                    value={input}
                                                    onChange={(e) => setInput(e.target.value)}
                                                    onInput={(e) => {
                                                        const el = e.currentTarget;
                                                        el.style.height = "auto";
                                                        el.style.height = `${el.scrollHeight}px`;
                                                    }}
                                                    onKeyDown={(e) => {
                                                        // IME変換中のEnterは無視
                                                        if ((e as any).isComposing) return;
                                                        if (e.key === "Enter" && !e.shiftKey) {
                                                            e.preventDefault();  // textareaの改行を抑止
                                                            handleSend();
                                                        }
                                                    }}
                                                    disabled={loading}
                                                    rows={1}
                                                    className={[
                                                        "w-full min-h-12 max-h-64 text-base leading-5",
                                                        "px-4 py-3.5",
                                                        "bg-transparent border-0 rounded-none shadow-none",
                                                        "resize-none overflow-auto",
                                                    ].join(" ")}
                                                />
                                            </div>
                                        </div>
                                        <Button
                                            onClick={handleSend}
                                            disabled={loading || !input.trim()}
                                            size="icon"
                                            variant="default"
                                            aria-label="送信"
                                            className="h-12 w-12 rounded-full shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
                                        >
                                            <SendHorizonal className="w-6 h-6" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}