"use client";

import { useState, useRef, useEffect, useMemo } from "react";
// shadcn UI
import { Card, CardContent } from "@/components/ui/card";

// custom UI
import { Sidebar } from "@/components/custom_ui/sidebar";
import { MarkdownMessage } from "@/components/custom_ui/markdown-message";
import { AppRail } from "@/components/custom_ui/app-rail";
import { PendingAttachmentBar } from "@/components/custom_ui/PendingAttachmentBar";
import { Composer } from "@/components/custom_ui/composer";

// 状態管理
import { Message } from "@/types/chat-app";                     // メッセージの型取得
import { useStore } from "@/store/state";                       // ユーザ、プロジェクト、スレッド、メッセージのデータ
import { useAttachmentStore } from "@/store/attachments";       // 送信予定ファイルの一時データ

// --- 変更後：DB保存用フックを追加 ---
// ユーザ発言をまずDBへ保存（/api/v1/messages 経由）するために利用
import { useMessages } from "@/hooks/useMessages";              // データベースとzustandの状態を同期させる
// ファイル送信機能
import { uploadPendingAttachments } from "@/lib/upload"

export default function ChatPage({ threadId }: { threadId: string }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30_000); // 30秒毎に更新
    return () => clearInterval(t);
  }, []);
  const endRef = useRef<HTMLDivElement>(null);  // メッセージ送信後にスクロールを最下部に移動

  const EMPTY_IDS: ReadonlyArray<string> = Object.freeze([]);

  // メッセージのIDリストとそれらのIDに紐づくメッセージのリストを取得
  const messageIds = useStore((s) => s.messageIdsByThreadId[threadId] ?? EMPTY_IDS);
  const messagesById = useStore((s) => s.messagesById);
  // IDを指定して該当メッセージリストを取得
  const messages = useMemo(
    () =>
      messageIds
        .map((id) => messagesById[id])
        .filter((m): m is Message => m !== undefined),           // Messageに型を固定する
    [messageIds, messagesById]
  );

  // DBに対するメッセージの追加と取得用の関数を取得（useMessage内でzustandの状態変更）
  const { sendMessage, refetch } = useMessages(threadId);        // 新規追加：DBへ先に書く

  const selectThread = useStore((s) => s.selectThread); // 選択中のスレッド


  // ========================= ヘルパー関数 =========================
  // 時刻フォーマット系ヘルパー
  function ensureDate(v: string | number | Date): Date {
    // Message.created_at が string/number/Date いずれでも安全に Date 化
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(v);
    // 文字列(ISOなど)を許容。パース失敗時は "Invalid Date" になるので呼び出し側でフォールバック可
    return new Date(v);
  }

  /** JST(UTC+9, 固定)で "YYYY-MM-DD HH:mm" を生成 */
  function toJstYmdHm(d: Date): string {
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000); // UTC→JST
    const Y = jst.getUTCFullYear();
    const M = String(jst.getUTCMonth() + 1).padStart(2, "0");
    const D = String(jst.getUTCDate()).padStart(2, "0");
    const h = String(jst.getUTCHours()).padStart(2, "0");
    const m = String(jst.getUTCMinutes()).padStart(2, "0");
    return `${Y}-${M}-${D} ${h}:${m}`;
  }

  /** 24時間未満は「～秒/分/時間前」、以上は JST で固定フォーマット */
  function formatJpRelativeOrJst(createdAt: string | number | Date, nowTs: number): string {
    const d = ensureDate(createdAt);
    if (isNaN(d.getTime())) return String(createdAt); // 不正ならそのまま出す(保険)

    const diffMs = nowTs - d.getTime();
    if (diffMs < 0) return toJstYmdHm(d); // 未来時刻は固定フォーマット

    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return `${sec}秒前`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}分前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}時間前`;

    return toJstYmdHm(d);
  }

  // ========================= 送信や表示に使用する関数 =========================

  // 送受信の終了の合図の判定を行う関数
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

  const draftIdRef = useRef<string | null>(null);                 // 下書き
  const serverAssistantIdRef = useRef<string | null>(null);       // サーバが発行した assistant_msg_id を保持
  const controllerRef = useRef<AbortController | null>(null);     // 強制終了ハンドラー

  // チャットを送信する関数
  const handleSend = async () => {
    // inputの空文字を削除
    const content = input.trim();
    if (!content || !threadId) return;

    // 入力を初期化し、ローディング中の設定
    setInput("");
    setLoading(true);

    // ファイルの送信をメッセージの送信より前に行い、ファイルの保存先IDを取得しておく
    let attachmentIds: string[] = [];
    try {
      const uploaded = await uploadPendingAttachments(threadId);
      attachmentIds = uploaded.map((a: any) => a.id).filter(Boolean);
    } catch (e) {
      console.error("[uploadPendingAttachments] failed:", e);
      // （続行しても良いし、中断しても良い。ここでは続行）
    }

    // - sendMessage は「楽観挿入→サーバ確定IDに差し替え」まで面倒を見てくれる
    // - これにより“DB先書き”が保証され、SSEや再接続時も整合しやすい
    let createdUserMessage: Message | undefined;
    try {
      createdUserMessage = await sendMessage(content, "user");   // ここでDBへ保存
    } catch (e) {
      console.error("[sendMessage] failed:", e);
      // DB保存が失敗した場合は以降のSSEを開始しない（UX上メッセージはロールバック済み）
      setLoading(false);
      return;
    }

    // 履歴は「assistant下書き」を作る前に生成（空assistantが混ざらない）
    {
      const s = useStore.getState();
      const ids = s.messageIdsByThreadId[threadId] ?? [];
      // 過去の会話データを保存
      var history = ids                                         // ブロック外で使用するため、varで宣言
        .map((id) => s.messagesById[id])
        .filter((m): m is Message => m != null)                 // Message型かつnullを除去
        .map((m) => ({ role: m.role, content: m.content }));
    }

    // 空の assistant 下書きを作成して、そのIDを ref に保存
    // サーバ側でも assistant を作成（"ready"でIDが飛んでくる）想定だが、
    // ローカル側は従来通りドラフトを持ち、完了時に refetch で整合させる
    // (補足:) 送信中であることがわかりやすいように、ボットの返信を先に作り「返信中と表示」
    {
      const s = useStore.getState();
      const nextId = String(s.messageCounter);                   // 次に発行されるIDを先取り
      s.createMessage("送信中", threadId, "assistant");          // 送信中というメッセージを持った仮の返答文
      draftIdRef.current = nextId;                               // catch文からでも読めるように保持
    }

    // SSE(Server Sent Events) 開始
    const controller = new AbortController();                    // 途中終了のボタンを設定
    controllerRef.current = controller;

    try {
      const CHAT_ENDPOINT =
        process.env.BACKEND_EXTERNAL_URL
          ? `${process.env.BACKEND_EXTERNAL_URL.replace(/\/$/, "")}/api/chat`
          : "/api/chat";
      console.log("[SSE] POST", CHAT_ENDPOINT, "開始");
      const res = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        credentials: "include",
        body: JSON.stringify({
          threadId,
          messages: history,      // 既存の履歴
          attachmentIds           // ファイルの保存先ID
        }),
        signal: controller.signal,
        cache: "no-store",
      });

      // サーバからSSEが送られてきているかを検査
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/event-stream")) {
        const body = await res.text().catch(() => "(no body)");
        throw new Error(`unexpected content-type: ${ct} body=${body.slice(0, 200)}`);
      }

      console.log("[SSE] status:", res.status, "ct:", res.headers.get("content-type"));

      // ================================================================================================
      // // 通信エラーハンドリング
      // ================================================================================================
      if (!res.ok) {
        const errText = await res.text().catch(() => "(no body)");
        console.error("[SSE] 非200応答:", res.status, errText);
        throw new Error(`stream start failed: ${res.status} ${errText}`);
      }
      if (!res.body) {
        console.error("[SSE] Response.body が null");
        throw new Error("stream start failed: no body");
      }

      const reader = res.body.getReader();                // リーダを取得
      const decoder = new TextDecoder("utf-8");           // utf-8デコーダ
      let draft = "";                                     // 受信テキストを溜める
      let buffer = "";                                    // 区切り対策のバッファ

      // 回答が終わるまでstream通信を受け取る
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        // SSEで送られてくるデータは断片的
        // SSEのeventの区切りは空行なので、空行が来るまではバッファにためておく（未完成の場合は次回のSSEに持ち越し）
        buffer += chunk;
        const events = buffer.split("\n\n");  // 空行で区切る
        buffer = events.pop() ?? "";

        // 完成したイベントごとの処理
        for (const event of events) {
          if (!event || event.startsWith(":")) continue;        // コメントは無視
          const lines = event.split("\n");
          // 各イベントの分解
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim(); // 先頭5文字(data:)を削除
            if (!payload) continue;

            try {
              const msg = JSON.parse(payload);

              // --- 変更後：最初に "ready" を受け取ったら assistant_msg_id を控える ---
              if (msg.type === "ready" && typeof msg.assistant_msg_id === "string") {
                serverAssistantIdRef.current = msg.assistant_msg_id;   // サーバ側から送られてきた正式なIDを保存
                continue;
              }

              // メッセージタイプがチャンクかつメッセージの差分が文字列である場合
              if (msg.type === "chunk" && typeof msg.delta === "string") {
                draft += msg.delta;
                const id = draftIdRef.current;
                if (id) useStore.getState().updateMessage(id, draft);  // 既存ドラフトを更新
                // 受信終了（完了）
              } else if (msg.type === "end") {
                console.log("[SSE] end 受信");

                // --- 変更後：サーバDBに保存された最終状態と整合させるため refetch する ---
                //   - ローカルのドラフトIDとサーバの assistant_msg_id は不一致のため、
                //     完了後にDBの真実で上書きするのが安全
                try {
                  await refetch();                                     // DBとローカルストアを同期
                } catch (e) {
                  console.warn("[refetch after end] failed:", e);
                }
                // エラーハンドリング（下に継続）
              } else if (msg.type === "error") {
                console.error("[SSE] server error:", msg.message);
                throw new Error(String(msg.message || "server error"));
              }
            } catch {
              // 終了を表すデータを受け取った場合終了する
              if (isTerminalToken(payload)) {
                // 終了トークンは無視して本文に追加しない
                continue;
              }
              // data行がJSON形式ではないデータだった場合(文字列が来たときなど)平文としてdraftに追加、保存
              draft += payload;
              const id = draftIdRef.current;
              if (id) useStore.getState().updateMessage(id, draft);
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
      useAttachmentStore.getState().clearAll();   // 一時ファイルのバッファを初期化
      try { controller.abort(); } catch { }       // 通信を即座に終了させる
      controllerRef.current = null;               // 強制終了機能は通信ごとに用意するので、古いものは削除
      draftIdRef.current = null;                  // ストリーミング用ドラフトIDをクリア
      serverAssistantIdRef.current = null;        // サーバIDもクリア
      setLoading(false);                          // 通信終了
    }
  };

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
                            <span className="text-xs opacity-70">
                              {formatJpRelativeOrJst(msg.created_at as any, nowTick)}
                            </span>
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
              {/* ファイル追加時の一時表示バー */}
              <PendingAttachmentBar />
              <div className="mx-auto w-[min(100%,48rem)] px-3">
                <div className="rounded-2xl bg-background/90 backdrop-blur shadow-lg">
                  {/* 送信時のメインコンポーネント */}
                  <Composer input={input} setInput={setInput} onSend={handleSend} />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
