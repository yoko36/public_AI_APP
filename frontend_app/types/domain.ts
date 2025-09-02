// 送信時に添付するデータに関する型定義
// 送信後にメッセージに載せる情報
export type AttachmentKind = "image" | "file";

export type Attachment = {
  url: string;          // 添付データの保存先URL
  name: string;         // ファイルの表示名
  size: number;         // 添付データのデータサイズ
  mime: string;         // MIMEタイプ
  kind: AttachmentKind; // 画像かファイルかをの区別
};
