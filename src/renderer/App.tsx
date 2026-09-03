import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ActivityBar } from "./components/ActivityBar"
import { Sidebar, type SidebarSession } from "./components/Sidebar"
import { ChatView } from "./components/ChatView"
import { Settings } from "./components/Settings"

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
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
