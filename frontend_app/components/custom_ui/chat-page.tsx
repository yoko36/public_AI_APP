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
    
    // 終了の合図の判定を行う関数
    const isTerminalToken = (s: string) => {    
        const t = s.trim();
        return t === "[DONE]" || t.toLowerCase() === "done" || t.toLowerCase() === "end";   
    };

    // 表示中のスレッドを設定(プロジェクトも同様)
    useEffect(() => {
        if (threadId) selectThread(threadId);
    }, [threadId, selectThread]);

    // 新規メッセージ追加後に最下部へスクロール
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const draftIdRef = useRef<string | null>(null);
    const controllerRef = useRef<AbortController | null>(null);

    // チャットを送信する関数
    const handleSend = async () => {
        // inputの空文字を削除
        const content = input.trim();
        if (!content || !threadId) return;

        // 入力を削除し、ローディング中の設定
        setInput("");
        setLoading(true);

        // ユーザーの発言を即時に反映(zustandのstateを更新)
        useStore.getState().createMessage(content, threadId, "user");

        // 履歴は「assistant下書き」を作る前に生成（空assistantが混ざらない）
        {
            // ThreadIdからMessage集合(history)を取得(ThreadId -> MessageIdテーブル -> history)
            const s = useStore.getState();
            const ids = s.messageIdsByThreadId[threadId] ?? [];
            var history = ids
                .map((id) => s.messagesById[id])
                .filter((m): m is Message => m != null)         // Message型かつnullを除去
                .map((m) => ({ role: m.role, content: m.content }));
        }

        // 空の assistant 下書きを作成して、そのIDを ref に保存
        {
            const s = useStore.getState();
            const nextId = String(s.messageCounter);                // 次に発番されるIDを先取り(返答が返ってきた後に書き換えられるように宛先をメモ)
            s.createMessage("送信中", threadId, "assistant");        // 送信中というメッセージを持った仮の返答文を定義(UXの問題)
            draftIdRef.current = nextId;                            // ← catch文からでも読めるようにnextIdとは別で保存
        }

        // SSE(Server Sent Events) 開始
        const controller = new AbortController();                   // 途中終了のボタンを設定
        controllerRef.current = controller;

        try {
            console.log("[SSE] POST /api-route/chat 開始");
            const res = await fetch("/api-route/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                },
                body: JSON.stringify({ threadId, messages: history }),  // JSON形式で送信
                signal: controller.signal,                              // これを入れると進行中のSSEを即座に中断できる(controller.abort()を呼ぶ)
                cache: "no-store",
            });

            console.log("[SSE] status:", res.status, "ct:", res.headers.get("content-type"));

            // ================================================================================================
            // 通信エラーハンドリング
            // ================================================================================================
            if (!res.ok) {
                // ここでサーバのエラーメッセージ本文を拾っておく
                const errText = await res.text().catch(() => "(no body)");
                console.error("[SSE] 非200応答:", res.status, errText);
                throw new Error(`stream start failed: ${res.status} ${errText}`);
            }
            if (!res.body) {
                console.error("[SSE] Response.body が null");
                throw new Error("stream start failed: no body");
            }


            const reader = res.body.getReader();                // リクエストボディから文字単位で読みだすことができるリーダを取得できる
            const decoder = new TextDecoder("utf-8");           // バイナリ -> utf-8に認識を変える(何かデータを変換したわけではなくこのバイナリはutf-8だという認識を与える)
            let draft = "";                                     // サーバから送られてくるばらばらのテキストを入れる変数
            let buffer = "";                                    // ネットワークの都合によりチャンクの区切りに関係なく区切られることがあるため、一時保存するためのバッファ(すべての返信データはここに保存され、区切り"\n\nが来てから抜き出す"")

            // 回答が終わるまでstream通信を受け取る
            while (true) {
                const { value, done } = await reader.read();    // ストリームが終了するまでvalueにボディからデータを取得し、終了後done: trueが返る
                if (done) break;                                // done: trueで終了

                // utf-8の文字列をテキストに変換する
                const chunk = decoder.decode(value, { stream: true });  // streamはutf-8がマルチバイトの文字コードであるため、データの区切りでぶった切られて文字化けすることを防ぐことために使用
                // 受け取った生チャンクもログ（最初の100文字だけ）
                console.log("[SSE] chunk(raw):", chunk.slice(0, 100).replace(/\n/g, "\\n"));

                buffer += chunk;                                        // チャンクをバッファに加えていく
                const events = buffer.split("\n\n");                    // 区切りまでのデータを抜き出す
                buffer = events.pop() ?? "";                            // 受信したチャンクな中に区切りが含まれない場合や区切りの後にもデータが存在する場合は端数をまたbufferに格納する

                // 完成したストリーミングデータを順に処理し、UIに表示する
                for (const ev of events) {
                    if (!ev || ev.startsWith(":")) continue;        // 空行列やSSEのコメント(":"で始まるものはコメントとみなす)を無視

                    const lines = ev.split("\n");                   // 一行ずつにする
                    for (const line of lines) {
                        if (!line.startsWith("data:")) continue;    // data行以外はスキップ
                        const payload = line.slice(5).trim();       // data行は"data:"で始まるため、先頭5文字を切り捨て残りを実データとして扱う
                        if (!payload) continue;                     // 空のデータ行はスキップ

                        try {
                            const msg = JSON.parse(payload);        // JSONとして解釈させる
                            // メッセージタイプがチャンクかつメッセージの差分が文字列である場合に
                            if (msg.type === "chunk" && typeof msg.delta === "string") {
                                draft += msg.delta;                 // メッセージ全体に差分を追加
                                const id = draftIdRef.current;      // 保存しておいた仮のIDを取得
                                if (id) useStore.getState().updateMessage(id, draft);   // zustandの状態を最新のメッセージに更新(threadIdで指定したスレッドのメッセージを更新)
                                // 受信終了
                            } else if (msg.type === "end") {
                                console.log("[SSE] end 受信");
                                // エラーハンドリング
                            } else if (msg.type === "error") {
                                console.error("[SSE] server error:", msg.message);
                                throw new Error(String(msg.message || "server error"));
                            }
                        } catch {
                            // ③ 終了を表すデータを受け取った場合終了する
                            if (isTerminalToken(payload)) {
                                // 終了トークンは無視して本文に追加しない
                                continue;
                            }
                            // data行がJSON形式ではないデータだった場合(文字列が来たときなど)
                            draft += payload;                                       // テキストをそのままメッセージに差分として追加
                            const id = draftIdRef.current;                          // JSONの場合と同様
                            if (id) useStore.getState().updateMessage(id, draft);   // JSONの場合と同様
                        }
                    }
                }
            }
        } catch (e) {
            // ストリーム時のエラーハンドリング
            console.error("[SSE] 例外:", e);
            const id = draftIdRef.current;
            const s = useStore.getState();
            const msg = "ストリーム中にエラーが発生しました。もう一度お試しください。";
            if (id && s.messagesById[id]) s.updateMessage(id, msg);
            else /* s.createMessage(msg, threadId, "assistant"); */ { }
        } finally {
            // 通信の最後に後始末を行う
            try { controller.abort(); } catch { }   // 通信を即座に終了させる
            controllerRef.current = null;           // 強制終了機能は通信ごとに用意するので、古いものは削除
            draftIdRef.current = null;              // ストリーミング形式でメッセージを作成する際に使用した下書きを削除
            setLoading(false);                      // 通信終了
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