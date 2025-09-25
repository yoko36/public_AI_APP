// app/api/v1/threads/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ==================================================
// // クライアントからのリクエストをバックエンドに転送するときに必要なヘッダーをリクエストヘッダーからコピー（抜き出し）
// ==================================================
function forwardHeaders(req: Request) {
  const h = new Headers();
  for (const k of ["authorization", "cookie", "prefer", "content-profile", "apikey", "content-type"]) {
    const v = req.headers.get(k);
    if (v) h.set(k, v);
  }
  return h;
}

// ==================================================
// // スレッド一覧を取得するメソッド（GET）
// ==================================================
export async function GET(req: Request) {
  const backend = process.env.BACKEND_INTERNAL_URL!;
  const url = new URL(`${backend}/api/v1/threads`);
  // フロントから受け取ったクエリをサーバに転送（クエリとして）
  const inUrl = new URL(req.url);
  inUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const up = await fetch(url, {
    method: "GET",
    headers: forwardHeaders(req),
    cache: "no-store",
    signal: (req as any).signal,
  });

  return new Response(up.body, {
    status: up.status,
    headers: { "content-type": up.headers.get("content-type") ?? "application/json" },
  });
}

// ==================================================
// // 新規スレッドを追加するメソッド（POST）
// ==================================================
export async function POST(req: Request) {
  const backend = process.env.BACKEND_INTERNAL_URL!;
  const url = `${backend}/api/v1/threads`;

  let up: Response;
  try {
    up = await fetch(url, {
      method: "POST",
      headers: forwardHeaders(req),
      body: await req.text(),
      cache: "no-store",
      signal: (req as any).signal,
    });
  } catch (e: any) {
    console.error("[/api/v1/threads] upstream fetch error:", e?.message ?? e);
    return new Response("gateway fetch error", { status: 502 });
  }

  const text = await up.text();
  const headers = new Headers();
  const ct = up.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  if (!up.ok) {
    console.error("[/api/v1/threads] upstream", up.status, text);
    return new Response(text || "upstream error", { status: up.status, headers });
  }
  return new Response(text, { status: up.status, headers });
}
