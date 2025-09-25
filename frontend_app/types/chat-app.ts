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
