// メッセージ送信時にファイルをアップロードできるようにする
import { useAttachmentStore } from "@/store/attachments";
import type { Attachment } from "@/types/domain";
// 添付ファイルを順にアップロードし、UIの状態を更新しながら、サーバから送られてきたファイルの保存先URLを組み込んだ"Attachment"(テキスト送信時に同時に送る添付データの情報を含むデータ)を返す関数
export async function uploadPendingAttachments(): Promise<Attachment[]> {
    // ストアから一時ファイルバッファの状態を取得
    const { pending, markUploading, markDone, markError } = useAttachmentStore.getState();
    // 添付データの情報を格納するデータ
    const results: Attachment[] = [];

    // 一時保存バッファの各データを順に送信し、返り値の"Attachment"を作成
    for (const p of pending) {
        try {
            markUploading(p.id);                // 送信状態を"uploading"に変更
            const fd = new FormData();          // フォームデータを作成(入れ物を作成 -> データを追加すると「フォームの送信データ」という扱いになる)
            fd.append("file", p.file, p.name);  // フォームデータを追加

            // 指定したエンドポイントへPOSTメソッドを送りレスポンス(添付データの情報を含むデータ)を取得
            const res = await fetch("/api-route/upload", { method: "POST", body: fd });
            if (!res.ok) throw new Error(await res.text());

            // サーバからのデータをJSON形式に変換し、ファイルの保存先URLを取得
            const data = await res.json();
            const url: string = data.url; // 例: /static/...

            // 添付データの情報を保存し、送信状態を"done"変更する
            results.push({ url, name: p.name, size: p.size, mime: p.mime, kind: p.kind });
            markDone(p.id, url);
        } catch (e: any) {
            // エラー
            markError(p.id, e?.message || String(e));
        }
    }
    // 呼び出し元に添付データの情報を返す
    return results;
}