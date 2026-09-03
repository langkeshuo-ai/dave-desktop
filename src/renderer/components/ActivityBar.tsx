import { Settings, Terminal, Search, MessageSquare } from "lucide-react"
import { useTranslation } from "react-i18next"

const ICON_SIZE = 17

const btn =
  "grid h-[30px] w-[30px] place-items-center rounded-lg border border-transparent text-[var(--ink-3)] transition-colors hover:bg-[var(--amber-50)] hover:text-[var(--amber-600)]"
const active = "!text-white !bg-gradient-to-br !from-[#f59e0b] !to-[#d97706] shadow"

export function ActivityBar({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { t } = useTranslation()
  return (
    <nav className="flex h-full w-10 flex-col items-center gap-1.5 border-r border-[var(--line)] bg-[var(--surface)] py-2.5">
      <button
        className={`${btn} ${active}`}
        title={t("common.workspace")}
        aria-label={t("common.workspace")}
      >
        <Terminal size={ICON_SIZE} strokeWidth={2.2} />
      </button>
      <button className={btn} title={t("common.search")} aria-label={t("common.search")}>
        <Search size={ICON_SIZE} />
      </button>
      <button className={btn} title={t("common.sessions")} aria-label={t("common.sessions")}>
        <MessageSquare size={ICON_SIZE} />
      </button>
      <div className="flex-1" />
      <button
        className={`${btn} hover:rotate-[28deg] hover:scale-105`}
        title={t("common.settings")}
        aria-label={t("common.settings")}
        onClick={onOpenSettings}
      >
        <Settings size={ICON_SIZE} strokeWidth={1.8} />
      </button>
    </nav>
  )
}
