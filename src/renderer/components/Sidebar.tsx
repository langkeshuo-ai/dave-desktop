import { useState } from "react"
import { Folder, Plus, Search, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"

export interface SidebarSession {
  id: string
  title: string
  group: string
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: SidebarSession[]
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState("")
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const filtered = sessions.filter((s) => !q || s.title.toLowerCase().includes(q.toLowerCase()))
  const groups = [...new Set(filtered.map((s) => s.group))]

  return (
    <aside className="flex h-full w-[260px] flex-col border-r border-[var(--line)] bg-[var(--surface)]">
      <div className="flex items-center gap-2 px-3 pt-3.5 pb-2.5">
        <label className="flex flex-1 items-center gap-1.5 rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-[var(--ink-3)] focus-within:ring-2 focus-within:ring-[var(--amber-500)]/40">
          <Search size={13} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("common.search")}
            className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
            aria-label={t("common.search")}
          />
        </label>
      </div>
      <div className="px-3">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-[#f59e0b] to-[#d97706] px-2.5 py-2 text-[13px] font-medium text-white shadow hover:-translate-y-px hover:shadow-lg"
        >
          <Plus size={13} strokeWidth={2.2} />
          {t("common.newChat")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {filtered.length === 0 &&
          (sessions.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-[var(--ink-3)]">{t("common.noSessions")}</p>
              <p className="mt-1 text-[11px] text-[var(--ink-3)]">{t("common.createFirst")}</p>
            </div>
          ) : (
            <p className="px-2 py-4 text-center text-xs text-[var(--ink-3)]">–</p>
          ))}
        {groups.map((g) => (
          <div key={g}>
            <div className="flex items-center gap-2 px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-[var(--ink-3)]">
              {g}
              <span className="h-px flex-1 bg-[var(--line)]" />
            </div>
            {filtered
              .filter((s) => s.group === g)
              .map((s) => (
                <div
                  key={s.id}
                  onClick={() => {
                    setConfirmId(null)
                    onSelect(s.id)
                  }}
                  className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors ${
                    s.id === activeId
                      ? "bg-[var(--amber-50)] text-[var(--ink)] shadow-[inset_2px_0_0_var(--amber-600)]"
                      : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <Folder size={14} className="shrink-0 text-[var(--ink-3)]" />
                  <span className="flex-1 truncate">{s.title}</span>
                  {confirmId === s.id ? (
                    <button
                      aria-label={t("common.confirmDelete")}
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(s.id)
                        setConfirmId(null)
                        setQ("")
                      }}
                      className="grid h-4 w-4 place-items-center rounded bg-[var(--err)] text-[10px] font-semibold text-white hover:bg-[#a93426]"
                    >
                      ✓
                    </button>
                  ) : (
                    <button
                      aria-label={t("common.delete")}
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmId(s.id)
                      }}
                      className="hidden h-4 w-4 place-items-center rounded text-[var(--ink-3)] hover:bg-[var(--err-bg)] hover:text-[var(--err)] group-hover:grid"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--line)] px-3 py-2 text-xs text-[var(--ink-2)]">
        <span className="h-2 w-2 rounded-full bg-[var(--ok)]" />
        <span>{t("common.ready")}</span>
        <span className="ml-auto font-mono text-[11px] text-[var(--ink-3)]">v0.3.0</span>
      </div>
    </aside>
  )
}