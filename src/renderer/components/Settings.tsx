/**
 * Settings — 设置面板（2026-09-03 SETTINGS-FS 视图回归）
 *
 * 五 tab（模型 / 工作区 / 扩展 / 日志 / 关于），全部数据经 window.dave.* IPC 通道
 * （契约已注册：store/provider/workspace/skills/mcp/logs/usage/diagnostics/version）。
 * 面板为模态 dialog（role=dialog + aria-modal），Esc 或点击遮罩关闭。
 * 文案全程 i18n（settings.* 命名空间，zh/en 成对由 unit.test.ts「keys identical」守护）。
 */
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { X } from "lucide-react"
import type { SkillDefinition } from "../../shared/skills"
import type { McpDiscoveredTool } from "../../shared/mcp"

type SettingsTab = "model" | "workspace" | "extensions" | "logs" | "about"

const TABS: SettingsTab[] = ["model", "workspace", "extensions", "logs", "about"]

const inputCls =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--amber-500)]"
const btnPrimary =
  "rounded-lg bg-gradient-to-br from-[#f59e0b] to-[#d97706] px-3 py-1.5 text-[12.5px] font-medium text-white shadow-sm hover:opacity-90 active:scale-[0.98]"
const btnGhost =
  "rounded-lg border border-[var(--line)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)] active:scale-[0.98]"
const sectionTitle = "mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--ink-3)]"

