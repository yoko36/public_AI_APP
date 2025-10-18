export const runtime = "nodejs"; // Nodeランタイムでストリーミング
export const dynamic = "force-dynamic";

// テスト用
export async function GET() {
  return Response.json({ ok: true });
}

export async function POST(req: Request) {
  const backend = process.env.BACKEND_INTERNAL_URL;
  const url = `${backend}/api/v1/chatbot`;
  const cookie = req.headers.get("cookie") || "";// Cookieの取得
  // JSON データを JS のオブジェクトにする
  const payload = await req.json();

  // クライアントのリクエストボディをそのままバックエンドへ
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Connection: "keep-alive",
      Cookie: cookie,
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify(payload),
     // @ts-expect-error: Undici 拡張。Nodeの fetch でストリーム送信時は必須
    duplex: "half",
  });

  // バックエンドのSSEをそのまま返す
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
