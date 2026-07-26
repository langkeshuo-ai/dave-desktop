import { useMemo, useState } from "react"
import { Plus, Trash2, Clock, Search, Check, X } from "lucide-react"
import type { Session } from "../stores/useStore"

interface SidebarProps {
  sessions: Session[]
  currentSessionId: string | null
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onDeleteSession: (id: string) => void
  onRenameSession?: (id: string, title: string) => void | Promise<void>
}

// Cursor explorer-style sidebar — search + rename, plain text rows.
export function Sidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
}: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60_000) return "刚刚"
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分前`
    if (diff < 86_400_000)
      return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => (s.title || "").toLowerCase().includes(q))
  }, [sessions, query])

  const commitRename = async (id: string) => {
    const title = draft.replace(/\s+/g, " ").trim()
    setEditingId(null)
    if (!title || !onRenameSession) return
    await onRenameSession(id, title.slice(0, 80))
  }

  return (
    <div className="w-60 panel flex flex-col shrink-0">
      <div className="panel-header">
        <span>会话</span>
        <button
          onClick={onNewSession}
          className="btn-icon-muted"
          title="新建会话"
          aria-label="新建会话"
        >
          <Plus size={13} />
        </button>
      </div>

      <div className="px-2 pb-1.5">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话"
            className="input w-full !pl-7 !py-1 !text-xs"
            aria-label="搜索会话"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-[var(--text-dim)] mb-2">
              {sessions.length === 0 ? "暂无会话" : "无匹配会话"}
            </p>
            {sessions.length === 0 && (
              <button onClick={onNewSession} className="btn btn-ghost text-xs">
                新建
              </button>
            )}
          </div>
        ) : (
          <div className="file-tree" role="listbox" aria-label="会话列表">
            {filtered.map((session) => (
              <div
                key={session.id}
                role="option"
                aria-selected={session.id === currentSessionId}
                tabIndex={session.id === currentSessionId ? 0 : -1}
                className={`session-row ${session.id === currentSessionId ? "active" : ""}`}
                onClick={() => {
                  if (editingId === session.id) return
                  onSelectSession(session.id)
                }}
                onKeyDown={(e) => {
                  if (editingId === session.id) return
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelectSession(session.id)
                  } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey) {
                    // WAI-ARIA listbox:plain ArrowUp/Down 在 option 内移动焦点。
                    // Alt+Arrow 是 App 级快捷键(侧栏可见时全局可用),此处让出。
                    e.preventDefault()
                    const container = (e.currentTarget as HTMLElement).parentElement
                    if (!container) return
                    const opts = Array.from(
                      container.querySelectorAll<HTMLElement>('[role="option"]'),
                    )
                    const i = opts.indexOf(e.currentTarget)
                    const next =
                      e.key === "ArrowDown"
                        ? opts[Math.min(opts.length - 1, i + 1)]
                        : opts[Math.max(0, i - 1)]
                    next?.focus()
                  } else if (e.key === "Delete" || e.key === "Backspace") {
                    if (e.metaKey || e.ctrlKey) {
                      e.preventDefault()
                      onDeleteSession(session.id)
                    }
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  if (!onRenameSession) return
                  setEditingId(session.id)
                  setDraft(session.title || "")
                }}
                onMouseEnter={() => setHoveredId(session.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="flex-1 min-w-0">
                  {editingId === session.id ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        autoFocus
                        className="input !py-0.5 !px-1.5 !text-xs w-full"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          // 排除 IME 合成态:中文/日文/韩文按 Enter 选词时不应触发重命名。
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                            void commitRename(session.id)
                          }
                          if (e.key === "Escape") setEditingId(null)
                        }}
                        onBlur={() => void commitRename(session.id)}
                      />
                      <button
                        type="button"
                        className="btn-icon-muted !p-0.5"
                        title="确认"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void commitRename(session.id)}
                      >
                        <Check size={11} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon-muted !p-0.5"
                        title="取消"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setEditingId(null)}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="title text-xs" title="双击重命名">
                        {session.title}
                      </div>
                      <div className="time flex items-center gap-1">
                        <Clock size={9} />
                        {formatDate(session.updatedAt)}
                      </div>
                    </>
                  )}
                </div>
                {editingId !== session.id &&
                  (hoveredId === session.id || session.id === currentSessionId) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteSession(session.id)
                      }}
                      className="btn-icon-muted !p-1"
                      title="删除会话"
                      aria-label="删除会话"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-[var(--border)] flex items-center justify-between text-[10px] text-[var(--text-faint)]">
        <span>Dave Desktop</span>
        <span>v0.1.0</span>
      </div>
    </div>
  )
}
