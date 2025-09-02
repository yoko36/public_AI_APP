// 送信予定のファイルをスタックしておくコンポーネント
"use client";
import { useAttachmentStore } from "@/store/attachments";
import { X, Loader2, File as FileIcon, Image as ImageIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";


export function PendingAttachmentBar() {
    // ストアから一時保存バッファの状態と削除関数を取得
    const pending = useAttachmentStore(s => s.pending);
    const remove = useAttachmentStore(s => s.remove);

    // バッファになにも含まれていなければバッファを表示しない
    if (pending.length === 0) return null;  

    return (
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b">
            <div className="p-3 flex gap-3 overflow-x-auto">
                {pending.map((a) => (
                    <Card key={a.id} className="relative w-40 shrink-0">
                        {/* 削除ボタン */}
                        <button
                            onClick={() => remove(a.id)}
                            className="absolute -right-2 -top-2 rounded-full border bg-background shadow p-1"
                            aria-label="remove attachment"
                        >
                            <X className="w-4 h-4" />
                        </button>

                        {/* 添付ファイルを表示 */}
                        <CardContent className="p-2">
                            {a.kind === "image" ? (
                                <img
                                    src={a.previewUrl}
                                    alt={a.name}
                                    className="aspect-video w-full object-cover rounded-lg"
                                />
                            ) : (
                                <div className="aspect-video w-full grid place-items-center rounded-lg border">
                                    <FileIcon className="w-6 h-6" />
                                </div>
                            )}
                            <div className="mt-2 text-xs line-clamp-2" title={a.name}>{a.name}</div>


                            {a.status !== "pending" && (
                                <div className="mt-1 text-[10px]">
                                    {a.status === "uploading" && (
                                        <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> アップロード中</span>
                                    )}
                                    {a.status === "done" && <span>準備OK</span>}
                                    {a.status === "error" && <span className="text-red-600">失敗</span>}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}