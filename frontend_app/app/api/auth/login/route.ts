export const runtime = "nodejs";
import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_INTERNAL_URL;

// ==================================================
// // ログイン処理を行うメソッド（POST）
// ==================================================

export async function POST(req: Request) {
  if (!BACKEND) {
    console.error("[/api/auth/login] BACKEND_URL not set");
    return new NextResponse("BACKEND_URL not set", { status: 500 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return new NextResponse("Invalid JSON", { status: 400 });

  try {
    const be = await fetch(new URL("/api/v1/auth/login", BACKEND), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await be.text();
    if (!be.ok) return new NextResponse(text || "Login failed", { status: be.status });

    const res = new NextResponse(text, { status: 200 });

    // レスポンスからCookieの情報を抜き出し、保存する
    const setCookies: string[] =
      (typeof (be.headers as any).getSetCookie === "function" &&
        (be.headers as any).getSetCookie()) ||
      (be.headers.get("set-cookie") ? [be.headers.get("set-cookie") as string] : []);

    for (const raw of setCookies) {
      if (!raw) continue;
      let rewritten = raw
        .replace(/;\s*Domain=[^;]+/gi, "")  // AppとAPIは同一ホストのドメインになるので、Domain属性を削除（__Host- 接頭辞を使用するとさらに強固）
        .replace(/;\s*Secure/gi, process.env.AUTH_COOKIE_INSECURE ? "" : "; Secure"); // Secure属性を状況によって付け外し（https->必ずつける、http->不要）
      res.headers.append("Set-Cookie", rewritten);  // app側に送るレスポンスにCookie情報を追加
    }
    return res;
  } catch (e: any) {
    console.error("[/api/auth/login] upstream error:", e?.message || e);
    return new NextResponse("Bad gateway to backend", {
      status: 502,
      headers: { "x-upstream-error": String(e?.message ?? e) },
    });
  }
}
