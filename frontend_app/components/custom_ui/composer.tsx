// サーバへのデータ送信を行うコンポーネント
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, SendHorizonal } from "lucide-react";
import { useAttachmentStore } from "@/store/attachments";

type Props = {
  input: string;                  // 入力テキストデータ(メッセージ)
  setInput: (v: string) => void;  // テキスト入力を行うメソッド
  onSend: () => void;             // 送信時に走る処理
  loading?: boolean;              // 送信中かどうか
};

export function Composer({ input, setInput, onSend, loading = false }: Props) {
  const addFiles = useAttachmentStore((s) => s.addFiles);

  // チャットページを表示中にペースト(Ctrl + V)をするとコピーされているファイルをペーストできる機能
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // クリップボードにファイルがある場合、addFilesを実行して添付データに追加する
      if (e.clipboardData?.files?.length) {
        addFiles(e.clipboardData.files as any);
      }
    };
    // ペーストしたとき上で定義したonPasteを実行する
    window.addEventListener("paste", onPaste);
    // unMount時(コンポーネントが画面から消えるとき: 別ページに遷移するときなど)に行う処理 -> ペースト時に発生させる処理を無効化
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  // Enterキーの設定
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 変換中は Enter 無視
    if ((e as any).isComposing) return;
    // "Shift + Enter"で改行、"Enter"のみで送信
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!loading) onSend();
    }
  };

  return (
    <div className="flex items-center justify-center gap-4 p-3 sm:p-4">
      {/* 画像/ファイルアップロード用ボタン（透明 input を被せる） */}
      <div className="relative">
        <input
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={(e) => {
            const files = e.target.files;
            if (files?.length) {
              addFiles(files);
              e.currentTarget.value = ""; // 同じファイルを再選択可
            }
          }}
          className="absolute inset-0 w-14 h-14 opacity-0 cursor-pointer z-10"
          aria-label="ファイルを選択"
        />
        <Button size="icon" className="rounded-full w-14 h-14 shrink-0" type="button">
          <Plus className="w-7 h-7" />
        </Button>
      </div>

      {/* 入力欄 */}
      <div className="flex-1">
        <div className="shadow rounded-3xl bg-background overflow-hidden">
          <Textarea
            placeholder="質問してみよう"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 256)}px`;
            }}
            onKeyDown={handleKeyDown}
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

      {/* 送信ボタン */}
      <Button
        onClick={onSend}
        disabled={loading || !input.trim()}
        size="icon"
        variant="default"
        aria-label="送信"
        className="h-12 w-12 rounded-full shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
        type="button"
      >
        <SendHorizonal className="w-6 h-6" />
      </Button>
    </div>
  );
}
