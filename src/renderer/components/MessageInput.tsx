import { useState, useRef, useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Send, Square, Command } from "lucide-react"
import type { Mode } from "../App"

interface MessageInputProps {
  onSend: (content: string) => void
  onAbort: () => void
  disabled?: boolean
  mode: Mode
  modeLabel: string
  /** When set, append (or insert) into the composer then clear via onInsertConsumed. */
  insertSnippet?: string | null
  onInsertConsumed?: () => void
}

export function MessageInput({
  onSend,
  onAbort,
  disabled,
  mode,
  modeLabel,
  insertSnippet,
  onInsertConsumed,
}: MessageInputProps) {
  const { t } = useTranslation()
  const [input, setInput] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!insertSnippet) return
    setInput((prev) => {
      const pad = prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : ""
      return prev + pad + insertSnippet + " "
    })
    onInsertConsumed?.()
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.style.height = "auto"
      el.style.height = Math.min(el.scrollHeight, 200) + "px"
      el.selectionStart = el.selectionEnd = el.value.length
    })
  }, [insertSnippet, onInsertConsumed])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setInput("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [input, disabled, onSend])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 排除 IME 合成态:中文/日文/韩文用 Enter 确认候选词时不应触发发送。
    // nativeEvent.isComposing 在 compositionstart → compositionend 之间为 true。
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }

  const canStop = disabled

  const handleStop = useCallback(() => {
    onAbort()
  }, [onAbort])

  const handleButtonClick = canStop ? handleStop : handleSend

  return (
    <div className="px-3 py-2.5 border-t border-[var(--border)] bg-[var(--bg-panel)]">
      <div className="composer">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === "full-auto"
              ? "描述任务… 自动读写文件，shell 仍需批准"
              : mode === "auto"
                ? "描述任务… 可读写文件，shell 需批准"
                : mode === "suggest"
                  ? "描述任务… 生成 patch 供批准"
                  : "输入问题… 仅回答，不改文件"
          }
          rows={1}
          className="text-sm"
          disabled={disabled}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-dim)]">
          <Command size={10} />
          <span>{t("settings.chat.enterSendHint")}</span>
          <span className="chip ml-1">{modeLabel}</span>
        </div>
        <button
          onClick={handleButtonClick}
          disabled={disabled ? false : !input.trim()}
          className={`shrink-0 flex items-center justify-center transition-colors ${
            canStop
              ? "px-2.5 py-1.5 rounded-lg border border-[var(--border-strong)] text-[var(--text-dim)] hover:bg-[var(--bg-active)]"
              : "w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
          }`}
          aria-label={canStop ? "停止" : "发送"}
        >
          {canStop ? <Square size={12} /> : <Send size={13} />}
        </button>
      </div>
    </div>
  )
}
