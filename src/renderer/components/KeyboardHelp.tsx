import { useEffect } from "react"
import { X, Keyboard } from "lucide-react"
import { useFocusRestore } from "../lib/useFocusRestore"

interface Shortcut {
  keys: string[]
  desc: string
}

const SHORTCUTS: Shortcut[] = [
  { keys: ["Ctrl", "K"], desc: "打开命令面板" },
  { keys: ["Ctrl", "N"], desc: "新建会话" },
  { keys: ["Ctrl", ","], desc: "打开设置" },
  { keys: ["Alt", "↑"], desc: "上一个会话(全局)" },
  { keys: ["Alt", "↓"], desc: "下一个会话(全局)" },
  { keys: ["↑", "↓"], desc: "在会话列表中切换(侧栏聚焦时)" },
  { keys: ["Enter", "/", "Space"], desc: "选中当前会话(侧栏聚焦时)" },
  { keys: ["Ctrl", "Delete"], desc: "删除当前会话(侧栏聚焦时)" },
  { keys: ["Ctrl", "Enter"], desc: "在批准对话框中确认" },
  { keys: ["Esc"], desc: "关闭弹窗 / 取消待决操作" },
  { keys: ["Enter"], desc: "发送消息" },
  { keys: ["Shift", "Enter"], desc: "在消息框中换行" },
  { keys: ["?"], desc: "显示本快捷键帮助" },
]

interface KeyboardHelpProps {
  open: boolean
  onClose: () => void
}

/** 键盘帮助面板:`?` 键(非输入态时)触发。焦点恢复模式与 CommandPalette 一致。 */
export function KeyboardHelp({ open, onClose }: KeyboardHelpProps) {
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
      aria-label="键盘快捷键"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="cmdk-panel" style={{ outline: "none" }}>
        <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Keyboard size={14} />
            键盘快捷键
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon-muted"
            title="关闭"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>
        <div className="cmdk-list">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="cmdk-item" style={{ cursor: "default" }}>
              <span className="flex-1">{s.desc}</span>
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
