// 添付するファイルの選択状態に関する型定義
// 選択直後から送信中のUI表示と進捗管理
import type { AttachmentKind } from "./domain";

export type PendingAttachmentVM = {
  id: string;               // ファイルに設定される一時ID
  file: File;               // ブラウザFileオブジェクト
  name: string;             // ファイル名
  size: number;             // ファイルのデータサイズ
  mime: string;             // MIMEタイプ(データの種別を表す標準名)
  kind: AttachmentKind;     // ファイル種別("pdf", "image", "other" など)
  previewUrl: string;       // プレビュー用の一時URL
  status: "pending" | "uploading" | "done" | "error"; // 進捗ステータス(添付のアップロード状態)
  uploadedUrl?: string;     // アップロード後のアクセス先URL
  error?: string;           // 失敗時のメッセージ
};
