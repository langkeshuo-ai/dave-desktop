import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ActivityBar } from "./components/ActivityBar"
import { Sidebar, type SidebarSession } from "./components/Sidebar"
import { ChatView } from "./components/ChatView"
import { Settings } from "./components/Settings"
import { CommandPalette, type PaletteAction } from "./components/CommandPalette"
import { exportSessionMarkdown } from "./utils/export-session"

/** 会话按时间归类：今天 / 昨天 / 更早（文案走 i18n） */
function dayGroup(ts: number | undefined, t: (key: string) => string): string {
  if (!ts) return t("common.groupNone")
  const d = new Date(ts)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const dayDiff = Math.floor(
    (startOfToday.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  )
  if (dayDiff <= 0) return t("common.groupToday")
  if (dayDiff === 1) return t("common.groupYesterday")
  return t("common.groupEarlier")
}

/** 应用外壳：活动栏 40px + 真实会话侧栏 260px + ChatView（错误隔离）。 */
export default function App() {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<SidebarSession[]>([])
  const [ready, setReady] = useState(false)
  const [activeId, setActiveId] = useState<string>("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 主题（light-first 设计；night 深色变体由 globals.css html.night 驱动，持久化 store "theme"）
  const [theme, setTheme] = useState<"light" | "night">("light")

  useEffect(() => {
    const stored = window.dave?.store
    if (!stored) return
    void stored.get("theme").then((v) => {
      if (v === "night" || v === "light") setTheme(v)
    })
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("night", theme === "night")
  }, [theme])

  const toggleTheme = () => {
    setTheme((cur) => {
      const next = cur === "night" ? "light" : "night"
      void window.dave?.store?.set("theme", next).catch(() => {})
      return next
    })
  }

  // ⌘K / Ctrl+K 打开命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const refresh = useCallback(async (): Promise<SidebarSession[]> => {
    const api = window.dave?.session
    if (!api) {
      setSessions([])
      setReady(true)
      return []
    }
    try {
      const list = await api.list()
      const mapped: SidebarSession[] = list.map((s) => ({
        id: s.id,
        title: s.title || t("common.untitled"),
        group: dayGroup(s.updatedAt ?? s.createdAt, t),
      }))
      setSessions(mapped)
      setActiveId((cur) => cur || mapped[0]?.id || "")
      return mapped
    } catch {
      /* 主进程不可用时静默降级为空会话 */
      return []
    } finally {
      setReady(true)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const newChat = async () => {
    if (!window.dave?.session) {
      const id = `s-new-${Date.now()}`
      setActiveId(id)
      return
    }
    const id = await window.dave.session.create()
    await refresh()
    setActiveId(id)
  }

  const deleteSession = async (id: string) => {
    try {
      await window.dave.session.delete(id)
    } catch {
      /* 已不存在则忽略 */
    }
    // 以删除后的真实列表为准，避免陈旧闭包取到已删会话
    const mapped = await refresh()
    if (activeId === id) {
      setActiveId(mapped[0]?.id ?? "")
    }
  }

  const activeTitle = sessions.find((s) => s.id === activeId)?.title

  const handlePaletteAction = (action: PaletteAction) => {
    switch (action.type) {
      case "newChat":
        void newChat()
        break
      case "openSettings":
        setSettingsOpen(true)
        break
      case "exportSession":
        if (activeId) void exportSessionMarkdown(activeId, `${activeTitle || activeId}.md`)
        break
    }
  }

  const paletteCommands = useMemo(
    () => [
      {
        id: "newChat",
        label: t("common.newChat"),
        hint: "Ctrl ⇧ O",
        action: { type: "newChat" } as const,
      },
      {
        id: "settings",
        label: t("common.settings"),
        hint: "Ctrl ,",
        action: { type: "openSettings" } as const,
      },
      {
        id: "export",
        label: t("common.exportSession"),
        action: { type: "exportSession" } as const,
      },
    ],
    [t],
  )

  return (
    <div className="grid h-screen grid-rows-[minmax(0,1fr)] grid-cols-[40px_260px_1fr] overflow-hidden">
      <ActivityBar onOpenSettings={() => setSettingsOpen(true)} />
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={() => void newChat()}
        onDelete={(id) => void deleteSession(id)}
        onRename={(id, title) => {
          void window.dave.session.updateTitle(id, title).catch(() => {})
          void refresh()
        }}
      />
      {ready && (
        <ChatView
          key={activeId}
          sessionId={activeId}
          title={activeTitle}
          onTitleUpdate={() => void refresh()}
        />
      )}
      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          commands={paletteCommands}
          onAction={handlePaletteAction}
        />
      )}
    </div>
  )
}
