// チャットシステムに関するストア状態の定義
"use client"

import { create } from "zustand"
import { devtools } from "zustand/middleware"

// レンダリングのタイミングで異なるデータを読み込むことによる無限ループ(恐れ)を防ぐために定義
// Reactでは「const projects = useStore(s => s.projects[userId] ?? []);」のようなコードは"[]"を新規作成する扱いになる
export const EMPTY_PROJECTS: ReadonlyArray<Project> = Object.freeze([]);
export const EMPTY_THREADS: ReadonlyArray<Thread> = Object.freeze([]);
export const EMPTY_MESSAGES: ReadonlyArray<Message> = Object.freeze([]);

export type User = {
    id: string;
    name: string;
    updated_at: string;
}

export type Project = {
    id: string;
    name: string;
    userId: string;
    overview?: string;
    created_at: string
    updated_at: string
}

export type Thread = {
    id: string;
    name: string;
    projectId: string;
    created_at: string;
    updated_at: string;
}

export type Message = {
    id: string;
    content: string;
    threadId: string;
    role: "user" | "assistant";
    created_at: string
}

type State = {
    usersById: Record<string, User>            // key: userId => value: User

    projectsById: Record<string, Project>;       // key: projectId => value: Project
    projectIdsByUserId: Record<string, string[]>   // key: userId =. value: プロジェクト一覧(id一覧)

    threadsById: Record<string, Thread>;         // key: threadId => value: Thread
    threadIdsByProjectId: Record<string, string[]> // key: projectId =. value: スレッド一覧(id一覧)

    messagesById: Record<string, Message>;       // key: messageId => value: Message
    messageIdsByThreadId: Record<string, string[]> // key: threadId =. value: メッセージ一覧(id一覧)

    selectedProjectId?: string // 表示中のスレッドを保持しているプロジェクトのID
    selectedThreadId?: string  // 表示中のスレッドのID

    projectCounter: number // 開発用
    threadCounter: number //開発用
    messageCounter: number
}

type Actions = {
    // 初期化関数(ユーザー、プロジェクト、スレッド、メッセージすべて初期化だから使用タイミングがないかも => TODO: 引数で初期化対象を設定できるといいかも)
    setInitial: () => void

    // ユーザデータ管理
    getLoginUser: (userId: string) => User | undefined // ログイン中のユーザ情報を取得
    updateUser: (id: string, userName: string) => void // 
    // 一般ユーザは操作不可(予定)
    createUser: (userName: string) => void
    deleteUser: (id: string) => void

    // プロジェクトデータ管理
    createProject: (name: string, userId: string, overview?: string) => void // プロジェクトの作成
    getProjectByUserId: (userId: string) => Project[] // 指定したプロジェクトに含まれるスレッドの取得
    updateProject: (id: string, name: string, overview?: string) => void // プロジェクトの修正
    deleteProject: (id: string) => void // プロジェクトの削除

    // スレッドデータ管理
    createThread: (name: string, projectId: string) => void // スレッドの作成
    getThreadsByProjectId: (projectId: string) => Thread[] // スレッドの取得
    updateThread: (id: string, name: string) => void // スレッドの修正
    deleteThread: (id: string) => void // スレッドの削除
    selectThread: (id: string) => void // 表示中のスレッドを設定

    // メッセージデータ管理
    createMessage: (content: string, threadId: string, role: "user" | "assistant") => void // メッセージの作成
    getMessagesByThreadId: (threadId: string) => Message[] // メッセージの取得
    updateMessage: (id: string, content: string) => void // メッセージの修正
    deleteMessage: (id: string) => void // メッセージの削除
}


// 汎用関数群
// 日本時間の取得(引数なし: 現在の時刻)
function nowJSTformat(date = new Date()) {
    const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000); // UTC→JSTへ加算
    const year = jstDate.getUTCFullYear();
    const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(jstDate.getUTCDate()).padStart(2, '0');
    const hours = String(jstDate.getUTCHours()).padStart(2, '0');
    const minutes = String(jstDate.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}
// 配列に対して重複のないIDを作成する(配列に先頭から登録)
function pushUnique(arr: string[] | undefined, id: string): string[] {
    const base = arr ?? [];
    return base.includes(id) ? base : [id, ...base]; // 先頭追加（新しい順）
}
// 配列から特定のIDを削除する
function removeId(arr: string[] | undefined, id: string): string[] {
    const base = arr ?? [];
    return base.filter(x => x !== id);
}

