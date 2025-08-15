import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkEmoji from "remark-emoji";
// ↓ default export
import rehypeHighlightRaw from "rehype-highlight";
import rehypeKatex from "rehype-katex";

const rehypeHighlight = rehypeHighlightRaw as unknown as any; // ← 型だけ丸める

export function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="prose prose-sm sm:prose-base max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkEmoji as any]}
        rehypePlugins={[rehypeHighlight, rehypeKatex as any]}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
