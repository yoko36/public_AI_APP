"use client";

import { useState, useRef, useEffect } from "react";
// shadcn UI
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
// lucide icon
import { Plus, Mic, SendHorizonal } from "lucide-react";

// custom UI
import { Sidebar } from "./sidebar";

export default function ChatPage({ projectId }: { projectId: string }) {
    const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // チャットを送信する関数
    const handleSend = async () => {
        if (!input.trim()) return;
        const userMessage = { role: "user", content: input };
        setMessages((prev) => [...prev, userMessage]);
        setInput("");
        setLoading(true);

        try {
            const res = await fetch('/api-route/chat', {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId, messages: [...messages, userMessage] }),
            });
            const data = await res.json();
            const botMessage = { role: "assistant", content: data.reply };
            setMessages((prev) => [...prev, botMessage]);
        } catch (e) {
            setMessages((prev) => [...prev, { role: "assistant", content: "エラーが発生しました。" }]);
        } finally {
            setLoading(false);
        }
    };

    // ファイルをアップロードする関数
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // アップロード処理（例：サーバへPOST、画像表示など）
        console.log("アップロードされたファイル:", file);

        // メッセージ欄に仮表示してみる（必要に応じて変更）
        setMessages((prev) => [
            ...prev,
            { role: "user", content: `📎 ファイルをアップロードしました: ${file.name}` },
        ]);
    };


    return (
        <div className="flex h-screen w-full bg-muted/40">
            <Sidebar />
            <div className="flex flex-col flex-1">
                <header className="px-6 py-4 border-b bg-background shadow-sm">
                    <h1 className="text-3xl font-bold tracking-tight text-center">AI ChatBot</h1>
                </header>

                <main className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
                    <div className="mx-auto max-w-4xl space-y-4 px-4 sm:px-6">
                        {messages.map((msg, idx) => (
                            <div
                                key={idx}
                                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                                <Card
                                    className={`w-full max-w-2xl min-w-0 p-0 rounded-2xl ${msg.role === "user"
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-background"
                                        }`}
                                >
                                    {/* CardContentのデフォルト余白は消す */}
                                    <CardContent className="p-0">
                                        {/* ← ここで十分な左右パディングを付ける */}
                                        <div className="px-8 sm:px-10 lg:px-12 xl:px-16 py-4 md:py-5">
                                            {/* ← 行長を抑えて可読性を上げる（約65〜70文字幅） */}
                                            <div className="max-w-[68ch]">
                                                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">
                                                    {msg.content}
                                                </p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        ))}
                        <div ref={endRef} />
                    </div>
                </main>

                <footer className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-[min(100%-1rem,48rem)] px-4">
                    <div className="rounded-2xl border bg-background/90 backdrop-blur shadow-lg">
                        <div className="flex items-center justify-center gap-4 p-3 sm:p-4">
                            {/* 画像/ファイルアップロード用ボタン */}
                            <div className="relative">
                                <input
                                    type="file"
                                    accept="image/*,application/pdf"
                                    onChange={handleFileUpload}
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                />
                                <Button variant="outline" size="icon" className="rounded-full w-14 h-14 shrink-0">
                                    <Plus className="w-7 h-7" />
                                </Button>
                            </div>

                            <Button variant="outline" size="icon" className="rounded-full w-14 h-14 shrink-0">
                                <Mic className="w-7 h-7" />
                            </Button>

                            <Input
                                placeholder="質問を入力してください..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                                className="w-full h-16 text-lg px-6 py-4 rounded-full shadow"
                            />

                            <Button
                                onClick={handleSend}
                                disabled={loading}
                                className="h-16 px-8 text-lg rounded-full shadow flex items-center gap-3 shrink-0"
                            >
                                <SendHorizonal className="w-6 h-6" />
                                送信
                            </Button>
                        </div>
                    </div>
                </footer>
            </div>
        </div>
    );
}