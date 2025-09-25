// ファイル送信時に中継するエンドポイント
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const backend = process.env.BACKEND_INTERNAL_URL!;
  const form = await req.formData();
  const res = await fetch(`${backend}/api/upload`, { method: "POST", body: form as any });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
}