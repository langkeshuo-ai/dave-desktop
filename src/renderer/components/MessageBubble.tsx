import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { useTranslation } from "react-i18next"
import ReactMarkdown from "react-markdown"
import hljs from "highlight.js/lib/core"
import typescript from "highlight.js/lib/languages/typescript"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import bash from "highlight.js/lib/languages/bash"
import python from "highlight.js/lib/languages/python"
import css from "highlight.js/lib/languages/css"
import xml from "highlight.js/lib/languages/xml"
import markdown from "highlight.js/lib/languages/markdown"
import diff from "highlight.js/lib/languages/diff"
import type { MessageRole } from "../../shared/types"

// 按需注册常用语言（避免全量 hljs 打入 bundle）
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("ts", typescript)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("js", javascript)
hljs.registerLanguage("json", json)
hljs.registerLanguage("bash", bash)
hljs.registerLanguage("sh", bash)
hljs.registerLanguage("shell", bash)
hljs.registerLanguage("python", python)
hljs.registerLanguage("py", python)
hljs.registerLanguage("css", css)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("html", xml)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("md", markdown)
hljs.registerLanguage("diff", diff)

/** 代码块渲染：hljs 高亮（块级）；行内代码浅底。跨组件复用（PatchPreviewCard 等）。 */
export function CodeBlock({ className, children }: { className?: string; children?: unknown }) {
  const match = /language-(\w+)/.exec(className ?? "")
  const lang = match?.[1] ?? ""
  // children 可能是多文本节点数组（含换行），join("") 避免 String() 的逗号分隔
  const raw = Array.isArray(children)
    ? children
        .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : ""))
        .join("")
    : typeof children === "string" || typeof children === "number"
      ? String(children)
      : ""
  const text = raw.replace(/\n$/, "")
  if (!className || !match) {
    return <code className="inline-code">{text}</code>
  }
  const html = hljs.getLanguage(lang)
    ? hljs.highlight(text, { language: lang }).value
    : hljs.highlightAuto(text).value
  return (
    <pre className="hljs">
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}

const markdownComponents = {
  code: CodeBlock,
} as const

/** 消息气泡：user 右侧琥珀；assistant Markdown；tool 等宽；支持流式光标、中止标记与复制。 */
export function MessageBubble({
  role,
  content,
  streaming = false,
  aborted = false,
}: {
  role: MessageRole
  content: string
  streaming?: boolean
  aborted?: boolean
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* 剪贴板不可用时静默 */
    }
  }

  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-[14px_14px_4px_14px] bg-[var(--amber-600)] px-3.5 py-2.5 text-[13.5px] text-white shadow-sm">
          {content}
        </div>
      </div>
    )
  }

  const body =
    streaming || role === "tool" || aborted ? (
      <span className="whitespace-pre-wrap break-words">{content}</span>
    ) : (
      <div className="md-body break-words text-[13.5px] leading-relaxed">
        <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
      </div>
    )

  return (
    <div className="group flex justify-start">
      <div
        className={`min-w-0 max-w-full text-sm ${
          role === "tool"
            ? "rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-mono text-[12.5px] text-[var(--ink-2)]"
            : ""
        }`}
      >
        {body}
        {streaming && (
          <span className="ml-0.5 inline-block h-[1.05em] w-[2px] animate-pulse bg-[var(--amber-600)] align-[-2px]" />
        )}
        {aborted && (
          <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-[var(--amber-600)]/30 bg-[var(--amber-50)] px-2 py-0.5 text-[11px] font-medium text-[var(--amber-600)]">
            {t("chat.aborted")}
          </span>
        )}
      </div>
      {!streaming && (role === "assistant" || role === "tool") && content && (
        <button
          aria-label={t("common.copy")}
          title={copied ? t("common.copied") : t("common.copy")}
          onClick={() => void copy()}
          className="ml-1.5 mt-0.5 hidden h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] group-hover:grid"
        >
          {copied ? <Check size={13} className="text-[var(--ok)]" /> : <Copy size={13} />}
        </button>
      )}
    </div>
  )
}
