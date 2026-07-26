import { useEffect, useMemo, useState, useCallback, memo, lazy, Suspense } from "react"
import type { ChatMessage } from "../../shared/types"
import { parsePatchForView } from "../../shared/patch"
import {
  Bot,
  User,
  Copy,
  Check,
  FileCode2,
  Wrench,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Square,
} from "lucide-react"
import type { ReactVirtualizer, VirtualItem } from "@tanstack/react-virtual"
import type { PluggableList } from "unified"

// 只懒加载 ReactMarkdown 本体（减少首屏 ~150KB）
// 插件必须静态导入（unified 插件不是 React 组件）
const ReactMarkdown = lazy(() => import("react-markdown"))
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"

// rehype-sanitize 白名单配置 — 防御 LLM 输出的 XSS 攻击
// className 必须保留供代码高亮使用
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

// 统一白名单元组
const rehypeSanitizePlugin = [rehypeSanitize as never, sanitizeSchema as never]

interface MessageListProps {
  messages: ChatMessage[]
  streamingContent: string
  isStreaming: boolean
  onStop?: () => void
  onRegenerate?: (userContent: string) => void
  virtualItems: VirtualItem[]
  virtualizer: ReactVirtualizer<HTMLDivElement, Element>
}

const PATCH_PREFIX = "@@ patch"

function classifyContent(content: string): "patch" | "code" | "text" {
  if (content.startsWith("@@ patch") || /^---\s.*\n\+\+\+\s/m.test(content)) return "patch"
  if (/^```[\w+-]+\n/m.test(content) && content.trim().endsWith("```")) return "code"
  return "text"
}

export function MessageList({
  messages,
  streamingContent,
  isStreaming,
  onStop,
  onRegenerate,
  virtualItems,
  virtualizer,
}: MessageListProps) {
  // 找到最后一条 user 消息,作为 regenerate 的输入
  const lastUser = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].content
    }
    return null
  }, [messages])

  return (
    <>
      {virtualItems.map((virtualItem) => {
        const isLast = virtualItem.index === messages.length
        const msg = isLast
          ? { role: "assistant" as const, content: streamingContent }
          : messages[virtualItem.index]
        if (!msg) return null

        // 流式空内容 — 显示"思考中…"指示器
        if (isLast && isStreaming && !streamingContent) {
          return (
            <div
              key="streaming-thinking"
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              className="msg-row px-3 py-2"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <div className="msg-avatar assistant">
                <Bot size={14} />
              </div>
              <div className="msg-body flex items-center gap-2 text-xs text-[var(--text-dim)]">
                <span className="spinner" /> 思考中…
                <button
                  type="button"
                  onClick={onStop}
                  className="btn-icon-muted !p-1 ml-1 stop-btn"
                  title="停止生成"
                  aria-label="停止生成"
                >
                  <Square size={12} fill="currentColor" />
                </button>
              </div>
            </div>
          )
        }

        const isLastAssistant =
          !isLast && virtualItem.index === messages.length - 1 && msg.role === "assistant"

        return (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            className="px-3 py-2"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <MessageBubble
              message={msg}
              isStreaming={isLast && isStreaming}
              isLastAssistant={isLastAssistant}
              lastUserContent={lastUser}
              onStop={onStop}
              onRegenerate={onRegenerate}
            />
          </div>
        )
      })}
    </>
  )
}

