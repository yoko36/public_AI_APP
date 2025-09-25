"use client";

import { useEffect, useMemo, useState } from "react";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
} from "@/lib/repository/projects";
import { useStore } from "@/store/state";
import type { Project } from "@/types/chat-app";

/** 空配列は参照を固定して再レンダー暴発を防ぐ */
const EMPTY_IDS: ReadonlyArray<string> = Object.freeze([]);

/**
 * プロジェクト一覧の取得 + 作成/更新/削除フック
 * - RLSによりバックエンド側ですでに「自分のプロジェクト」に絞られて返る想定
 * - 呼び出し側は currentUserId を渡す（projectIdsByUserId を正しく張るため）
 */
const normalizeProject = (p: any): Project => ({
  ...p,
  overview: p?.overview ?? undefined,
});

export function useProjects(currentUserId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // ✅ equality 関数の第2引数は使わず、デフォルト比較 + EMPTY_IDS で参照安定化
  const projectIds = useStore((s: any) =>
    (s.projectIdsByUserId?.[currentUserId] as ReadonlyArray<string> | undefined) ?? EMPTY_IDS
  ) as ReadonlyArray<string>;

  const projectsById = useStore((s: any) => s.projectsById ?? {}) as Record<string, Project>;

  const projects = useMemo(
    () => projectIds.map((id) => projectsById[id]).filter(Boolean) as Project[],
    [projectIds, projectsById]
  );

  // 単体/配列のAPI戻り値を単体に正規化
  const asOne = <T,>(val: T | T[]): T => (Array.isArray(val) ? val[0] : val);

  const setProjectsIntoStore = (rows: Project[]) => {
    const normalized = rows.map(normalizeProject);
    useStore.setState((s: any) => ({
      projectsById: Object.fromEntries(normalized.map((p) => [String(p.id), p])),
      projectIdsByUserId: {
        ...(s.projectIdsByUserId ?? {}),
        [currentUserId]: normalized.map((p) => String(p.id)),
      },
    }));
  };

  const refetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listProjects();
      const arr = Array.isArray(data) ? data : [data];
      setProjectsIntoStore(arr as Project[]);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  /** 作成（name, overview?） */
  const addProject = async (name: string, overview?: string | null) => {
    const tmpId = `tmp-${crypto.randomUUID()}`;

    const optimistic: Project = {
      id: tmpId as any,
      userId: currentUserId as any,
      name,
      overview: overview ?? undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const prevState = useStore.getState();
    useStore.setState((s: any) => ({
      projectsById: { ...(s.projectsById ?? {}), [String(optimistic.id)]: optimistic },
      projectIdsByUserId: {
        ...(s.projectIdsByUserId ?? {}),
        [currentUserId]: [
          String(optimistic.id),
          ...(((s.projectIdsByUserId ?? {})[currentUserId] as string[] | undefined) ?? []),
        ],
      },
    }));

    try {
      const createdRaw = await createProject({ name, overview });
      const created = normalizeProject(asOne<Project>(createdRaw));

      useStore.setState((s: any) => {
        const map = { ...(s.projectsById ?? {}) };
        delete map[String(optimistic.id)];
        map[String(created.id)] = created;
        const ids = ((((s.projectIdsByUserId ?? {})[currentUserId] as string[] | undefined) ?? []) as string[]).map(
          (id) => (id === String(optimistic.id) ? String(created.id) : id)
        );
        return {
          projectsById: map,
          projectIdsByUserId: { ...(s.projectIdsByUserId ?? {}), [currentUserId]: ids },
        };
      });

      return created;
    } catch (e) {
      useStore.setState(() => prevState);
      setError(e);
      throw e;
    }
  };

  /** 更新（部分更新） */
  const editProject = async (
    projectId: string,
    patch: Partial<Pick<Project, "name" | "overview">>
  ) => {
    const id = String(projectId);
    const prev = (useStore.getState() as any).projectsById?.[id] as Project | undefined;
    if (!prev) return;

    useStore.setState((s: any) => ({
      projectsById: {
        ...(s.projectsById ?? {}),
        [id]: { ...prev, ...patch, updated_at: new Date().toISOString() } as Project,
      },
    }));

    try {
      const updatedRaw = await updateProject(id, patch);
      const updated = normalizeProject(asOne<Project>(updatedRaw));
      useStore.setState((s: any) => ({
        projectsById: { ...(s.projectsById ?? {}), [id]: updated },
      }));
      return updated;
    } catch (e) {
      useStore.setState((s: any) => ({
        projectsById: { ...(s.projectsById ?? {}), [id]: prev },
      }));
      setError(e);
      throw e;
    }
  };

  /** 削除 */
  const removeProject = async (projectId: string) => {
    const id = String(projectId);
    const prevState = useStore.getState();

    useStore.setState((s: any) => {
      const nextProjectsById = { ...(s.projectsById ?? {}) } as Record<string, Project>;
      delete nextProjectsById[id];
      const currentIds = (((s.projectIdsByUserId ?? {})[currentUserId] as string[] | undefined) ?? []) as string[];
      const nextIds = currentIds.filter((x) => x !== id);
      return {
        projectsById: nextProjectsById,
        projectIdsByUserId: { ...(s.projectIdsByUserId ?? {}), [currentUserId]: nextIds },
      };
    });

    try {
      await deleteProject(id);
      await refetch();          // 削除後にDBと同期
      return true;
    } catch (e) {
      const msg = String((e as any)?.message || "");
      // 既に削除済み等は成功扱い（冪等）
      const benign = /not\s*found|already\s*deleted|no\s*such|does\s*not\s*exist/i.test(msg);
      // 念のため同期
      await refetch();
      if (benign) {
        return true;
      }
      // 本当に失敗ならロールバック
      useStore.setState(() => prevState);
      setError(e);
      throw e;
    }
  };

  // 初回マウント時に取得
  useEffect(() => {
    if (!currentUserId) return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  return useMemo(
    () => ({ projects, loading, error, refetch, addProject, editProject, removeProject }),
    [projects, loading, error]
  );
}


// "use client";

// import { useEffect, useMemo, useState, useCallback } from "react";
// import { listProjects, createProject, updateProject, deleteProject } from "@/lib/repository/projects";
// import { useStore, EMPTY_IDS } from "@/store/state";
// import type { Project } from "@/types/chat-app";

// /** UIモデルの正規化（overview を undefined 許容） */
// const normalize = (p: any): Project => ({ ...p, overview: p?.overview ?? undefined });

// const asOne = <T,>(val: T | T[]): T => (Array.isArray(val) ? val[0] : val);

// export function useProjects(currentUserId: string) {
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState<unknown>(null);

//   const projectIds = useStore((s) => (s.projectIdsByUserId[currentUserId] ?? EMPTY_IDS)) as ReadonlyArray<string>;
//   const projectsById = useStore((s) => s.projectsById) as Record<string, Project>;

//   const bulkUpsertProjects = useStore((s) => s.bulkUpsertProjects);
//   const linkProjectIdsToUser = useStore((s) => s.linkProjectIdsToUser);
//   const removeProjectCascade = useStore((s) => s.removeProjectCascade);

//   const projects = useMemo(
//     () => projectIds.map((id) => projectsById[id]).filter(Boolean) as Project[],
//     [projectIds, projectsById]
//   );

//   const refetch = useCallback(async () => {
//     setLoading(true);
//     setError(null);
//     try {
//       const data = await listProjects();
//       const arr = (Array.isArray(data) ? data : [data]).map(normalize);
//       bulkUpsertProjects(arr);
//       linkProjectIdsToUser(currentUserId, arr.map((p) => String((p as any).id)));
//     } catch (e) {
//       setError(e);
//     } finally {
//       setLoading(false);
//     }
//   }, [bulkUpsertProjects, linkProjectIdsToUser, currentUserId]);

//   const addProject = useCallback(async (name: string, overview?: string | null) => {
//     const tmpId = `tmp-${crypto.randomUUID()}`;
//     const optimistic: Project = {
//       id: tmpId as any,
//       userId: currentUserId as any,
//       name,
//       overview: overview ?? undefined,
//       created_at: new Date().toISOString(),
//       updated_at: new Date().toISOString(),
//     };

//     const prev = useStore.getState();
//     // 楽観反映
//     bulkUpsertProjects([optimistic]);
//     linkProjectIdsToUser(
//       currentUserId,
//       [tmpId, ...((prev.projectIdsByUserId[currentUserId] ?? []) as string[])]
//     );

//     try {
//       const createdRaw = await createProject({ name, overview });
//       const created = normalize(asOne<Project>(createdRaw));
//       // tmp → real へ差し替え
//       const cur = useStore.getState();
//       const ids = (cur.projectIdsByUserId[currentUserId] ?? []).map((id) =>
//         id === tmpId ? String(created.id) : id
//       );
//       bulkUpsertProjects([created]);
//       linkProjectIdsToUser(currentUserId, ids);
//       return created;
//     } catch (e) {
//       // ロールバック
//       useStore.setState(() => prev);
//       setError(e);
//       throw e;
//     }
//   }, [bulkUpsertProjects, linkProjectIdsToUser, currentUserId]);

//   const editProject = useCallback(async (projectId: string, patch: Partial<Pick<Project, "name" | "overview">>) => {
//     const id = String(projectId);
//     const prev = useStore.getState().projectsById[id] as Project | undefined;
//     if (!prev) return;

//     // 楽観更新
//     bulkUpsertProjects([{ ...prev, ...patch, updated_at: new Date().toISOString() } as Project]);
//     try {
//       const updatedRaw = await updateProject(id, patch);
//       const updated = normalize(asOne<Project>(updatedRaw));
//       bulkUpsertProjects([updated]);
//       return updated;
//     } catch (e) {
//       // ロールバック
//       bulkUpsertProjects([prev]);
//       setError(e);
//       throw e;
//     }
//   }, [bulkUpsertProjects]);

//   const removeProject = useCallback(async (projectId: string) => {
//     const id = String(projectId);
//     const prev = useStore.getState();
//     // 楽観削除
//     removeProjectCascade(id);
//     try {
//       await deleteProject(id);
//       await refetch(); // 一致確認
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
//   }, [removeProjectCascade, refetch]);

//   // 初回/ユーザ変更時に取得
//   useEffect(() => {
//     if (!currentUserId) return;
//     void refetch();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [currentUserId]);

//   return useMemo(
//     () => ({ projects, loading, error, refetch, addProject, editProject, removeProject }),
//     [projects, loading, error, refetch, addProject, editProject, removeProject]
//   );
// }
