"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listMessages, createMessage } from "@/lib/repository/messages";
import { useStore } from "@/store/state";
import type { Message } from "@/types/chat-app";

/**
 * 指定スレッドのメッセージ一覧を取得 + 送信（作成）
 * - threadId が決まったら fetch
 */

const EMPTY_IDS: ReadonlyArray<string> = Object.freeze([]);

export function useMessages(threadId?: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const messageIds = useStore(s =>
    threadId ? (s.messageIdsByThreadId[threadId] ?? EMPTY_IDS) : EMPTY_IDS
  );
  const messagesById = useStore(s => s.messagesById);
  // 表示用のメッセージ
  const messages = useMemo(
    () =>
      messageIds
        .map(id => messagesById[id])
        .filter((m): m is Message => m != null),
    [messageIds, messagesById]
  );

  // 
  const asOne = <T,>(val: T | T[]): T => Array.isArray(val) ? val[0] : val;

  // データベースに保存した内容をストアに反映させる関数
  const setMessagesIntoStore = useCallback((tid: string, rows: Message[]) => {
    useStore.setState(s => ({
      messagesById: {
        ...s.messagesById,
        ...Object.fromEntries(rows.map(m => [String((m as any).id), m])),
      },
      messageIdsByThreadId: {
        ...s.messageIdsByThreadId,
        [tid]: rows.map(m => String((m as any).id)),
      },
    }));
  }, []);

  // ==================================================
  // // ストアから状態を取得する関数
  // ==================================================
  const refetch = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listMessages(threadId); // /api/v1/messages?threadId=...
      const arr = Array.isArray(data) ? data : [data];
      setMessagesIntoStore(threadId, arr as Message[]);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [threadId, setMessagesIntoStore]);

  // ==================================================
  // // メッセージの送信関数（UIに反映 -> DB保存）
  // ==================================================
  const sendMessage = useCallback(async (content: string, role: "user" | "assistant" = "user") => {
    if (!threadId) throw new Error("threadId is required");
    const tmpId = `tmp-${crypto.randomUUID()}`; // 一時ID

    // UIに反映させる一時データ
    const optimistic: Message = {
      id: tmpId as any,
      threadId,
      role,
      content,
      created_at: new Date().toISOString(),
    } as any;

    const prevState = useStore.getState(); // 現在（保存前）の状態

    // 先にUIへ反映（末尾追加）
    useStore.setState(s => ({
      messagesById: { ...s.messagesById, [tmpId]: optimistic },
      messageIdsByThreadId: {
        ...s.messageIdsByThreadId,
        [threadId]: [...(s.messageIdsByThreadId[threadId] ?? []), tmpId],
      },
    }));

    // データベースに保存し、保存後のデータを状態に反映（IDなど）を処理
    try {
      const createdRaw = await createMessage({ threadId, role, content });  // メッセージの作成をデータベースに問合せ
      const created = asOne<Message>(createdRaw as any);

      if (!created || (created as any).id == null) {
        console.warn("[useMessages] createMessage returned empty/without id; fallback to refetch");
        await refetch();               // DBの真実でストアを再構築（tmp は自然に消える）
        return created ?? (optimistic as any);
      }

      const createdId = String((created as any).id);
      useStore.setState(s => {
        const map = { ...s.messagesById };
        delete map[tmpId];
        map[createdId] = created as any;

        const ids = (s.messageIdsByThreadId[threadId] ?? []).map(id =>
          id === tmpId ? createdId : id
        );
        return {
          messagesById: map,
          messageIdsByThreadId: { ...s.messageIdsByThreadId, [threadId]: ids },
        };
      });
      return created;

    } catch (e) {
      // 失敗時はロールバック
      useStore.setState(() => prevState);
      setError(e);
      throw e;
    }
  }, [threadId, refetch]); // ← refetch を使うので依存に追加

  useEffect(() => {
    if (!threadId) return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  return useMemo(
    () => ({ messages, loading, error, refetch, sendMessage }),
    [messages, loading, error, refetch, sendMessage]
  );
}


// "use client";

// import { useCallback, useEffect, useMemo, useState } from "react";
// import { listMessages, createMessage } from "@/lib/repository/messages";
// import { useStore, EMPTY_IDS } from "@/store/state";
// import type { Message } from "@/types/chat-app";

// const asOne = <T,>(val: T | T[]): T => (Array.isArray(val) ? val[0] : val);

// export function useMessages(threadId?: string) {
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState<unknown>(null);

//   const messageIds = useStore((s) => (threadId ? (s.messageIdsByThreadId[threadId] ?? EMPTY_IDS) : EMPTY_IDS));
//   const messagesById = useStore((s) => s.messagesById);

//   const bulkUpsertMessages = useStore((s) => s.bulkUpsertMessages);
//   const linkMessageIdsToThread = useStore((s) => s.linkMessageIdsToThread);

//   const messages = useMemo(
//     () => (messageIds as string[]).map((id) => messagesById[id]).filter((m): m is Message => m != null),
//     [messageIds, messagesById]
//   );

//   const refetch = useCallback(async () => {
//     if (!threadId) return;
//     setLoading(true);
//     setError(null);
//     try {
//       const data = await listMessages(threadId);
//       const arr = Array.isArray(data) ? data : [data];
//       bulkUpsertMessages(arr as Message[]);
//       linkMessageIdsToThread(threadId, (arr as Message[]).map((m) => String((m as any).id)));
//     } catch (e) {
//       setError(e);
//     } finally {
//       setLoading(false);
//     }
//   }, [threadId, bulkUpsertMessages, linkMessageIdsToThread]);

//   const sendMessage = useCallback(
//     async (content: string, role: "user" | "assistant" = "user") => {
//       if (!threadId) throw new Error("threadId is required");
//       const tmpId = `tmp-${crypto.randomUUID()}`;

//       // 1) 楽観的にUIへ反映
//       const optimistic: Message = {
//         id: tmpId as any,
//         threadId,
//         role,
//         content,
//         created_at: new Date().toISOString(),
//       } as any;

//       const prev = useStore.getState();

//       bulkUpsertMessages([optimistic]);
//       linkMessageIdsToThread(threadId, [...((prev.messageIdsByThreadId[threadId] ?? []) as string[]), tmpId]);

//       // 2) DBへ保存 → 成功時に tmp を実IDへ差し替え
//       try {
//         const createdRaw = await createMessage({ threadId, role, content });
//         const created = asOne<Message>(createdRaw as any);

//         if (!created || (created as any).id == null) {
//           console.warn("[useMessages] createMessage returned empty/without id; fallback to refetch");
//           await refetch();
//           return created ?? (optimistic as any);
//         }

//         const createdId = String((created as any).id);
//         // 差し替え
//         const cur = useStore.getState();
//         const ids = (cur.messageIdsByThreadId[threadId] ?? []).map((id) => (id === tmpId ? createdId : id));
//         // tmpを消して created を入れる
//         const map = { ...cur.messagesById };
//         delete map[tmpId];
//         map[createdId] = created as any;

//         useStore.setState({
//           messagesById: map,
//           messageIdsByThreadId: { ...cur.messageIdsByThreadId, [threadId]: ids },
//         });

//         return created;
//       } catch (e) {
//         // 失敗時はロールバック
//         useStore.setState(() => prev);
//         setError(e);
//         throw e;
//       }
//     },
//     [threadId, refetch, bulkUpsertMessages, linkMessageIdsToThread]
//   );

//   useEffect(() => {
//     if (!threadId) return;
//     void refetch();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [threadId]);

//   return useMemo(() => ({ messages, loading, error, refetch, sendMessage }), [messages, loading, error, refetch, sendMessage]);
// }