// React.memo 包裹:streaming 时只有最末条 MessageBubble(带 isStreaming)
// 的 props 变化,其他历史消息的 message/lastUserContent 引用稳定,
// 跳过重渲染避免 ReactMarkdown 重复解析(长会话性能优化关键)。
// 自定义比较:isStreaming 标志翻转 / message 引用变化 / lastUserContent
// 变化 / 回调引用变化时才重渲染。
const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  isLastAssistant,
  lastUserContent,
  onStop,
  onRegenerate,
}: {
  message: ChatMessage
  isStreaming?: boolean
  isLastAssistant?: boolean
  lastUserContent?: string | null
  onStop?: () => void
  onRegenerate?: (userContent: string) => void
}) {
  if (message.role === "tool") {
    return <ToolTrace message={message} />
  }

  // Assistant with tool_calls and little/no text — compact call summary.
  if (
    message.role === "assistant" &&
    message.tool_calls &&
    message.tool_calls.length > 0 &&
    !message.content?.trim()
  ) {
    return (
      <div className="msg-row">
        <div className="msg-avatar assistant">
          <Wrench size={13} />
        </div>
        <div className="msg-body">
          <div className="tool-trace">
            <span className="tool-trace-title">调用工具</span>
            <span className="tool-trace-names">
              {message.tool_calls.map((tc) => tc.function.name).join(" · ")}
            </span>
          </div>
        </div>
      </div>
    )
  }

  const isUser = message.role === "user"
  const kind = classifyContent(message.content || "")

  return (
    <div className={`msg-row ${isUser ? "user" : ""}`}>
      <div className={`msg-avatar ${isUser ? "user" : "assistant"}`}>
        {isUser ? <User size={13} /> : <Bot size={13} />}
      </div>
      <div className={`msg-body ${isUser ? "user" : ""}`}>
        {isUser ? (
          <div className="msg-bubble user whitespace-pre-wrap break-words">{message.content}</div>
        ) : kind === "patch" ? (
          <PatchView body={message.content} streaming={isStreaming} />
        ) : (
          <div className="msg-bubble assistant markdown-content">
            {message.tool_calls && message.tool_calls.length > 0 && (
              <div className="tool-trace mb-2">
                <span className="tool-trace-title">附带工具</span>
                <span className="tool-trace-names">
                  {message.tool_calls.map((tc) => tc.function.name).join(" · ")}
                </span>
              </div>
            )}
            <Suspense
              fallback={
                <div className="text-sm opacity-60 whitespace-pre-wrap">{message.content}</div>
              }
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitizePlugin, rehypeHighlight] as PluggableList}
                components={{ pre: CodeBlockPre, code: InlineCodeRenderer }}
              >
                {message.content || ""}
              </ReactMarkdown>
            </Suspense>
            {isStreaming && (
              <span className="inline-block w-1.5 h-3.5 bg-[var(--accent)] ml-0.5 align-middle animate-pulse" />
            )}
            <MessageActions
              isStreaming={!!isStreaming}
              isLastAssistant={!!isLastAssistant}
              content={message.content || ""}
              lastUserContent={lastUserContent ?? null}
              onStop={onStop}
              onRegenerate={onRegenerate}
            />
          </div>
        )}
      </div>
    </div>
  )
})

/** 内联操作条:复制 / 重新生成 / 停止。复制是本地能力,其余委托上层。 */
function MessageActions({
  isStreaming,
  isLastAssistant,
  content,
  lastUserContent,
  onStop,
  onRegenerate,
}: {
  isStreaming: boolean
  isLastAssistant: boolean
  content: string
  lastUserContent: string | null
  onStop?: () => void
  onRegenerate?: (userContent: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    if (!content) return
    // clipboard 写失败(权限 / 非 secure context)时降级:仅给视觉反馈,
    // 不抛错,避免在工具栏里冒红框影响后续操作。
    void navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true)
      })
      .catch(() => {
        setCopied(false)
      })
  }, [content])

  // 复制成功的视觉反馈(1.5s 自动撤销)。必须在 effect 里清理,避免组件卸载后
  // 仍触发 setState 产生 "setState on unmounted" 警告 + 计时器泄漏。
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <div className={`msg-actions ${isStreaming ? "streaming" : ""}`}>
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="btn-icon-muted stop-btn"
          title="停止生成"
          aria-label="停止生成"
        >
          <Square size={12} fill="currentColor" />
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={copy}
            className={`btn-icon-muted ${copied ? "text-[var(--diff-add)]" : ""}`}
            title={copied ? "已复制" : "复制"}
            aria-label="复制消息"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          {isLastAssistant && lastUserContent && onRegenerate && (
            <button
              type="button"
              onClick={() => onRegenerate(lastUserContent)}
              className="btn-icon-muted"
              title="重新生成"
              aria-label="重新生成"
            >
              <RefreshCw size={12} />
            </button>
          )}
        </>
      )}
    </div>
  )
}

function ToolTrace({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false)
  const name = message.name || "tool"
  const preview = (message.content || "").slice(0, 120).replace(/\s+/g, " ")
  const failed = /^工具失败|^错误：|^用户拒绝/.test(message.content || "")

  return (
    <div className="msg-row">
      <div className={`msg-avatar ${failed ? "tool-fail" : "tool"}`}>
        <Wrench size={13} />
      </div>
      <div className="msg-body">
        <button
          type="button"
          className={`tool-trace ${failed ? "fail" : ""}`}
          onClick={() => setOpen(!open)}
          title="展开/折叠工具输出"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="tool-trace-title">{name}</span>
          <span className="tool-trace-preview">
            {open ? "" : preview}
            {!open && (message.content?.length ?? 0) > 120 ? "…" : ""}
          </span>
        </button>
        {open && <pre className="tool-trace-body">{message.content || "(无输出)"}</pre>}
      </div>
    </div>
  )
}

