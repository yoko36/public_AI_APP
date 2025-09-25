"use client";
import { useEffect, useMemo, useState } from "react";
import { listThreads, createThread, renameThread, deleteThread } from "@/lib/repository/threads";
import { useStore } from "@/store/state";
import type { Thread } from "@/types/chat-app";

/** 空配列は参照を固定 */
const EMPTY_IDS: ReadonlyArray<string> = Object.freeze([]);

/**
 * 指定プロジェクト配下のスレッド一覧を取得 + 作成/更新/削除
 * - projectId が決まったら fetch
 */

export function useThreads(projectId?: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // equality 第2引数は使わず、型を明示
  const threadIds = useStore((s: any) =>
    projectId ? ((s.threadIdsByProjectId?.[projectId] as ReadonlyArray<string> | undefined) ?? EMPTY_IDS) : EMPTY_IDS
  ) as ReadonlyArray<string>;

  const threadsById = useStore((s: any) => s.threadsById ?? {}) as Record<string, Thread>;

  const threads = useMemo(
    () => threadIds.map((id) => threadsById[id]).filter(Boolean) as Thread[],
    [threadIds, threadsById]
  );

  // 単体/配列のAPI戻り値を単体に正規化
  const asOne = <T,>(val: T | T[]): T => (Array.isArray(val) ? val[0] : val);

  const setThreadsIntoStore = (pid: string, rows: Thread[]) => {
    useStore.setState((s: any) => ({
      threadsById: {
        ...(s.threadsById ?? {}),
        ...Object.fromEntries(rows.map((t) => [String((t as any).id), t])),
      },
      threadIdsByProjectId: {
        ...(s.threadIdsByProjectId ?? {}),
        [pid]: rows.map((t) => String((t as any).id)),
      },
    }));
  };

  const refetch = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listThreads(projectId);
      const arr = Array.isArray(data) ? data : [data];
      setThreadsIntoStore(projectId, arr as Thread[]);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  // ---- 作成（楽観更新＋ID差し替え）----
  const addThread = async (name: string) => {
    if (!projectId) throw new Error("projectId is required");
    const tmpId = `tmp-${crypto.randomUUID()}`;

    const optimistic: Thread = {
      id: tmpId as any,
      name,
      projectId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any;

    const prevState = useStore.getState();
    useStore.setState((s: any) => ({
      threadsById: { ...(s.threadsById ?? {}), [tmpId]: optimistic },
      threadIdsByProjectId: {
        ...(s.threadIdsByProjectId ?? {}),
        [projectId]: [tmpId, ...((((s.threadIdsByProjectId ?? {})[projectId] as string[] | undefined) ?? []) as string[])],
      },
      selectedThreadId: tmpId,
      selectedProjectId: projectId,
    }));

    try {
      const createdRaw = await createThread({ projectId, name });
      const created = asOne<Thread>(createdRaw as any);

      useStore.setState((s: any) => {
        const map = { ...(s.threadsById ?? {}) };
        delete map[tmpId];
        map[String((created as any).id)] = created as any;

        const ids = ((((s.threadIdsByProjectId ?? {})[projectId] as string[] | undefined) ?? []) as string[]).map((id) =>
          id === tmpId ? String((created as any).id) : id
        );

        return {
          threadsById: map,
          threadIdsByProjectId: { ...(s.threadIdsByProjectId ?? {}), [projectId]: ids },
          selectedThreadId: String((created as any).id),
          selectedProjectId: projectId,
        };
      });

      return created;
    } catch (e) {
      useStore.setState(() => prevState); // ロールバック
      setError(e);
      throw e;
    }
  };

  // ---- リネーム（楽観更新＋ロールバック）----
  const editThreadName = async (threadId: string, name: string) => {
    const id = String(threadId);
    const prev = (useStore.getState() as any).threadsById?.[id] as Thread | undefined;
    if (!prev) return;

    useStore.setState((s: any) => ({
      threadsById: {
        ...(s.threadsById ?? {}),
        [id]: { ...prev, name, updated_at: new Date().toISOString() } as any,
      },
    }));

    try {
      const updatedRaw = await renameThread(id, name);
      const updated = asOne<Thread>(updatedRaw as any);
      useStore.setState((s: any) => ({
        threadsById: { ...(s.threadsById ?? {}), [id]: updated as any },
      }));
      return updated;
    } catch (e) {
      useStore.setState((s: any) => ({
        threadsById: { ...(s.threadsById ?? {}), [id]: prev },
      }));
      setError(e);
      throw e;
    }
  };

  // ---- 削除（楽観更新＋ロールバック）----
  const removeThread = async (threadId: string) => {
    const id = String(threadId);
    const prevState = useStore.getState();

    useStore.setState((s: any) => {
      const t = (s.threadsById ?? {})[id] as any;
      if (!t) return s;
      const pid = t.projectId ?? projectId;

      const nextThreadsById = { ...(s.threadsById ?? {}) } as Record<string, Thread>;
      delete nextThreadsById[id];

      const currentIds = ((((s.threadIdsByProjectId ?? {})[pid] as string[] | undefined) ?? []) as string[]);
      const nextThreadIdsByProjectId = {
        ...(s.threadIdsByProjectId ?? {}),
        [pid]: currentIds.filter((x) => x !== id),
      };

      const nextMessagesById = { ...(s.messagesById ?? {}) } as Record<string, any>;
      const nextMessageIdsByThreadId = { ...(s.messageIdsByThreadId ?? {}) } as Record<string, string[]>;
      const mids = (s.messageIdsByThreadId?.[id] as string[] | undefined) ?? [];
      for (const mid of mids) delete nextMessagesById[mid];
      delete nextMessageIdsByThreadId[id];

      const nextSelectedThreadId = s.selectedThreadId === id ? undefined : s.selectedThreadId;

      return {
        threadsById: nextThreadsById,
        threadIdsByProjectId: nextThreadIdsByProjectId,
        messagesById: nextMessagesById,
        messageIdsByThreadId: nextMessageIdsByThreadId,
        selectedThreadId: nextSelectedThreadId,
        selectedProjectId: s.selectedProjectId ?? pid,
      };
    });

    try {
      await deleteThread(id);
      await refetch();        // 最後にDBと同期
      return true;
    } catch (e) {
       const msg = String((e as any)?.message || "");
      // 既に削除済み等は成功扱いとする（冪等性）
      const benign = /not\s*found|already\s*deleted|no\s*such|does\s*not\s*exist/i.test(msg);
      // 念のため再同期
      await refetch();
      if (benign) {
        return true;
      }
      useStore.setState(() => prevState); // ロールバック
      setError(e);
      throw e;
    }
  };

  // projectId が変わったら取得
  useEffect(() => {
    if (!projectId) return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return useMemo(
    () => ({ threads, loading, error, refetch, addThread, editThreadName, removeThread }),
    [threads, loading, error]
  );
}


// "use client";

// import { useCallback, useEffect, useMemo, useState } from "react";
// import { listThreads, createThread, renameThread, deleteThread } from "@/lib/repository/threads";
// import { useStore, EMPTY_IDS } from "@/store/state";
// import type { Thread } from "@/types/chat-app";

// const asOne = <T,>(val: T | T[]): T => (Array.isArray(val) ? val[0] : val);

// export function useThreads(projectId?: string) {
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState<unknown>(null);

//   const threadIds = useStore((s) => (projectId ? (s.threadIdsByProjectId[projectId] ?? EMPTY_IDS) : EMPTY_IDS)) as ReadonlyArray<string>;
//   const threadsById = useStore((s) => s.threadsById) as Record<string, Thread>;

//   const bulkUpsertThreads = useStore((s) => s.bulkUpsertThreads);
//   const linkThreadIdsToProject = useStore((s) => s.linkThreadIdsToProject);
//   const removeThreadCascade = useStore((s) => s.removeThreadCascade);
//   const selectThread = useStore((s) => s.selectThread);

//   const threads = useMemo(
//     () => threadIds.map((id) => threadsById[id]).filter(Boolean) as Thread[],
//     [threadIds, threadsById]
//   );

//   const refetch = useCallback(async () => {
//     if (!projectId) return;
//     setLoading(true);
//     setError(null);
//     try {
//       const data = await listThreads(projectId);
//       const arr = Array.isArray(data) ? data : [data];
//       bulkUpsertThreads(arr as Thread[]);
//       linkThreadIdsToProject(projectId, (arr as Thread[]).map((t) => String((t as any).id)));
//     } catch (e) {
//       setError(e);
//     } finally {
//       setLoading(false);
//     }
//   }, [projectId, bulkUpsertThreads, linkThreadIdsToProject]);

//   const addThread = useCallback(async (name: string) => {
//     if (!projectId) throw new Error("projectId is required");
//     const tmpId = `tmp-${crypto.randomUUID()}`;

//     const optimistic: Thread = {
//       id: tmpId as any,
//       name,
//       projectId,
//       created_at: new Date().toISOString(),
//       updated_at: new Date().toISOString(),
//     } as any;

//     const prev = useStore.getState();

//     // 楽観反映（先頭に追加）
//     bulkUpsertThreads([optimistic]);
//     linkThreadIdsToProject(projectId, [tmpId, ...((prev.threadIdsByProjectId[projectId] ?? []) as string[])]);
//     selectThread(tmpId);

//     try {
//       const createdRaw = await createThread({ projectId, name });
//       const created = asOne<Thread>(createdRaw as any);

//       const cur = useStore.getState();
//       const ids = (cur.threadIdsByProjectId[projectId] ?? []).map((id) => (id === tmpId ? String((created as any).id) : id));
//       bulkUpsertThreads([created]);
//       linkThreadIdsToProject(projectId, ids);
//       selectThread(String((created as any).id));
//       return created;
//     } catch (e) {
//       useStore.setState(() => prev);
//       setError(e);
//       throw e;
//     }
//   }, [projectId, bulkUpsertThreads, linkThreadIdsToProject, selectThread]);

//   const editThreadName = useCallback(async (threadId: string, name: string) => {
//     const id = String(threadId);
//     const prev = useStore.getState().threadsById[id] as Thread | undefined;
//     if (!prev) return;

//     // 楽観更新
//     bulkUpsertThreads([{ ...prev, name, updated_at: new Date().toISOString() } as any]);
//     try {
//       const updatedRaw = await renameThread(id, name);
//       const updated = asOne<Thread>(updatedRaw as any);
//       bulkUpsertThreads([updated]);
//       return updated;
//     } catch (e) {
//       bulkUpsertThreads([prev]);
//       setError(e);
//       throw e;
//     }
//   }, [bulkUpsertThreads]);

//   const removeThread = useCallback(async (threadId: string) => {
//     const id = String(threadId);
//     const prev = useStore.getState();

//     // 楽観削除
//     removeThreadCascade(id, projectId);
//     try {
//       await deleteThread(id);
//       await refetch();
//       return true;
//     } catch (e) {
//       const msg = String((e as any)?.message || "");
//       const benign = /not\s*found|already\s*deleted|no\s*such|does\s*not\s*exist/i.test(msg);
//       await refetch();
//       if (benign) return true;
//       useStore.setState(() => prev);
//       setError(e);
//       throw e;
//     }
//   }, [projectId, removeThreadCascade, refetch]);

//   useEffect(() => {
//     if (!projectId) return;
//     void refetch();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [projectId]);

//   return useMemo(
//     () => ({ threads, loading, error, refetch, addThread, editThreadName, removeThread }),
//     [threads, loading, error, refetch, addThread, editThreadName, removeThread]
//   );
// }
