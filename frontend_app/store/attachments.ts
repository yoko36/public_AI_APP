// 添付ファイルに関するストアの定義
import { create } from "zustand";
import type { PendingAttachmentVM } from "@/types/view";
import type { AttachmentKind } from "@/types/domain";

// 一時IDの作成関数
const rid = () =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2);

// ファイルの個数、容量の上限を設定
const MAX_FILES = 10;
const MAX_MB = 25;

// MIMEからファイル化が増加を判断する関数
const toKind = (m: string): AttachmentKind =>
  (m || "").startsWith("image/") ? "image" : "file";

// ファイルの状態とストアが提供する操作を定義
type State = { pending: PendingAttachmentVM[] };
type Actions = {
  addFiles: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clearAll: () => void;
  markUploading: (id: string) => void;
  markDone: (id: string, url: string) => void;
  markError: (id: string, error: string) => void;
};

// ファイルの状態管理用ストアの作成
export const useAttachmentStore = create<State & Actions>((set, get) => ({
  pending: [],      // 選択中のファイルのスタックデータ(初期状態を定義)

  // ファイルの追加時に行う状態更新
  addFiles: (files) => {
    // 現在のスタックと追加予定のファイル(単数 or 複数)を取得
    const cur = get().pending;
    const arr: File[] = files instanceof FileList ? Array.from(files) : files; 
    // 残りの添付容量を計算
    const room = Math.max(0, MAX_FILES - cur.length);
    // 送信予定のファイルが規定サイズのファイルかを判別
    const picked = arr
      .slice(0, room)
      .filter((f) => f.size <= MAX_MB * 1024 * 1024);

    // 送信予定のデータを表示、送信用のデータに変換
    const next: PendingAttachmentVM[] = picked.map((f) => ({
      id: rid(),
      file: f,
      name: f.name,
      size: f.size,
      mime: f.type || "application/octet-stream",
      kind: toKind(f.type || ""),
      previewUrl: URL.createObjectURL(f),
      status: "pending",
    }));
    // 選択中ファイルのスタックに追加
    set({ pending: [...cur, ...next] });
  },

  // 送信予定のファイルから削除する関数
  remove: (id) => set(s => ({ pending: s.pending.filter(p => p.id !== id) })),

  // 初期化関数(初期化関数)
  clearAll: () => {
    const cur = get().pending;
    cur.forEach(p => URL.revokeObjectURL(p.previewUrl));
    set({ pending: [] });
  },

  // 添付データの状態を"uploading"にセット
  markUploading: (id) =>
    set(s => ({ pending: s.pending.map(p => p.id === id ? { ...p, status: "uploading" } : p) })),

  // 添付データの状態を"done"にセット(ストレージのURLを受け付け保存する)
  markDone: (id, url) =>
    set(s => ({ pending: s.pending.map(p => p.id === id ? { ...p, status: "done", uploadedUrl: url } : p) })),

  // 添付データの状態を"error"にセット(エラーメッセージを格納)
  markError: (id, error) =>
    set(s => ({ pending: s.pending.map(p => p.id === id ? { ...p, status: "error", error } : p) })),
}));
