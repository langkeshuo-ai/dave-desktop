import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Session } from "../stores/useStore"
import { Plus, Settings as SettingsIcon, Sun, Moon, PanelLeft, MessageSquare } from "lucide-react"
import { filterCommands, type CommandItem } from "../../shared/commands"
import { useFocusRestore } from "../lib/useFocusRestore"

// 渲染层强类型:shared 那边 icon/run 是 unknown(避免 React 依赖),
// 渲染层补上 ReactNode / 强类型 run,过滤时再 cast 回来。
export type { CommandItem }

interface CommandPaletteItem extends CommandItem {
  icon?: ReactNode
  run?: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  sessions: Session[]
  currentSessionId: string | null
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onOpenSettings: () => void
  onToggleTheme: () => void
  onToggleSidebar: () => void
  theme: "light" | "night"
  sidebarOpen: boolean
}

/** Cmd+K 命令面板:会话快速跳转 + 全局动作。键盘上下选,Enter 执行,Esc 关闭。 */
export function CommandPalette(props: CommandPaletteProps) {
  const {
    open,
    onClose,
    sessions,
    currentSessionId,
    onSelectSession,
    onNewSession,
    onOpenSettings,
    onToggleTheme,
    onToggleSidebar,
    theme,
    sidebarOpen,
  } = props

  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // 焦点恢复由 hook 统一处理;这里把 dialog root 也作为 panel ref,
  // 配合下面的 input.focus() 顺序:hook 聚焦到 panel(不显眼),
  // 然后 setTimeout 把焦点推到 input。
  const panelRef = useFocusRestore<HTMLDivElement>(open)

  // 会话作为命令
  const sessionItems: CommandPaletteItem[] = useMemo(
    () =>
      sessions.map((s) => ({
        id: `session:${s.id}`,
        title: s.title || "未命名会话",
        hint: s.id === currentSessionId ? "当前" : "会话",
        icon: <MessageSquare size={13} />,
        run: () => onSelectSession(s.id),
      })),
    [sessions, currentSessionId, onSelectSession],
  )

  // 全局动作作为命令
  const actionItems: CommandPaletteItem[] = useMemo(
    () => [
      {
        id: "action:new-session",
        title: "新建会话",
        hint: "Cmd+N",
        icon: <Plus size={13} />,
        run: onNewSession,
      },
      {
        id: "action:open-settings",
        title: "打开设置",
        hint: "Cmd+,",
        icon: <SettingsIcon size={13} />,
        run: onOpenSettings,
      },
      {
        id: "action:toggle-theme",
        title: theme === "light" ? "切换到夜晚模式" : "切换到浅白模式",
        hint: "主题",
        icon: theme === "light" ? <Moon size={13} /> : <Sun size={13} />,
        run: onToggleTheme,
      },
      {
        id: "action:toggle-sidebar",
        title: sidebarOpen ? "收起侧栏" : "展开侧栏",
        hint: "侧栏",
        icon: <PanelLeft size={13} />,
        run: onToggleSidebar,
      },
    ],
    [theme, sidebarOpen, onNewSession, onOpenSettings, onToggleTheme, onToggleSidebar],
  )

  const all: CommandPaletteItem[] = useMemo(() => [...actionItems, ...sessionItems], [actionItems, sessionItems])

  const filtered = useMemo(
    () => filterCommands(all, query) as CommandPaletteItem[],
    [all, query],
  )

  // 打开时:聚焦输入、清空 query、重置 active
  useEffect(() => {
    if (!open) return
    setQuery("")
    setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  // 关闭时 reset
  useEffect(() => {
    if (open) return
    setQuery("")
  }, [open])

  // 滚到 active 行
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.querySelector<HTMLElement>(`[data-cmdk-index="${active}"]`)
    item?.scrollIntoView({ block: "nearest" })
  }, [active, filtered.length])

  // 全局键盘:Esc 关闭,Cmd+K 关闭(外部 trigger 负责打开)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      // 透传到 React 之前拦,避免输入框里的 Meta+K 重复 toggle
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        onClose()
        return
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
      aria-label="命令面板"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="cmdk-panel" style={{ outline: "none" }} onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setActive((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)))
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          setActive((i) => Math.max(0, i - 1))
        } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          // 排除 IME 合成态:中文/日文/韩文用 Enter 选词时不应触发命令。
          e.preventDefault()
          const it = filtered[active]
          if (it?.run) {
            it.run()
            onClose()
          }
        }
      }}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="搜索会话或动作…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          aria-label="命令搜索"
        />
        <div ref={listRef} className="cmdk-list">
          {filtered.length === 0 ? (
            <div className="cmdk-empty">无匹配项</div>
          ) : (
            filtered.map((it, i) => (
              <div
                key={it.id}
                data-cmdk-index={i}
                className={`cmdk-item ${i === active ? "active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  it.run?.()
                  onClose()
                }}
              >
                {it.icon as ReactNode}
                <span>{it.title}</span>
                {it.hint && <span className="cmdk-item-hint">{it.hint}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
