export const runtime = "nodejs";  
import "./globals.css";
// マークダウンのコンパイラ(?)を追加

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