export function Settings({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<SettingsTab>("model")
  const dialogRef = useRef<HTMLDivElement>(null)

  // ── 模型 tab 状态 ──
  const [apiKey, setApiKey] = useState("")
  const [savedFlash, setSavedFlash] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probeMsg, setProbeMsg] = useState<string | null>(null)

  // ── 工作区 tab 状态 ──
  const [cwd, setCwd] = useState("")

  // ── 扩展 tab 状态 ──
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [draft, setDraft] = useState({ name: "", description: "", content: "" })
  const [mcpTools, setMcpTools] = useState<McpDiscoveredTool[]>([])

  // ── 日志 tab 状态 ──
  const [logLevel, setLogLevel] = useState<"debug" | "info" | "warn" | "error">("info")
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([])

  // ── 关于 tab 状态 ──
  const [version, setVersion] = useState("")
  const [usage, setUsage] = useState<Record<string, unknown> | null>(null)

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // 初始数据加载（真实 IPC）
  useEffect(() => {
    const api = window.dave
    if (!api) return
    void api.store.get("cwd").then((p) => setCwd(p ?? ""))
    void api.skills.list().then((s) => setSkills(s))
    void api.mcp.listTools().then((tools) => setMcpTools(tools))
    void api.logs.readStructured(20).then((rows) => setLogs(rows))
    void api.version().then(setVersion)
    void api.usage.today().then(setUsage)
    api.logs.setLevel(logLevel).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveApiKey = async () => {
    if (!apiKey.trim()) return
    const api = window.dave
    if (!api) return
    await api.store.set("openai-api-key", apiKey.trim())
    setApiKey("")
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2000)
  }

  const probe = async () => {
    const api = window.dave
    if (!api) return
    setProbing(true)
    setProbeMsg(null)
    const key = apiKey.trim() || (await api.store.get("openai-api-key")) || ""
    try {
      const r = await api.provider.probe({ provider: "openai", apiKey: key })
      setProbeMsg(r.ok ? t("settings.model.probed", { ms: r.latencyMs }) : t("settings.model.probeFailed"))
    } catch {
      setProbeMsg(t("settings.model.probeFailed"))
    } finally {
      setProbing(false)
    }
  }

  const chooseWorkspace = async () => {
    const api = window.dave
    if (!api) return
    const dir = await api.dialog.openDirectory()
    if (dir) {
      await api.store.set("cwd", dir)
      setCwd(dir)
    }
  }

  const addSkill = async () => {
    const api = window.dave
    if (!api || !draft.name.trim() || !draft.content.trim()) return
    const next = [...skills, { ...draft }]
    await api.skills.save(next)
    setSkills(next)
    setDraft({ name: "", description: "", content: "" })
  }

  const removeSkill = async (name: string) => {
    const api = window.dave
    if (!api) return
    const next = skills.filter((s) => s.name !== name)
    await api.skills.save(next)
    setSkills(next)
  }

  const exportUsage = async () => {
    const api = window.dave
    if (!api) return
    const path = await api.usage.export()
    if (path) console.info("[settings] usage exported:", path)
  }

  const exportDiagnostics = async () => {
    const api = window.dave
    if (!api) return
    const path = await api.diagnostics.export()
    if (path) console.info("[settings] diagnostics exported:", path)
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        className="flex h-[min(620px,86vh)] w-[min(880px,92vw)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-elevated"
      >
        {/* 左侧 tab 导航 */}
        <nav className="flex w-44 flex-col gap-0.5 border-r border-[var(--line)] bg-[var(--surface-2)] p-3">
          <div className="mb-3 flex items-center justify-between px-1">
            <span className="text-[13px] font-semibold text-[var(--ink)]">{t("settings.title")}</span>
            <button onClick={onClose} aria-label={t("settings.close")} className="grid h-7 w-7 place-items-center rounded-lg text-[var(--ink-3)] hover:bg-[var(--surface)] hover:text-[var(--ink)]">
              <X size={15} />
            </button>
          </div>
          {TABS.map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              aria-pressed={tab === k}
              className={`rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                tab === k
                  ? "bg-[var(--amber-50)] font-semibold text-[var(--amber-700)]"
                  : "text-[var(--ink-2)] hover:bg-[var(--surface)]"
              }`}
            >
              {t(`settings.tabs.${k}`)}
            </button>
          ))}
        </nav>

        {/* 右侧内容区 */}
        <section className="flex-1 overflow-y-auto p-5">
          {tab === "model" && (
            <div className="space-y-5">
              <div>
                <label htmlFor="settings-api-key" className="mb-1.5 block text-[12.5px] font-medium text-[var(--ink-2)]">
                  {t("settings.model.apiKey")}
                </label>
                <div className="flex gap-2">
                  <input
                    id="settings-api-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t("settings.model.apiKeyPlaceholder")}
                    className={inputCls}
                  />
                  <button onClick={() => void saveApiKey()} className={btnPrimary}>
                    {t("settings.model.save")}
                  </button>
                </div>
                {savedFlash && <p className="mt-1.5 text-[12px] text-[var(--green-600)]">{t("settings.model.saved")}</p>}
              </div>
              <button onClick={() => void probe()} disabled={probing} className={btnGhost}>
                {probing ? "…" : t("settings.model.probe")}
              </button>
              {probeMsg && <p className="text-[12.5px] text-[var(--ink-2)]">{probeMsg}</p>}
            </div>
          )}

          {tab === "workspace" && (
            <div className="space-y-4">
              <p className={sectionTitle}>{t("settings.workspace.current")}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 font-mono text-[12.5px] text-[var(--ink-2)]">
                  {cwd || t("settings.workspace.none")}
                </code>
                <button onClick={() => void chooseWorkspace()} className={btnPrimary}>
                  {t("settings.workspace.choose")}
                </button>
              </div>
            </div>
          )}

          {tab === "extensions" && (
            <div className="space-y-6">
              <div>
                <p className={sectionTitle}>{t("settings.extensions.skills")}</p>
                {skills.length === 0 ? (
                  <p className="text-[12.5px] text-[var(--ink-3)]">{t("settings.extensions.noSkills")}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {skills.map((s) => (
                      <li key={s.name} className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-[var(--ink)]">{s.name}</p>
                          <p className="truncate text-[12px] text-[var(--ink-3)]">{s.description}</p>
                        </div>
                        <button onClick={() => void removeSkill(s.name)} className={btnGhost}>
                          {t("common.delete")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 space-y-2">
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder={t("settings.extensions.skillName")}
                    className={inputCls}
                  />
                  <input
                    value={draft.description}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    placeholder={t("settings.extensions.skillDesc")}
                    className={inputCls}
                  />
                  <textarea
                    value={draft.content}
                    onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                    placeholder={t("settings.extensions.skillContent")}
                    rows={3}
                    className={inputCls}
                  />
                  <button onClick={() => void addSkill()} className={btnPrimary}>
                    {t("settings.extensions.addSkill")}
                  </button>
                </div>
              </div>
              <div>
                <p className={sectionTitle}>{t("settings.extensions.mcp")}</p>
                {mcpTools.length === 0 ? (
                  <p className="text-[12.5px] text-[var(--ink-3)]">{t("settings.extensions.noMcp")}</p>
                ) : (
                  <ul className="space-y-1">
                    {mcpTools.map((tool) => (
                        <li key={tool.fullName} className="rounded-lg border border-[var(--line)] px-3 py-2">
                          <p className="truncate font-mono text-[12.5px] text-[var(--ink)]">{tool.fullName}</p>
                          {tool.description && (
                            <p className="truncate text-[12px] text-[var(--ink-3)]">{tool.description}</p>
                          )}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {tab === "logs" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-medium text-[var(--ink-2)]">{t("settings.logs.level")}</span>
                <select
                  value={logLevel}
                  onChange={(e) => {
                    const level = e.target.value as "debug" | "info" | "warn" | "error"
                    setLogLevel(level)
                    void window.dave?.logs.setLevel(level)
                  }}
                  className={inputCls}
                >
                  <option value="debug">debug</option>
                  <option value="info">info</option>
                  <option value="warn">warn</option>
                  <option value="error">error</option>
                </select>
                <button onClick={() => void window.dave?.logs.openDir()} className={btnGhost}>
                  {t("settings.logs.openDir")}
                </button>
              </div>
              <div>
                <p className={sectionTitle}>{t("settings.logs.viewer")}</p>
                {logs.length === 0 ? (
                  <p className="text-[12.5px] text-[var(--ink-3)]">{t("settings.logs.noLogs")}</p>
                ) : (
                  <ul className="space-y-1 font-mono text-[12px]">
                    {logs.map((row, i) => (
                      <li key={i} className="truncate text-[var(--ink-2)]">
                        <span className="text-[var(--ink-4)]">{String(row.ts ?? "")}</span>{" "}
                        <span className="text-[var(--amber-600)]">{String(row.level ?? "")}</span>{" "}
                        {String(row.message ?? String(row.msg ?? ""))}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {tab === "about" && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className={sectionTitle}>{t("settings.about.version")}</p>
                  <p className="text-[13px] text-[var(--ink)]">{version || "—"}</p>
                </div>
                <div>
                  <p className={sectionTitle}>{t("settings.about.usageToday")}</p>
                  <p className="text-[13px] text-[var(--ink)]">
                    {usage ? JSON.stringify(usage) : "—"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => void exportUsage()} className={btnGhost}>
                  {t("settings.about.exportUsage")}
                </button>
                <button onClick={() => void exportDiagnostics()} className={btnGhost}>
                  {t("settings.about.exportDiagnostics")}
                </button>
              </div>
              <div>
                <p className={sectionTitle}>{t("settings.about.shortcuts")}</p>
                <p className="text-[13px] text-[var(--ink-2)]">{t("settings.about.shortcutsList")}</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}