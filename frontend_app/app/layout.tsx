import "../styles/globals.css";
// マークダウンのコンパイラ(?)を追加
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head />
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
