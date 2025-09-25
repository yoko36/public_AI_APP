// middleware.ts（プロジェクトルート）
import { NextResponse, type NextRequest } from "next/server";

// ==================================================
// // 認証用 Cookie名を環境変数から取得
// ==================================================
const ACCESS_COOKIE_NAMES = (process.env.NEXT_PUBLIC_ACCESS_COOKIE_NAMES ??
  "sb-access-token,access_token")
  .split(",")
  .map((s) => s.trim()) // 空白削除
  .filter(Boolean); // 空の要素やfalsyを取り除く

// ==================================================
// // どのパスにミドルウェアを適用するか
// ==================================================
// 静的アセットは除外
export const config = {
  matcher: [
    "/agent",
    "/agent/:path*",
    "/app",
    "/app/:path*",
  ],
};

// 公開で素通りさせたいパス（ログイン・ヘルス・認証APIなど）
function isPublicPath(pathname: string) {
  if (pathname.startsWith("/agent/login")) return true;
  if (pathname.startsWith("/api/auth/")) return true; // ← フロントの認証用 Route Handler を必ず除外
  if (pathname === "/health") return true;
  return false;
}

export default async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl; // パスとクエリを取得

  // ログイン/公開エンドポイントは素通り
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // フロントドメインで見える Cookie を確認
  const hasAccessCookie = ACCESS_COOKIE_NAMES.some((name) =>
    Boolean(req.cookies.get(name)?.value)
  );

  // 認証 Cookie が無ければログインへ
  if (!hasAccessCookie) {
    // リクエスト先のURLを保存
    const to = req.nextUrl.clone(); 
    to.pathname = "/agent/login";
    to.search = search
      ? `?next=${encodeURIComponent(pathname + search)}`  // クエリがあるならクエリ付きで"next="から始まる文字列の後にクエリとしてURLに追加
      : `?next=${encodeURIComponent(pathname)}`;  // クエリがない場合、パスのみURLに追加
    return NextResponse.redirect(to); // ログインページに遷移し、認証後にもともとリクエストしていたページに遷移
  }

  // 認証 Cookie がある → 通過
  return NextResponse.next();
}
