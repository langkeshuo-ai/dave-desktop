import { memo, useCallback, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Check, Copy, FileCode2 } from "lucide-react"
import type { PluggableList } from "unified"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import rehypeHighlightSubset from "../lib/rehype-highlight-subset"

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className"]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className"]],
    pre: [...(defaultSchema.attributes?.pre ?? []), ["className"]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className"]],
  },
}

const rehypeSanitizePlugin = [rehypeSanitize as never, sanitizeSchema as never]

// memo：同 content 跳过重解析；流式场景由上层 throttle 控制 content 更新频率。
export const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitizePlugin, rehypeHighlightSubset] as PluggableList}
      components={{ pre: CodeBlockPre, code: InlineCodeRenderer }}
    >
      {content}
    </ReactMarkdown>
  )
})

function CodeBlockPre({ children }: { children?: ReactNode }) {
  const codeEl: unknown = Array.isArray(children)
    ? children.find((child: unknown) => {
        const candidate = child as { type?: unknown }
        return candidate?.type === "code"
      })
    : children
  const el = codeEl as { props?: { className?: string; children?: unknown } } | null
  const className: string = el?.props?.className || ""
  const lang =
    className
      .split(/\s+/)
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length) || "text"
  const raw = el?.props?.children ?? ""
  const text =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join("") : JSON.stringify(raw)

  return (
    <CodeBlock lang={lang} code={text}>
      {codeEl as ReactNode}
    </CodeBlock>
  )
}

function CodeBlock({ lang, code, children }: { lang: string; code: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    void navigator.clipboard
      .writeText(code)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }, [code])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="lang-tag flex items-center gap-1.5">
          <FileCode2 size={11} /> {lang}
        </span>
        <button
          onClick={copy}
          className={`copy-btn flex items-center gap-1 ${copied ? "copied" : ""}`}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="code-block-body hljs">
        <code className={`language-${lang}`}>{children ?? code}</code>
      </pre>
    </div>
  )
}

function InlineCodeRenderer({ children }: { children?: ReactNode }) {
  return <code className="not-hljs">{children}</code>
}
