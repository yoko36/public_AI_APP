// ==================================================
// // 各プロジェクト、スレッド、メッセージについてCRUDを指示する中継関数群
// ==================================================
const BASE = "http://localhost:3000"; 

// null/undefined を除外して URL を作る 
// BASE URLに入力URLと入力クエリを接続する処理を行う
export function toURL(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>
) {
  const url = new URL(path, BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url;
}

// ==================================================
// // CRUDメソッド共通のレスポンス処理
// ==================================================
async function handle<T>(res: Response): Promise<T> {
  const isOk = res.ok;
  const ctype = res.headers.get("content-type") || "";
  const raw = await res.text().catch(() => "");

  if (!isOk) {
    throw new Error(raw || `HTTP ${res.status}`);
  }
  if (!raw) return undefined as unknown as T;
  // データがJSONの場合、JSONとして返す
  if (ctype.includes("application/json")) {
    return JSON.parse(raw) as T;
  }
  // JSON 以外も許容
  return raw as unknown as T;
}

// ==================================================
// // CRUDメソッドのAPIラッパー
// ==================================================
export async function apiGet<T>(path: string, query?: Record<string, any>) {
  const url = toURL(path, query); // URLを作成
  const res = await fetch(url, {
    method: "GET",
    credentials: "include", // ← Cookie を同送
    cache: "no-store",  // キャッシュの無効化（HTTP）
    headers: { "Cache-Control": "no-store" }, // キャッシュの無効化（ネットワークやサーバ）
  });
  return handle<T>(res);  // 返ってきたレスポンスに対して、handleでエラー処理などを行う
}

export async function apiPost<T>(path: string, body?: any) {
  const url = toURL(path); // URLを作成
  const res = await fetch(url, {
    method: "POST",
    credentials: "include", // ← Cookie を同送
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handle<T>(res);  // 返ってきたレスポンスに対して、handleでエラー処理などを行う
}

export async function apiPatch<T>(path: string, body?: any) {
  const url = toURL(path); // URLを作成
  const res = await fetch(url, {
    method: "PATCH",
    credentials: "include", // ← Cookie を同送
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handle<T>(res);  // 返ってきたレスポンスに対して、handleでエラー処理などを行う
}

export async function apiDelete<T = unknown>(path: string) {
  const url = toURL(path); // URLを作成
  const res = await fetch(url, {
    method: "DELETE",
    credentials: "include", // ← Cookie を同送
  });
  return handle<T>(res);  // 返ってきたレスポンスに対して、handleでエラー処理などを行う
}

