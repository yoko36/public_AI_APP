import { NextResponse } from "next/server";
const BACKEND = process.env.BACKEND_INTERNAL_URL!;

// ==================================================
// // ログアウト処理を行うメソッド（POST）
// ==================================================
export async function POST() {
  const beRes = await fetch(new URL("/api/v1/auth/logout", BACKEND), {
    method: "POST",
    credentials: "include",
  });

  const res = new NextResponse(null, { status: beRes.ok ? 200 : 500 });

  // トークン名を指定してクッキーを削除
  const names = (process.env.NEXT_PUBLIC_ACCESS_COOKIE_NAMES ??
    "sb-access-token,access_token,sb-refresh-token,refresh_token")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const name of names) {
    res.headers.append(
      "Set-Cookie",
      `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
    );
  }
  return res;
}