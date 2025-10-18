export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const backend = process.env.BACKEND_INTERNAL_URL!;
  const url = `${backend.replace(/\/$/, "")}/api/v1/attachments`;

const inHeaders = req.headers;
  // サーバに転送する際のヘッダーを作成
  const fwd = new Headers();
  const ct = inHeaders.get("content-type");
  if (ct) fwd.set("content-type", ct);
  const auth = inHeaders.get("authorization");
  if (auth) fwd.set("authorization", auth);
  const cookie = inHeaders.get("cookie");
  if (cookie) fwd.set("cookie", cookie);
  // POSTメソッドに対応
  fwd.set("Content-Profile", "app");

  // content-length / transfer-encoding は自前で書かない
  const upstream = await fetch(url, {
    method: "POST",
    headers: fwd,
    body: req.body,
    // @ts-expect-error
    duplex: "half",
  });

  // レスポンスはストリームのまま返す
  const outHeaders = new Headers(upstream.headers);
  outHeaders.set("Cache-Control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

export async function GET() {
  return Response.json({ ok: true });
}