// 状態管理
export const useStore = create<State & Actions>()(devtools((set, get) => ({
    usersById: {},
    projectsById: {},
    projectIdsByUserId: {},
    threadsById: {},
    threadIdsByProjectId: {},
    messagesById: {},
    messageIdsByThreadId: {},

    selectedProjectId: undefined,
    selectedThreadId: undefined,

    projectCounter: 0,
    threadCounter: 0,
    messageCounter: 0,

    // データの初期化
    setInitial: () => set({
        usersById: {},
        projectsById: {},
        projectIdsByUserId: {},
        threadsById: {},
        threadIdsByProjectId: {},
        messagesById: {},
        messageIdsByThreadId: {},
        selectedProjectId: undefined,
        selectedThreadId: undefined,
        projectCounter: 0,
        threadCounter: 0,
        messageCounter: 0,
    }),

    // ======================== ユーザデータ管理の定義 ======================== 
    getLoginUser: (userId) => get().usersById[userId],

    updateUser: (id, userName) =>
        set((s) => {
            const users = s.usersById[id];
            if (!users) return s;
            return {
                usersById: { ...s.usersById, [id]: { ...users, name: userName, updated_at: nowJSTformat() } } // idの要素を上書きする
            };
        }),

    createUser: (userName) =>
        set((s) => {
            const id = String(Object.keys(s.usersById).length + 1); // ユーザID(連番)の作成(変更予定)
            const user: User = { id, name: userName, updated_at: nowJSTformat() };
            return { usersById: { ...s.usersById, [id]: user } };
        }),

    deleteUser: (id) =>
        // 削除するテーブルは全７つ(確認用: 削除1～7)
        set((s) => {
            if (!s.usersById[id]) return s;
            const nextUsers = { ...s.usersById }; // 更新後のユーザテーブル
            delete nextUsers[id]; // deleteを使用してユーザテーブルから該当データを削除（削除1）

            // ユーザ配下のプロジェクト(スレッド、メッセージ)も一括削除
            // 各種変更後のステートを定義
            let nextProjectsById = { ...s.projectsById };
            let nextProjectIdsByUserId = { ...s.projectIdsByUserId };
            let nextThreadsById = { ...s.threadsById };
            let nextThreadIdsByProjectId = { ...s.threadIdsByProjectId };
            let nextMessagesById = { ...s.messagesById };
            let nextMessageIdsByThreadId = { ...s.messageIdsByThreadId };

            // プロジェクトテーブル内 -> スレッドテーブル内 -> メッセージテーブル内という流れで3重forループ
            const projectIds = s.projectIdsByUserId[id] ?? []; // ユーザIDからプロジェクトIDテーブルを取得
            for (const pid of projectIds) {
                // スレッドテーブルを取得
                const tids = s.threadIdsByProjectId[pid] ?? [];
                for (const tid of tids) {
                    // メッセージテーブルを取得
                    const mids = s.messageIdsByThreadId[tid] ?? []; // メッセージIDを取得
                    for (const mid of mids) delete nextMessagesById[mid]; // メッセージテーブルの削除(削除2)
                    delete nextMessageIdsByThreadId[tid]; // (削除3)
                    delete nextThreadsById[tid]; // (削除4)
                }
                delete nextThreadIdsByProjectId[pid]; // (削除5)
                delete nextProjectsById[pid]; // (削除6)
            }
            delete nextProjectIdsByUserId[id]; // (削除7)

            // 表示するスレッド(プロジェクト)について
            const nextSelectedProjectId =
                projectIds.includes(s.selectedProjectId ?? "") ? undefined : s.selectedProjectId; // 削除したプロジェクトが表z死しているスレッドのものかどうか
            const nextSelectedThreadId =
                (s.selectedThreadId && !!nextThreadsById[s.selectedThreadId]) ? s.selectedThreadId : undefined; // 削除したプロジェクトが表z死しているスレッドのものかどうか

            // 削除後のデータに置き換える
            return {
                usersById: nextUsers,
                projectsById: nextProjectsById,
                projectIdsByUserId: nextProjectIdsByUserId,
                threadsById: nextThreadsById,
                threadIdsByProjectId: nextThreadIdsByProjectId,
                messagesById: nextMessagesById,
                messageIdsByThreadId: nextMessageIdsByThreadId,
                selectedProjectId: nextSelectedProjectId,
                selectedThreadId: nextSelectedThreadId,
            };
        }),

    // ======================== プロジェクトデータ管理の定義 ======================== 
    createProject: (name, userId, overview) =>
        set((s) => {
            const projectId = String(s.projectCounter);
            const project: Project = {
                id: projectId,
                name,
                userId,
                overview,
                created_at: nowJSTformat(),
                updated_at: nowJSTformat(),
            };
            return {
                projectsById: { ...s.projectsById, [projectId]: project },          // プロジェクトテーブルに新規追加
                projectIdsByUserId: {
                    ...s.projectIdsByUserId,
                    [userId]: pushUnique(s.projectIdsByUserId[userId], projectId),
                },                                                                  // プロジェクトIDテーブルに新規追加
                projectCounter: s.projectCounter + 1,
            };
        }),

    getProjectByUserId: (userId) => {
        const ids = get().projectIdsByUserId[userId] ?? []; // 1) 指定したユーザのプロジェクトIDテーブルを取得
        if (ids.length === 0) return EMPTY_PROJECTS;
        const map = get().projectsById;                     // 2) プロジェクトテーブルを取得
        return ids.map((id) => map[id]).filter(Boolean);    // 2で取得したテーブルに対して1で取得したIDをキーとしてバリューを取得
    },

    updateProject: (id, name, overview) =>
        set((s) => {
            const project = s.projectsById[id]; // 更新先のプロジェクトを取得
            if (!project) return s;
            return {
                projectsById: {
                    ...s.projectsById,
                    [id]: { ...project, name, overview, updated_at: nowJSTformat() } // プロジェクトを更新(上書き)
                }
            };
        }),

    deleteProject: (projectId) =>
        // 完全に削除するテーブルは計5つ(+プロジェクトIDテーブルは該当IDのみ削除)
        set((s) => {
            const p = s.projectsById[projectId]; // IDからプロジェクト一覧を取得
            if (!p) return s;

            // 指定したプロジェクトを削除(1)
            const nextProjectsById = { ...s.projectsById };
            delete nextProjectsById[projectId];

            // プロジェクトIDテーブルから指定したIDを削除 (+)
            const nextProjectIdsByUserId = {
                ...s.projectIdsByUserId,
                [p.userId]: removeId(s.projectIdsByUserId[p.userId], projectId),
            };

            // 削除後の各種テーブルを定義
            const tids = s.threadIdsByProjectId[projectId] ?? [];
            const nextThreadsById = { ...s.threadsById };
            const nextThreadIdsByProjectId = { ...s.threadIdsByProjectId };
            const nextMessagesById = { ...s.messagesById };
            const nextMessageIdsByThreadId = { ...s.messageIdsByThreadId };

            for (const tid of tids) {
                const mids = s.messageIdsByThreadId[tid] ?? [];
                for (const mid of mids) delete nextMessagesById[mid];   // (2)
                delete nextMessageIdsByThreadId[tid];                   // (3)
                delete nextThreadsById[tid];                            // (4)
            }
            delete nextThreadIdsByProjectId[projectId];                 // (5)

            const nextSelectedProjectId = s.selectedProjectId === projectId ? undefined : s.selectedProjectId;
            const nextSelectedThreadId =
                s.selectedThreadId && tids.includes(s.selectedThreadId) ? undefined : s.selectedThreadId;
            // 6つのテーブルと選択状態を書き換え(削除)
            return {
                projectsById: nextProjectsById,
                projectIdsByUserId: nextProjectIdsByUserId,
                threadsById: nextThreadsById,
                threadIdsByProjectId: nextThreadIdsByProjectId,
                messagesById: nextMessagesById,
                messageIdsByThreadId: nextMessageIdsByThreadId,
                selectedProjectId: nextSelectedProjectId,
                selectedThreadId: nextSelectedThreadId,
            };
        }),
    // ======================== スレッドデータ管理の定義 ======================== 
    createThread: (name, projectId) =>
        set((s) => {
            const threadId = String(s.threadCounter);
            const thread: Thread = {
                id: threadId,
                name,
                projectId,
                created_at: nowJSTformat(),
                updated_at: nowJSTformat(),
            };
            return {
                threadsById: { ...s.threadsById, [threadId]: thread },                      // スレッドテーブルにデータを追加
                threadIdsByProjectId: {
                    ...s.threadIdsByProjectId,
                    [projectId]: pushUnique(s.threadIdsByProjectId[projectId], threadId),
                },                                                                          // スレッドIDテーブルにIDを追加
                selectedThreadId: threadId,                                                 // 
                selectedProjectId: projectId,                                               // 
                threadCounter: s.threadCounter + 1,                                         // countを進める
            };
        }),

    getThreadsByProjectId: (projectId) => {
        const ids = get().threadIdsByProjectId[projectId] ?? [];    // 1) プロジェクトIDからスレッドIDテーブルを取得
        if (ids.length === 0) return EMPTY_THREADS;
        const map = get().threadsById;                              // 2) スレッドテーブルを取得
        return ids.map((id) => map[id]).filter(Boolean);            // 2で取得したテーブルに対して1で取得したIDをキーとして使用してスレッド一覧hの中身を取得
    },

    updateThread: (id, name) =>
        set((s) => {
            const t = s.threadsById[id];
            if (!t) return s;                                           // 変更予定のIDがスレッドテーブルにない場合途中終了
            return {
                threadsById: {
                    ...s.threadsById,
                    [id]: { ...t, name, updated_at: nowJSTformat() }
                }
            };
        }),

    deleteThread: (threadId) =>
        // 3つのテーブルを削除する(+スレッドIDテーブルは指定したIDのみ削除)
        set((s) => {
            const t = s.threadsById[threadId];
            if (!t) return s;                                                                               // 削除予定のスレッドがない場合途中終了
            const pid = t.projectId;

            const nextThreadsById = { ...s.threadsById };
            delete nextThreadsById[threadId];                                                               // (1) スレッドテーブルを削除

            const nextThreadIdsByProjectId = {
                ...s.threadIdsByProjectId,
                [pid]: removeId(s.threadIdsByProjectId[pid], threadId),
            };                                                                                              // (+)スレッドIDテーブル内の該当IDを削除

            const nextMessagesById = { ...s.messagesById };
            const nextMessageIdsByThreadId = { ...s.messageIdsByThreadId };

            const mids = s.messageIdsByThreadId[threadId] ?? [];
            for (const mid of mids) delete nextMessagesById[mid];                                           // (2) メッセージテーブルを削除
            delete nextMessageIdsByThreadId[threadId];                                                      // (3) メッセージIDテーブルを削除

            const nextSelectedThreadId = s.selectedThreadId === threadId ? undefined : s.selectedThreadId;  // 表示中のスレッドに関する処理
            // 削除後のデータで置き換える
            return {
                threadsById: nextThreadsById,
                threadIdsByProjectId: nextThreadIdsByProjectId,
                messagesById: nextMessagesById,
                messageIdsByThreadId: nextMessageIdsByThreadId,
                selectedThreadId: nextSelectedThreadId,
                selectedProjectId: s.selectedProjectId ?? pid,
            };
        }),

    // 表示中のスレッド(プロジェクト)のIDを保存する
    selectThread: (threadId) =>
        set((s) => {
            if (!threadId) return { selectedThreadId: undefined };
            const t = s.threadsById[threadId];
            const projectIdOfThread = t?.projectId;
            return {
                selectedThreadId: threadId,
                selectedProjectId: projectIdOfThread ?? s.selectedProjectId,
            };
        }),

    // ======================== メッセージデータ管理の定義 ======================== 
    createMessage: (content, threadId, role) =>
        set((s) => {
            const msgId = String(s.messageCounter);
            const msg: Message = {                                                      // 保存するメッセージを作成
                id: msgId,
                content,
                threadId,
                role,
                created_at: nowJSTformat(),
            };
            return {
                messagesById: { ...s.messagesById, [msgId]: msg },                      // メッセージテーブルに作成したメッセージを追加
                messageIdsByThreadId: {                                                 // メッセージIDテーブルに作成したメッセージのIDを追加
                    ...s.messageIdsByThreadId, 
                    [threadId]: [...(s.messageIdsByThreadId[threadId] ?? []), msgId],   // 時系列末尾に追加
                },
                messageCounter: s.messageCounter + 1,
            };
        }),

    getMessagesByThreadId: (threadId) => {
        const ids = get().messageIdsByThreadId[threadId] ?? [];     // 1) 指定したスレッド内のメッセージID一覧を取得
        if (ids.length === 0) return EMPTY_MESSAGES;
        const map = get().messagesById;                             // 2) メッセージ一覧を取得
        return ids.map((id) => map[id]).filter(Boolean);            // 2で取得したメッセージ一覧から1で取得した該当スレッド内のメッセージを抜き出す
    },

    updateMessage: (id, content) =>
        set((s) => {
            const m = s.messagesById[id];
            if (!m) return s;
            return {
                messagesById: { ...s.messagesById, [id]: { ...m, content } }
            };
        }),

    deleteMessage: (messageId) =>
        // メッセージテーブルを削除(1)し、メッセージIDテーブルから削除対象のIDを削除(2)
        set((s) => {
            const m = s.messagesById[messageId];
            if (!m) return s;
            const tid = m.threadId;

            const nextMessagesById = { ...s.messagesById };
            delete nextMessagesById[messageId];                             // (1) メッセージを削除

            const nextMessageIdsByThreadId = {                              // (2) メッセージIDテーブルから指定したメッセージのIDを削除
                ...s.messageIdsByThreadId,
                [tid]: removeId(s.messageIdsByThreadId[tid], messageId),    
            };
            // 削除後の状態で上書き
            return {
                messagesById: nextMessagesById,
                messageIdsByThreadId: nextMessageIdsByThreadId,
            };
        }),
}), { name: "app-store" })  // devtoolsのオプションで開発者ツールでの名前を設定する
);