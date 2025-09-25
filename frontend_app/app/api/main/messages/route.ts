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
// // メッセージ取得メソッド（GET）
// ==================================================
export async function GET(req: Request) {
  const backend = process.env.BACKEND_INTERNAL_URL!;
  const url = new URL(`${backend}/api/v1/messages`);
  // クエリ（?threadId=... 等）をそのまま転送（URL全文）
  const inUrl = new URL(req.url);
  inUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v)); // バックエンドのURLにクエリの内容を転送

  const up = await fetch(url, {
    method: "GET",
    headers: forwardHeaders(req),
    cache: "no-store",
    signal: (req as any).signal,  // GETメソッドの通信が途中終了した場合にリクエストが中断されるようになる
  });
  return new Response(up.body, { status: up.status, headers: { "content-type": up.headers.get("content-type") ?? "application/json" } });
}

// ==================================================
// // メッセージ送信メソッド（POST）
// ==================================================
export async function POST(req: Request) {
  const backend = process.env.BACKEND_INTERNAL_URL!;
  const url = `${backend}/api/v1/messages`;
  let up: Response;
  try {
    up = await fetch(url, {
      method: "POST",
      headers: forwardHeaders(req),
      body: await req.text(), // JSONを生で中継
      cache: "no-store",
      signal: (req as any).signal,
    }); // サーバからのレスポンスを取得
  } catch (e: any) {
    console.error("[/api/main/messages] upstream fetch error:", e?.message ?? e);
    return new Response("gateway fetch error", { status: 502 });
  }
  const text = await up.text(); // 本文を読み込む（エラー内容を取り出す）
  const headers = new Headers();
  const ct = up.headers.get("content-type");  // サーバからのレスポンスヘッダー（content-type: 本文(text)の種別）をコピー
  if (ct) headers.set("content-type", ct);  // クライアント転送用のヘッダーにセット
  if (!up.ok) {
    console.error("[/api/main/messages] upstream", up.status, text);
    return new Response(text || "upstream error", { status: up.status, headers });
  }
  return new Response(text, { status: up.status, headers });  // クライアントサイドにレスポンスを返す
}