function CodeBlockPre({ children }: { children?: React.ReactNode }) {
  const codeEl: unknown = Array.isArray(children)
    ? children.find((c: unknown) => {
        const candidate = c as { props?: { className?: string } }
        return candidate?.props?.className?.startsWith("language-")
      })
    : (children as { props?: { className?: string } })?.props?.className?.startsWith("language-")
      ? children
      : null
  const el = codeEl as { props?: { className?: string; children?: unknown } } | null
  const className: string = el?.props?.className || ""
  const lang = className.replace("language-", "").trim() || "text"
  const raw = el?.props?.children ?? ""
  const text =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join("") : JSON.stringify(raw)

  return (
    <CodeBlock lang={lang} code={text}>
      {codeEl as React.ReactNode}
    </CodeBlock>
  )
}

function CodeBlock({
  lang,
  code,
  children,
}: {
  lang: string
  code: string
  children?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    // 与 MessageActions 保持一致:clipboard 写失败时静默,只更新本地 UI
    // 反馈,避免在工具栏里冒红框影响后续操作。
    void navigator.clipboard
      .writeText(code)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }, [code])

  // 复制成功的视觉反馈(1.5s 自动撤销)。effect 内清理,避免组件卸载后
  // 仍触发 setState 产生 "setState on unmounted" 警告 + 计时器泄漏。
  // 与 MessageActions 用同一套模式,保证代码块和消息操作条行为一致。
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

function InlineCodeRenderer({ children }: { children?: React.ReactNode }) {
  return <code className="not-hljs">{children}</code>
}

function PatchView({ body, streaming }: { body: string; streaming?: boolean }) {
  const payload = body.startsWith(PATCH_PREFIX) ? body.slice(PATCH_PREFIX.length).trim() : body
  const { files } = useMemo(() => parsePatchForView(payload), [payload])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<"idle" | "applied" | "dismissed" | "error">("idle")
  const [err, setErr] = useState<string | null>(null)

  const apply = useCallback(async () => {
    if (!payload.trim() || busy || streaming) return
    setBusy(true)
    setErr(null)
    try {
      const r = await window.dave.workspace.applyPatch(payload)
      if (!r.ok) throw new Error(r.output || "应用失败")
      setStatus("applied")
    } catch (e) {
      setStatus("error")
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [payload, busy, streaming])

  const dismiss = useCallback(() => {
    setStatus("dismissed")
  }, [])

  if (status === "dismissed") {
    return (
      <div className="text-xs text-[var(--text-faint)] px-2 py-1 border border-dashed border-[var(--border)] rounded">
        已忽略补丁
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {files.length === 0 && (
        <div className="text-xs text-[var(--text-dim)] px-2 py-1">
          待补全 patch 头… {streaming && <span className="spinner ml-1" />}
        </div>
      )}
      {files.map((f) => (
        <div key={f.path} className="diff-view">
          <div className="diff-view-header">
            <span className="flex items-center gap-1.5 text-[var(--text)]">
              <FileCode2 size={11} /> {f.path}
            </span>
            <span>{streaming ? "生成中" : status === "applied" ? "已应用" : "待批准"}</span>
          </div>
          <div className="diff-view-body">
            {f.rows.map((r, i) => (
              <div key={i} className={`diff-line diff-line-${r.type}`}>
                <span className="gutter">
                  {r.type === "add"
                    ? "+"
                    : r.type === "del"
                      ? "-"
                      : r.type === "hunk" || r.type === "meta"
                        ? ""
                        : " "}
                  {r.oldNum || ""}
                </span>
                <span className="gutter">{r.newNum || ""}</span>
                <span>{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {!streaming && files.length > 0 && status !== "applied" && (
        <div className="flex items-center gap-2 px-0.5">
          <button
            type="button"
            className="btn text-xs"
            disabled={busy}
            onClick={() => void apply()}
          >
            {busy ? "应用中…" : "应用"}
          </button>
          <button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={dismiss}>
            忽略
          </button>
          {err && (
            <span className="text-[11px] text-[var(--diff-del)] truncate max-w-[16rem]" title={err}>
              {err}
            </span>
          )}
        </div>
      )}
      {status === "applied" && (
        <div className="text-[11px] text-[var(--diff-add)] px-0.5">补丁已写入工作区</div>
      )}
    </div>
  )
}
