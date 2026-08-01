import { useEffect } from "react"
import { X, Keyboard } from "lucide-react"
import { useFocusRestore } from "../lib/useFocusRestore"
import { useTranslation } from "react-i18next"

interface Shortcut {
  keys: string[]
  descKey: string
}

const SHORTCUTS: Shortcut[] = [
  { keys: ["Ctrl", "K"], descKey: "openPalette" },
  { keys: ["Ctrl", "N"], descKey: "newSession" },
  { keys: ["Ctrl", ","], descKey: "openSettings" },
  { keys: ["Ctrl", "1-9"], descKey: "jumpToSession" },
  { keys: ["Ctrl", "F"], descKey: "searchMessages" },
  { keys: ["Ctrl", "↑"], descKey: "prevAssistant" },
  { keys: ["Ctrl", "↓"], descKey: "nextAssistant" },
  { keys: ["Alt", "↑"], descKey: "prevSession" },
  { keys: ["Alt", "↓"], descKey: "nextSession" },
  { keys: ["↑", "↓"], descKey: "navigateSidebar" },
  { keys: ["Enter", "/", "Space"], descKey: "selectSession" },
  { keys: ["Ctrl", "Delete"], descKey: "deleteSession" },
  { keys: ["Ctrl", "Enter"], descKey: "confirmApproval" },
  { keys: ["Esc"], descKey: "escClose" },
  { keys: ["Enter"], descKey: "sendMessage" },
  { keys: ["Shift", "Enter"], descKey: "newline" },
  { keys: ["?"], descKey: "showHelp" },
]

interface KeyboardHelpProps {
  open: boolean
  onClose: () => void
}

/** 键盘帮助面板:`?` 键(非输入态时)触发。焦点恢复模式与 CommandPalette 一致。 */
export function KeyboardHelp({ open, onClose }: KeyboardHelpProps) {
  const { t } = useTranslation()
  const panelRef = useFocusRestore<HTMLDivElement>(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="cmdk-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.help.title")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="cmdk-panel" style={{ outline: "none" }}>
        <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Keyboard size={14} />
            {t("settings.help.title")}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon-muted"
            title={t("settings.help.close")}
            aria-label={t("settings.help.close")}
          >
            <X size={14} />
          </button>
        </div>
        <div className="cmdk-list">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="cmdk-item" style={{ cursor: "default" }}>
              <span className="flex-1">{t(`settings.help.shortcuts.${s.descKey}`)}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, ki) => (
                  <kbd
                    key={ki}
                    className="kbd inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 text-[10.5px] font-mono bg-[var(--bg-sunk)] border border-[var(--border)] rounded text-[var(--text)]"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
