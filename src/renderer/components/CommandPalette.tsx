import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"
import { useTranslation } from "react-i18next"

/** 命令面板可执行动作（由 App 层映射到真实行为） */
export type PaletteAction =
  | { type: "newChat" }
  | { type: "openSettings" }
  | { type: "exportSession" }
  | { type: "toggleTheme" }
  | { type: "reopenWelcome" }

export interface PaletteCommand {
  id: string
  label: string
  hint?: string
  action: PaletteAction
}

/**
 * CommandPalette — 命令面板（⌘K / Ctrl+K）
 *
 * 浮层 dialog（role=dialog + aria-modal），输入前缀过滤命令，↑↓ 选择、Enter 执行、
 * Esc 关闭、失焦关闭。执行动作由调用方提供（App 层把 PaletteAction 映射到真实行为）。
 * 纯展示组件，无 IPC 直接调用（动作经 onAction 上抛后由 App 消费）。
 */
export function CommandPalette({
  open,
  onClose,
  commands,
  onAction,
}: {
  open: boolean
  onClose: () => void
  commands: PaletteCommand[]
  onAction: (action: PaletteAction) => void
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState("")
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = commands.filter(
    (c) =>
      !q ||
      c.label.toLowerCase().includes(q.toLowerCase()) ||
      (c.hint ?? "").toLowerCase().includes(q.toLowerCase()),
  )

  // 打开时重置过滤与光标，下一帧聚焦
  useEffect(() => {
    if (open) {
      setQ("")
      setCursor(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  const run = (action: PaletteAction) => {
    onClose()
    onAction(action)
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/20 p-6 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("common.commandPalette")}
        className="mx-auto mt-[12vh] flex max-w-md flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-xl"
      >
        <label className="flex items-center gap-2 border-b border-[var(--line)] px-3.5 py-3">
          <Search size={14} className="shrink-0 text-[var(--ink-3)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setCursor(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, filtered.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              } else if (e.key === "Enter" && filtered[cursor]) {
                e.preventDefault()
                run(filtered[cursor].action)
              }
            }}
            placeholder={t("common.palettePlaceholder")}
            className="w-full bg-transparent text-[13.5px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
          />
        </label>
        <div className="max-h-72 overflow-y-auto py-1.5" role="listbox">
          {filtered.length === 0 ? (
            <p className="px-3.5 py-3 text-center text-[12.5px] text-[var(--ink-3)]">–</p>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => run(c.action)}
                className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] ${
                  i === cursor ? "bg-[var(--amber-50)] text-[var(--ink)]" : "text-[var(--ink-2)]"
                }`}
              >
                <span className="flex-1">{c.label}</span>
                {c.hint && (
                  <span className="font-mono text-[11px] text-[var(--ink-3)]">{c.hint}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
