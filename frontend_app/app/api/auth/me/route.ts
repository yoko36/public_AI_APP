export const runtime = "nodejs";
import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_INTERNAL_URL; 

// ==================================================
// // 認証済みユーザかどうかを検証するメソッド（GET）
// ==================================================
export async function GET(req: Request) {
  if (!BACKEND) {
    console.error("[/api/auth/me] BACKEND_URL not set");
    return new NextResponse("BACKEND_URL not set", { status: 500 });
  }
  try {
    const be = await fetch(new URL("/api/v1/auth/me", BACKEND), {
      method: "GET",
      headers: {
        Cookie: req.headers.get("cookie") ?? "",  // クライアント側の Cookie の情報をサーバ側への送信リクエストに組み込む
        "Cache-Control": "no-store",
      },
    });
    const text = await be.text();
    return new NextResponse(text, { status: be.status }); // サーバから帰ってきたデータをクライアントサイドに転送
  } catch (e: any) {
    console.error("[/api/auth/me] upstream error:", e?.message || e);
    return new NextResponse("Bad gateway to backend", {
      status: 502,
      headers: { "x-upstream-error": String(e?.message ?? e) },
    });
  }
}
