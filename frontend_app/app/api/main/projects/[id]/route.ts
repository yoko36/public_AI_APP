export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ==================================================
// // クライアントからのリクエストをバックエンドに転送するときに必要なヘッダーをリクエストヘッダーからコピー（抜き出し）
// ==================================================
function forwardHeaders(req: Request) {
  const h = new Headers();
  for (const k of [
    "authorization",
    "cookie",
    "prefer",
    "content-profile",
    "apikey",
    "content-type",
    "accept",
    "x-csrf-token",
    "x-xsrf-token",
    "origin",
    "referer",
  ]) {
    const v = req.headers.get(k);
    if (v) h.set(k, v);
  }
  return h;
}

// ==================================================
// // プロジェクトに関する情報の変更を行うメソッド（UPDATE）
// ==================================================
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const backend = process.env.BACKEND_INTERNAL_URL!;
  const url = `${backend}/api/v1/projects/${encodeURIComponent(ctx.params.id)}`;

  let up: Response;
  try {
    up = await fetch(url, {
      method: "PATCH",
      headers: forwardHeaders(req),
      body: await req.text(),
      cache: "no-store",
      signal: (req as any).signal,
    });
  } catch (e: any) {
    console.error("[/api/v1/projects/:id] upstream fetch error:", e?.message ?? e);
    return new Response("gateway fetch error", { status: 502 });
  }

  const text = await up.text();
  const headers = new Headers();
  const ct = up.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  if (!up.ok) {
    console.error("[/api/v1/projects/:id] upstream", up.status, text);
    return new Response(text || "upstream error", { status: up.status, headers });
  }
  return new Response(text, { status: up.status, headers });  // サーバからのレスポンスをクライアントサイドに返す
}

// ==================================================
// // プロジェクトの削除を行うメソッド（DELETE）
// ==================================================
export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  const backend = process.env.BACKEND_INTERNAL_URL!;
  const url = `${backend}/api/v1/projects/${encodeURIComponent(ctx.params.id)}`;

  let up: Response;
  try {
    up = await fetch(url, {
      method: "DELETE",
      headers: forwardHeaders(req),
      cache: "no-store",
      signal: (req as any).signal,
    });
  } catch (e: any) {
    console.error("[/api/v1/projects/:id] upstream fetch error:", e?.message ?? e);
    return new Response("gateway fetch error", { status: 502 });
  }

  const text = await up.text().catch(() => ""); // サーバからのレスポンスに本文がない場合、空文字を返す
  const headers = new Headers();
  const ct = up.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  if (!up.ok) {
    console.error("[/api/v1/projects/:id] upstream", up.status, text);
    return new Response(text || "upstream error", { status: up.status, headers });
  }
  // 削除済みの場合は204ステータスコードを使用する
  if (up.status === 204) {
    return new Response(null, { status: 204, headers });
  }
  return new Response(text, { status: up.status, headers });  // サーバからのレスポンスをクライアントサイドに返す
}
