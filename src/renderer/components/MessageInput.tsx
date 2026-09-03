import { useRef } from "react"
import { ArrowUp, Square } from "lucide-react"
import { useTranslation } from "react-i18next"

/** 输入区：Enter 发送 / Shift+Enter 换行；流式期间切换为中止按钮。 */
export function MessageInput({
  streaming,
  onSend,
  onStop,
}: {
  streaming: boolean
  onSend: (text: string) => void
  onStop?: () => void
}) {
  const { t } = useTranslation()
  const taRef = useRef<HTMLTextAreaElement>(null)

  const autoresize = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }

  const handleSend = () => {
    const el = taRef.current
    if (!el) return
    const text = el.value.trim()
    if (!text) return
    el.value = ""
    autoresize()
    onSend(text)
  }

  return (
    <div className="border-t border-[var(--line)] bg-[var(--surface)] px-4 pb-4 pt-3">
      <div className="mx-auto max-w-[720px] rounded-[14px] border border-[var(--line)] bg-[var(--surface)] shadow-lg focus-within:border-[var(--amber-500)]">
        <div className="flex items-center gap-1.5 px-3 pt-2 text-xs text-[var(--ink-3)]">
          <span className={`h-2 w-2 rounded-full ${streaming ? "animate-pulse bg-[var(--amber-600)]" : "bg-[var(--ok)]"}`} />
          {streaming ? t("chat.streaming") : t("chat.done")}
        </div>
        <div className="flex items-end gap-2 px-3 pb-2 pt-1.5">
          <textarea
            ref={taRef}
            rows={1}
            placeholder={t("chat.placeholder")}
            aria-label="input"
            onChange={autoresize}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            className="max-h-[140px] flex-1 resize-none bg-transparent py-1 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
          />
          {streaming ? (
            <button
              onClick={onStop}
              aria-label={t("chat.stop")}
              title={t("chat.stop")}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[var(--err)]/40 text-[var(--err)] hover:bg-[var(--err-bg)]"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              aria-label={t("chat.send")}
              title={`${t("chat.send")} (Enter)`}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#f59e0b] to-[#d97706] text-white shadow hover:scale-105"
            >
              <ArrowUp size={15} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}