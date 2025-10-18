export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ヘッダー転送（参考コードに揃える）
function forwardHeaders(req: Request) {
  const h = new Headers();
  for (const k of ["authorization", "cookie", "prefer", "content-profile", "apikey", "content-type", "accept"]) {
    const v = req.headers.get(k);
    if (v) h.set(k, v);
  }
  return h;
}

function upstreamBase() {
  const base = (process.env.EXTERNAL_URL || process.env.BACKEND_INTERNAL_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("EXTERNAL_URL or BACKEND_INTERNAL_URL is not set");
  return `${base}/api/v1`;
}

function buildUpstreamUrl(req: Request) {
  const inUrl = new URL(req.url);
  const path = inUrl.searchParams.get("path");
  if (!path) throw new Error("Missing ?path");
  const qs = new URLSearchParams(inUrl.searchParams);
  qs.delete("path");
  const url = new URL(`${upstreamBase()}/${path.replace(/^\//, "")}`);
  qs.forEach((v, k) => url.searchParams.set(k, v));
  return url;
}

// ---- GET/HEAD：ストリーム転送（大きめレスポンス向き）
export async function GET(req: Request) {
  let url: URL;
  try { url = buildUpstreamUrl(req); }
  catch (e: any) { return new Response(e?.message || "bad request", { status: 400 }); }

  let up: Response;
  try {
    up = await fetch(url, {
      method: "GET",
      headers: forwardHeaders(req),
      cache: "no-store",
      signal: (req as any).signal,
    });
  } catch (e: any) {
    console.error("[/api/file GET] upstream fetch error:", e?.message ?? e);
    return new Response("gateway fetch error", { status: 502 });
  }
  return new Response(up.body, { status: up.status, headers: { "content-type": up.headers.get("content-type") ?? "application/json" } });
}

// ---- POST：本文を読み切って返却（エラー本文も透過）
export async function POST(req: Request) {
  return writeThrough(req, "POST");
}
// ---- PATCH
export async function PATCH(req: Request) {
  return writeThrough(req, "PATCH");
}
// ---- PUT
export async function PUT(req: Request) {
  return writeThrough(req, "PUT");
}
// ---- DELETE
export async function DELETE(req: Request) {
  return writeThrough(req, "DELETE");
}

async function writeThrough(req: Request, method: "POST" | "PATCH" | "PUT" | "DELETE") {
  let url: URL;
  try { url = buildUpstreamUrl(req); }
  catch (e: any) { return new Response(e?.message || "bad request", { status: 400 }); }

  let up: Response;
  try {
    console.log("url: ", url)
    up = await fetch(url, {
      method,
      headers: forwardHeaders(req),
      body: method === "DELETE" ? undefined : await req.text(), // JSON等を生で中継
      cache: "no-store",
      signal: (req as any).signal,
    });
  } catch (e: any) {
    console.error(`[/api/file ${method}] upstream fetch error:`, e?.message ?? e);
    return new Response("gateway fetch error", { status: 502 });
  }

  const text = await up.text();
  const headers = new Headers();
  const ct = up.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  if (!up.ok) {
    console.error(`[/api/file ${method}] upstream`, up.status, text);
    return new Response(text || "upstream error", { status: up.status, headers });
  }
  return new Response(text, { status: up.status, headers });
}
