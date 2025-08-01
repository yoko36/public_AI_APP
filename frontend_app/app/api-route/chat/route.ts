// app/api-route/chat/route.ts
import { NextRequest } from "next/server";

// テスト用
export async function GET() {
  return Response.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const backend = process.env.BACKEND_URL; // 開発ローカル想定

  const res = await fetch(`${backend}/api/chatbot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}