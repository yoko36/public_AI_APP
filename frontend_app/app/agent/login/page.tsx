"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const r = useRouter();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 既に認証済みなら /agent へ
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          method: "GET",
          headers: { "Cache-Control": "no-store" },
        });
        if (!aborted && res.ok) {
          const j = await res.json();
          if (j?.ok) r.replace("/agent");
        }
      } catch {

      }
    })();
    return () => {
      aborted = true;
    };
  }, [r]);

  // 認証ボタン押下時の処理
  const onSubmit: (e: React.FormEvent) => Promise<void> = async (e) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Login failed");
      r.replace("/agent");  // Agent(top page)に移動
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh relative overflow-hidden">
      {/* 背景 */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-fuchsia-500 to-rose-500 opacity-60" />
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-white/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-white/20 blur-3xl" />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-7xl items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <h1 className="inline-block rounded-xl bg-black/45 px-3 py-1 text-2xl font-semibold tracking-tight text-white">
              Welcome back
            </h1>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-2xl backdrop-blur">
            <form onSubmit={onSubmit} className="space-y-5">
              {/* ID */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-800">
                  ID（メールアドレス）
                </label>
                <div className="relative">
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    placeholder="you@example.com"
                    className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 outline-none focus:border-transparent focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 select-none text-slate-400">
                    ✉️
                  </span>
                </div>
              </div>

              {/* パスワード */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-800">
                  パスワード
                </label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 outline-none focus:border-transparent focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    aria-label="toggle password visibility"
                  >
                    {showPass ? "HIDE" : "SHOW"}
                  </button>
                </div>
              </div>

              {/* エラー */}
              {err && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {err}
                </div>
              )}

              {/* ボタン */}
              <button
                type="submit"
                disabled={loading}
                className="group relative inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white shadow-lg transition hover:bg-indigo-500 disabled:opacity-60"
              >
                {loading ? (
                  <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
                ) : null}
                <span>{loading ? "Signing in..." : "Sign in"}</span>
              </button>
            </form>

            <p className="mt-4 text-center text-xs text-slate-600">
              パスワードを忘れた場合は管理者にお問い合わせください
            </p>
          </div>

          <div className="mt-6 text-center text-xs text-white/90 drop-shadow"></div>
        </div>
      </div>
    </div>
  );
}
