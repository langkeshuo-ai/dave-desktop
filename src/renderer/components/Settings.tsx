import { useState, useEffect, useCallback } from "react"
import {
  X,
  Eye,
  EyeOff,
  Check,
  Power,
  Bot,
  FolderOpen,
  Shield,
  Cpu,
  FolderTree,
  Info,
  Plug,
  Copy,
} from "lucide-react"
import { useFocusRestore } from "../lib/useFocusRestore"
import { useMounted } from "../lib/useMounted"
import type { StructuredEvent } from "../../shared/structured-log"
import {
  parseMcpServers,
  validateMcpServerConfig,
  type McpDiscoveredTool,
  type McpServerConfig,
} from "../../shared/mcp"
import { validateSkill, type SkillDefinition } from "../../shared/skills"
import { useTranslation } from "react-i18next"
import { initI18n, changeLocale } from "../i18n"
import { SUPPORTED_LOCALES, validateLocale, type Locale } from "../../shared/locale"

interface SettingsProps {
  onClose: () => void
  onReopenWelcome?: () => void
}

const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: ["claude-sonnet-4-20250514", "claude-3.5-sonnet", "claude-3-opus"],
  },
  { id: "deepseek", name: "DeepSeek", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "custom", name: "自定义", models: [] },
]

const TABS = [
  { id: "provider" as const, label: "模型", icon: Cpu },
  { id: "workspace" as const, label: "工作区", icon: FolderTree },
  { id: "extensions" as const, label: "扩展", icon: Plug },
  { id: "about" as const, label: "关于", icon: Info },
]

// Cursor-style settings: fixed 720×480 frame + left nav + content pane.
export function Settings({ onClose, onReopenWelcome }: SettingsProps) {
  // 打开时把焦点收到 dialog,关闭时还给触发元素(通常是 Cmd+, 来自菜单/按钮)
  const dialogRef = useFocusRestore<HTMLDivElement>(true)
  // 异步操作(probe / store.get / save 等)等待期间用户可能关掉设置面板,
  // safeSet 跳过卸载后 setState。集中抽到 useMounted hook,避免每处都写 ref。
  const safeSet = useMounted()
  const [provider, setProvider] = useState("openai")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("gpt-4o")
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [diagMsg, setDiagMsg] = useState<string | null>(null)
  const { t } = useTranslation()
  const [locale, setLocaleState] = useState<Locale>("zh-CN")
  const [customHost, setCustomHost] = useState("")
  const [customModel, setCustomModel] = useState("")
  const [customApiKey, setCustomApiKey] = useState("")
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false)
  const [tab, setTab] = useState<"provider" | "workspace" | "extensions" | "about">("provider")
  const [cwd, setCwd] = useState("")
  const [autoclear, setAutoclear] = useState(true)
  const [probeBusy, setProbeBusy] = useState(false)
  const [probeMsg, setProbeMsg] = useState<string | null>(null)
  const [probeOk, setProbeOk] = useState<boolean | null>(null)
  const [version, setVersion] = useState("")

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  useEffect(() => {
    const load = async () => {
      const p = (await window.dave.store.get("provider")) || "openai"
      const k = (await window.dave.store.get(`${p}-api-key`)) || ""
      const m = (await window.dave.store.get(`${p}-model`)) || ""
      // await 后可能组件已卸载(用户开 Settings 后立即关掉),safeSet 兜底。
      safeSet(() => {
        setProvider(p)
        setApiKey(k)
        if (m) setModel(m)
      })
      if (p === "custom") {
        const h = (await window.dave.store.get("custom-host")) || ""
        const cm = (await window.dave.store.get("custom-model")) || ""
        const ck = (await window.dave.store.get("custom-api-key")) || ""
        safeSet(() => {
          setCustomHost(h)
          setCustomModel(cm)
          setCustomApiKey(ck)
        })
      }
      try {
        const al = await window.dave.autoLaunch.get()
        safeSet(() => setAutoLaunchEnabled(al))
      } catch {
        // older main builds may not expose this IPC
      }
      const w = (await window.dave.store.get("cwd")) || ""
      const ac = await window.dave.store.get("autoclear")
      const appVersion = await window.dave.version()
      // i18n:初始化并应用持久化语言(非法回退默认 zh-CN)
      const savedLocale = await window.dave.store.get("locale")
      initI18n()
      if (validateLocale(savedLocale)) {
        changeLocale(savedLocale)
        safeSet(() => setLocaleState(savedLocale))
      }
      safeSet(() => {
        setCwd(w)
        setAutoclear(ac !== "false")
        setVersion(appVersion || "")
      })
    }
    void load()
  }, [safeSet])

  const switchProvider = async (nextId: string) => {
    safeSet(() => setProvider(nextId))
    const nextKey = (await window.dave.store.get(`${nextId}-api-key`)) || ""
    const nextModel = (await window.dave.store.get(`${nextId}-model`)) || ""
    safeSet(() => {
      setApiKey(nextKey)
      const nextProvider = PROVIDERS.find((p) => p.id === nextId)
      setModel(nextModel || nextProvider?.models[0] || "")
    })
    if (nextId === "custom") {
      const h = (await window.dave.store.get("custom-host")) || ""
      const cm = (await window.dave.store.get("custom-model")) || ""
      const ck = (await window.dave.store.get("custom-api-key")) || ""
      safeSet(() => {
        setCustomHost(h)
        setCustomModel(cm)
        setCustomApiKey(ck)
      })
    }
  }

  const handleSave = useCallback(async () => {
    await window.dave.store.set("provider", provider)
    await window.dave.store.set(`${provider}-api-key`, apiKey)
    await window.dave.store.set(`${provider}-model`, model)
    if (provider === "custom") {
      await window.dave.store.set("custom-host", customHost)
      await window.dave.store.set("custom-model", customModel || model)
      // Primary key is the main field; optional "备用" only overrides when non-empty.
      await window.dave.store.set("custom-api-key", (customApiKey || apiKey).trim())
    }
    await window.dave.store.set("cwd", cwd)
    await window.dave.store.set("autoclear", autoclear ? "true" : "false")
    safeSet(() => {
      setSaved(true)
      setTimeout(() => safeSet(() => setSaved(false)), 2000)
    })
  }, [provider, apiKey, model, customHost, customModel, customApiKey, cwd, autoclear, safeSet])

  const pickDirectory = async () => {
    const picked = await window.dave.dialog.openDirectory({ title: "选择工作区" })
    safeSet(() => {
      if (typeof picked === "string") setCwd(picked)
    })
  }

  const handleProbe = async () => {
    safeSet(() => {
      setProbeBusy(true)
      setProbeMsg(null)
      setProbeOk(null)
    })
    try {
      const r = await window.dave.provider.probe({
        provider,
        apiKey: provider === "custom" ? customApiKey || apiKey : apiKey,
        model,
        customHost,
        customModel,
      })
      safeSet(() => {
        setProbeOk(r.ok)
        setProbeMsg(r.message)
      })
    } catch (e) {
      safeSet(() => {
        setProbeOk(false)
        setProbeMsg(e instanceof Error ? e.message : String(e))
      })
    } finally {
      safeSet(() => setProbeBusy(false))
    }
  }

  async function toggleAutoLaunch() {
    const next = !autoLaunchEnabled
    safeSet(() => setAutoLaunchEnabled(next))
    try {
      const applied = await window.dave.autoLaunch.set(next)
      safeSet(() => setAutoLaunchEnabled(applied ? next : !next))
    } catch {
      safeSet(() => setAutoLaunchEnabled(!next))
    }
  }

  const currentProvider = PROVIDERS.find((p) => p.id === provider)
  const sectionTitle = t(`settings.section.${tab}`)
  const handleLocaleChange = useCallback(async (l: string) => {
    if (!validateLocale(l)) return
    setLocaleState(l)
    changeLocale(l)
    try {
      await window.dave.store.set("locale", l) // 持久化,重启后保持
    } catch {
      /* 静默 */
    }
  }, [])

  return (
    <div className="modal-scrim" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="settings-card"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onClick={(e) => e.stopPropagation()}
        style={{ outline: "none" }}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t("settings.title")}</h2>
          <button onClick={onClose} className="btn-icon-muted" title="关闭 (Esc)" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            {TABS.map((tabDef) => {
              const Icon = tabDef.icon
              return (
                <button
                  key={tabDef.id}
                  type="button"
                  onClick={() => setTab(tabDef.id)}
                  className={`settings-nav-item ${tab === tabDef.id ? "active" : ""}`}
                >
                  <Icon size={14} />
                  {t(`settings.tabs.${tabDef.id}`)}
                </button>
              )
            })}
          </nav>

          <div className="settings-main">
            <div className="settings-main-body space-y-4">
              <div className="settings-section-title">{sectionTitle}</div>

              {tab === "provider" && (
                <>
                  <div>
                    <label className="field-label">{t("settings.provider.providerLabel")}</label>
                    <div className="provider-grid">
                      {PROVIDERS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => void switchProvider(p.id)}
                          className={`px-2.5 py-2 rounded-md text-xs font-medium transition-all border ${
                            provider === p.id
                              ? "bg-[var(--accent-soft)] text-[var(--text-strong)] border-[var(--accent)]"
                              : "bg-[var(--bg)] text-[var(--text)] border-[var(--border)] hover:border-[var(--border-strong)]"
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="field-label">
                      {t(
                        provider === "custom"
                          ? "settings.provider.apiKeyLabel"
                          : "settings.provider.apiKeyLabelFor",
                        { name: currentProvider?.name ?? "" },
                      )}
                    </label>
                    <div className="relative">
                      <input
                        type={showKey ? "text" : "password"}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={t("settings.provider.skPlaceholder")}
                        className="input w-full !pr-9"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon-muted !p-1"
                        title={t(showKey ? "settings.provider.hide" : "settings.provider.show")}
                        aria-label={t(
                          showKey ? "settings.provider.hideKey" : "settings.provider.showKey",
                        )}
                      >
                        {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>

                  {currentProvider && currentProvider.models.length > 0 && (
                    <div>
                      <label className="field-label">{t("settings.provider.model")}</label>
                      <select
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="select w-full"
                      >
                        {currentProvider.models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {provider === "custom" && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className="field-label">{t("settings.provider.hostLabel")}</label>
                        <input
                          type="text"
                          value={customHost}
                          onChange={(e) => setCustomHost(e.target.value)}
                          placeholder={t("settings.provider.hostPlaceholder")}
                          className="input w-full"
                        />
                      </div>
                      <div>
                        <label className="field-label">
                          {t("settings.provider.customModelLabel")}
                        </label>
                        <input
                          type="text"
                          value={customModel}
                          onChange={(e) => setCustomModel(e.target.value)}
                          placeholder={t("settings.provider.modelPlaceholder")}
                          className="input w-full"
                        />
                      </div>
                      <div>
                        <label className="field-label">{t("settings.provider.fallbackKey")}</label>
                        <input
                          type="password"
                          value={customApiKey}
                          onChange={(e) => setCustomApiKey(e.target.value)}
                          placeholder={t("settings.provider.optional")}
                          className="input w-full"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-outline text-xs"
                      disabled={probeBusy}
                      onClick={() => void handleProbe()}
                    >
                      {t(
                        probeBusy
                          ? "settings.provider.testing"
                          : "settings.provider.testConnection",
                      )}
                    </button>
                    {probeMsg && (
                      <span
                        className={`text-[11px] ${
                          probeOk ? "text-[var(--diff-add)]" : "text-[var(--diff-del)]"
                        }`}
                      >
                        {probeMsg}
                      </span>
                    )}
                  </div>

                  <div className="p-2.5 bg-[var(--accent-soft)] border border-[var(--border)] rounded-md flex items-start gap-2">
                    <Shield size={13} className="text-[var(--accent)] shrink-0 mt-0.5" />
                    <p className="text-[11px] text-[var(--text-dim)] leading-relaxed">
                      Key 使用系统安全存储保存在本机，并会发送给所选 Provider 鉴权。
                    </p>
                  </div>
                </>
              )}

              {tab === "workspace" && (
                <>
                  <div>
                    <label className="field-label">{t("settings.workspace.dirLabel")}</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={cwd}
                        onChange={(e) => setCwd(e.target.value)}
                        placeholder={t("settings.workspace.dirPlaceholder")}
                        className="input flex-1 min-w-0"
                      />
                      <button
                        type="button"
                        onClick={() => void pickDirectory()}
                        className="btn btn-outline text-xs shrink-0"
                      >
                        <FolderOpen size={13} /> {t("settings.workspace.browse")}
                      </button>
                    </div>
                    <p className="field-hint">{t("settings.workspace.hintShell")}</p>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-text">
                      <div className="settings-row-title">{t("settings.workspace.clearTitle")}</div>
                      <div className="settings-row-desc">{t("settings.workspace.clearDesc")}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={autoclear}
                      onChange={(e) => setAutoclear(e.target.checked)}
                      className="accent-[var(--accent)] w-4 h-4 shrink-0"
                      aria-label={t("settings.workspace.clearTitle")}
                    />
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-text flex items-start gap-2 min-w-0">
                      <Power size={14} className="text-[var(--text-dim)] shrink-0 mt-0.5" />
                      <div>
                        <div className="settings-row-title">
                          {t("settings.workspace.autostartTitle")}
                        </div>
                        <div className="settings-row-desc">
                          {t("settings.workspace.autostartDesc")}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleAutoLaunch()}
                      role="switch"
                      aria-checked={autoLaunchEnabled}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                        autoLaunchEnabled ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          autoLaunchEnabled ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                </>
              )}

              {tab === "about" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-dim)]">{t("settings.language")}</span>
                    <select
                      value={locale}
                      onChange={(e) => void handleLocaleChange(e.target.value)}
                      className="input !py-1 !text-[11px] w-32"
                      aria-label={t("settings.language")}
                    >
                      {SUPPORTED_LOCALES.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="empty-state-icon !w-11 !h-11 !mb-0 !rounded-lg">
                      <Bot size={20} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-strong)]">
                        Dave Desktop
                      </div>
                      <div className="text-[11px] text-[var(--text-dim)] mt-0.5">
                        {version ? `v${version}` : t("settings.about.versionLoading")} · 本地 Agent
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--text-dim)] leading-relaxed max-w-md">
                    {t("settings.about.tagline")}
                  </p>
                  <div className="empty-state-meta !mb-0 !justify-start">
                    <span className="chip">{t("settings.about.chipModes")}</span>
                    <span className="chip">{t("settings.about.chipTools")}</span>
                    <span className="chip chip-accent">{t("settings.about.chipElectron")}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-outline text-xs"
                      onClick={() => void window.dave.logs.openDir()}
                    >
                      {t("settings.about.openLogDir")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline text-xs"
                      onClick={() =>
                        void (async () => {
                          try {
                            const path = await window.dave.diagnostics.export()
                            setDiagMsg(
                              path
                                ? t("settings.about.exported", { path })
                                : t("settings.about.exportFailed"),
                            )
                          } catch {
                            setDiagMsg(t("settings.about.exportFailed"))
                          }
                        })()
                      }
                    >
                      导出诊断报告
                    </button>
                    {onReopenWelcome && (
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        onClick={onReopenWelcome}
                      >
                        重新查看欢迎页
                      </button>
                    )}
                    <FunnelView />
                  </div>
                  {diagMsg && (
                    <div className="text-[10px] text-[var(--text-dim)] break-all">{diagMsg}</div>
                  )}
                  <LogViewer />
                </div>
              )}

              {tab === "extensions" && (
                <div className="space-y-4">
                  <McpPanel />
                  <SkillsPanel />
                </div>
              )}
            </div>

            <div className="modal-footer">
              <div className="min-h-[1.25rem]">
                {saved && (
                  <span className="flex items-center gap-1.5 text-[var(--diff-add)] text-xs">
                    <Check size={13} /> {t("settings.common.saved")}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="btn btn-ghost text-xs">
                  {t("settings.common.cancel")}
                </button>
                <button type="button" onClick={() => void handleSave()} className="btn text-xs">
                  {t("settings.common.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 本地使用统计面板:只读,不上报,清空可一键重置。 */
function FunnelView() {
  const { t } = useTranslation()
  const [funnel, setFunnel] = useState<{
    launched: number
    onboarded: number
    workspaceReady: number
    firstMessage: number
    sevenDayRetained: number
    rates: { onboardRate: number; firstMessageRate: number; retentionRate: number }
  } | null>(null)
  const [clearing, setClearing] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const f = await window.dave.telemetry.funnel()
      setFunnel(f)
    } catch {
      setFunnel(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const clear = useCallback(async () => {
    if (!window.confirm(t("settings.funnel.clearConfirm"))) return
    setClearing(true)
    try {
      await window.dave.telemetry.clear()
      await refresh()
    } finally {
      setClearing(false)
    }
  }, [refresh])

  if (!funnel) {
    return (
      <button type="button" className="btn btn-ghost text-xs" onClick={() => void refresh()}>
        {t("settings.funnel.viewStats")}
      </button>
    )
  }

  const pct = (n: number) => `${Math.round(n * 100)}%`

  return (
    <div className="w-full mt-2 p-3 bg-[var(--bg-sunk)] border border-[var(--border)] rounded-md">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-medium text-[var(--text-strong)]">
          {t("settings.funnel.title")}
        </div>
        <button
          type="button"
          className="text-[10.5px] text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-50"
          onClick={() => void clear()}
          disabled={clearing}
        >
          {t(clearing ? "settings.funnel.clearing" : "settings.funnel.clear")}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
        <div>
          <div className="text-[var(--text-dim)]">{t("settings.funnel.launched")}</div>
          <div className="text-[var(--text-strong)] font-medium">{funnel.launched}</div>
        </div>
        <div>
          <div className="text-[var(--text-dim)]">{t("settings.funnel.onboarded")}</div>
          <div className="text-[var(--text-strong)] font-medium">
            {funnel.onboarded}
            <span className="text-[var(--text-faint)] ml-1">({pct(funnel.rates.onboardRate)})</span>
          </div>
        </div>
        <div>
          <div className="text-[var(--text-dim)]">{t("settings.funnel.workspaceReady")}</div>
          <div className="text-[var(--text-strong)] font-medium">{funnel.workspaceReady}</div>
        </div>
        <div>
          <div className="text-[var(--text-dim)]">{t("settings.funnel.firstMessage")}</div>
          <div className="text-[var(--text-strong)] font-medium">
            {funnel.firstMessage}
            <span className="text-[var(--text-faint)] ml-1">
              ({pct(funnel.rates.firstMessageRate)})
            </span>
          </div>
        </div>
        <div>
          <div className="text-[var(--text-dim)]">{t("settings.funnel.sevenDay")}</div>
          <div className="text-[var(--text-strong)] font-medium">
            {funnel.sevenDayRetained}
            <span className="text-[var(--text-faint)] ml-1">
              ({pct(funnel.rates.retentionRate)})
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** MCP 服务器配置面板:服务器增删 + 保存重连 + 已发现工具展示。 */
function McpPanel() {
  const { t } = useTranslation()
  const safeSet = useMounted()
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [tools, setTools] = useState<McpDiscoveredTool[]>([])
  const [draft, setDraft] = useState<McpServerConfig>({ name: "", command: "", args: [] })
  const [status, setStatus] = useState("")

  const refresh = useCallback(async () => {
    try {
      const raw = await window.dave.store.get("mcp-servers")
      const list = parseMcpServers(raw ? (JSON.parse(raw) as unknown) : [])
      const tl = await window.dave.mcp.listTools()
      safeSet(() => {
        setServers(list)
        setTools(tl)
      })
    } catch {
      /* 静默 */
    }
  }, [safeSet])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(async () => {
    setStatus(t("settings.extensions.connecting"))
    const ok = await window.dave.mcp.saveServers(servers)
    await refresh()
    setStatus(ok ? t("settings.extensions.savedReconnected") : t("settings.extensions.saveFailed"))
  }, [servers, refresh])

  const addDraft = () => {
    if (!draft.name.trim() || !draft.command.trim()) {
      setStatus(t("settings.extensions.nameCommandRequired"))
      return
    }
    const cfg = validateMcpServerConfig(draft)
    if (!cfg) {
      setStatus(t("settings.extensions.configInvalid"))
      return
    }
    setServers([...servers, cfg])
    setDraft({ name: "", command: "", args: [] })
    setStatus(t("settings.extensions.addedToList"))
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-[var(--text-dim)] leading-relaxed">
        {t("settings.extensions.desc")}
      </p>

      {servers.length === 0 ? (
        <div className="text-[11px] text-[var(--text-faint)]">
          {t("settings.extensions.noServers")}
        </div>
      ) : (
        <div className="space-y-1.5">
          {servers.map((s) => (
            <div key={s.name} className="flex items-center gap-2 text-[11px]">
              <span className="font-medium text-[var(--text-strong)]">{s.name}</span>
              <span className="text-[var(--text-dim)] truncate">
                {s.command} {s.args.join(" ")}
              </span>
              <button
                type="button"
                className="btn-icon-muted !p-1 ml-auto"
                aria-label={t("settings.extensions.deleteServer", { name: s.name })}
                onClick={() => setServers(servers.filter((x) => x.name !== s.name))}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <input
          className="input !py-1 !text-[11px]"
          placeholder={t("settings.extensions.namePlaceholder")}
          aria-label={t("settings.extensions.nameAria")}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <input
          className="input !py-1 !text-[11px] w-full"
          placeholder={t("settings.extensions.commandPlaceholder")}
          aria-label={t("settings.extensions.commandAria")}
          value={draft.command}
          onChange={(e) => setDraft({ ...draft, command: e.target.value })}
        />
        <input
          className="input !py-1 !text-[11px] w-full"
          placeholder={t("settings.extensions.argsPlaceholder")}
          aria-label={t("settings.extensions.argsAria")}
          value={draft.args.join(" ")}
          onChange={(e) =>
            setDraft({ ...draft, args: e.target.value.split(/\s+/).filter(Boolean) })
          }
        />
        <button type="button" className="btn btn-outline !py-1 text-[11px]" onClick={addDraft}>
          {t("settings.extensions.addToList")}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className="btn !py-1 text-[11px]" onClick={() => void save()}>
          {t("settings.extensions.saveAndConnect")}
        </button>
        <button
          type="button"
          className="btn btn-ghost !py-1 text-[11px]"
          onClick={() => void refresh()}
        >
          {t("settings.extensions.refreshTools")}
        </button>
        {status && <span className="text-[10px] text-[var(--text-dim)]">{status}</span>}
      </div>

      {tools.length > 0 && (
        <div className="bg-[var(--bg-sunk)] border border-[var(--border)] rounded p-2 text-[10.5px] max-h-32 overflow-y-auto">
          <div className="text-[var(--text-dim)] mb-1">
            {t("settings.extensions.discoveredTools", { count: tools.length })}
          </div>
          {tools.map((t) => (
            <div key={t.fullName} className="truncate">
              <span className="text-[var(--text-strong)]">{t.fullName}</span>
              {t.description && (
                <span className="text-[var(--text-faint)] ml-1">— {t.description}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 结构化事件日志查看器(只读):关键字/级别过滤 + 刷新,数据来自 logs-read-structured IPC。 */
function LogViewer() {
  const { t } = useTranslation()
  const safeSet = useMounted()
  const [events, setEvents] = useState<StructuredEvent[]>([])
  const [filter, setFilter] = useState("")
  const [level, setLevel] = useState<"all" | "info" | "warn" | "error">("all")
  const [outLevel, setOutLevel] = useState<"debug" | "info" | "warn" | "error">("info")

  const refresh = useCallback(async () => {
    try {
      const list = await window.dave.logs.readStructured(200)
      safeSet(() => setEvents(list))
    } catch {
      /* 静默:查看器失败不影响设置面板 */
    }
  }, [safeSet])

  const changeLevel = useCallback(async (lvl: "debug" | "info" | "warn" | "error") => {
    setOutLevel(lvl)
    try {
      await window.dave.logs.setLevel(lvl)
    } catch {
      /* 静默 */
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visible = events.filter((e) => {
    if (level !== "all" && e.level !== level) return false
    if (filter && !JSON.stringify(e).toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  return (
    <div className="w-full mt-2">
      <div className="flex items-center gap-2 mb-1.5">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤关键字…"
          className="input !py-1 !text-[11px] flex-1"
          aria-label="日志过滤"
        />
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as "all" | "info" | "warn" | "error")}
          className="input !py-1 !text-[11px] w-24"
          aria-label="日志级别"
        >
          <option value="all">全部</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <select
          value={outLevel}
          onChange={(e) => void changeLevel(e.target.value as "debug" | "info" | "warn" | "error")}
          className="input !py-1 !text-[11px] w-24"
          aria-label="日志输出级别"
          title={t("settings.log.levelTitle")}
        >
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <button
          type="button"
          onClick={() => void refresh()}
          className="btn btn-ghost !py-1 text-[11px]"
        >
          刷新
        </button>
      </div>
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded p-2 max-h-40 overflow-y-auto text-[10.5px] font-mono space-y-1">
        {visible.length === 0 ? (
          <div className="text-[var(--text-faint)]">{t("settings.log.none")}</div>
        ) : (
          visible.map((e, i) => (
            <div key={i} className="flex items-baseline gap-2 min-w-0">
              <span className="text-[var(--text-faint)] shrink-0">
                {new Date(e.ts).toLocaleTimeString()}
              </span>
              <span
                className={`shrink-0 ${
                  e.level === "error"
                    ? "text-[var(--diff-del)]"
                    : e.level === "warn"
                      ? "text-[var(--warning)]"
                      : "text-[var(--text-dim)]"
                }`}
              >
                {e.level}
              </span>
              <span className="truncate text-[var(--text)]">{e.msg}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** 自定义预置技能面板(0.3.0 M1 第一步):增删 + 复制内容取用。 */
function SkillsPanel() {
  const { t } = useTranslation()
  const safeSet = useMounted()
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [draft, setDraft] = useState<SkillDefinition>({ name: "", description: "", content: "" })
  const [status, setStatus] = useState("")

  const refresh = useCallback(async () => {
    try {
      const list = await window.dave.skills.list()
      safeSet(() => setSkills(list))
    } catch {
      /* 静默 */
    }
  }, [safeSet])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(async () => {
    try {
      const ok = await window.dave.skills.save(skills)
      safeSet(() => setStatus(ok ? t("settings.skills.saved") : t("settings.skills.saveFailed")))
    } catch {
      // IPC 失败(磁盘错误等):明确告知用户,避免静默
      safeSet(() => setStatus(t("settings.skills.saveFailed")))
    }
  }, [skills, safeSet])

  const addDraft = () => {
    const s = validateSkill(draft)
    if (!s) {
      setStatus(t("settings.skills.invalid"))
      return
    }
    if (skills.some((x) => x.name === s.name)) {
      setStatus(t("settings.skills.exists"))
      return
    }
    setSkills([...skills, s])
    setDraft({ name: "", description: "", content: "" })
    setStatus(t("settings.skills.added"))
  }

  const copy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setStatus(t("settings.skills.copied"))
    } catch {
      /* file:// 下剪贴板可能受限,静默 */
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-[var(--text-dim)] leading-relaxed">
        {t("settings.skills.desc")}
      </p>

      {skills.length === 0 ? (
        <div className="text-[11px] text-[var(--text-faint)]">尚未添加技能</div>
      ) : (
        <div className="space-y-1.5">
          {skills.map((s) => (
            <div key={s.name} className="flex items-center gap-2 text-[11px]">
              <span className="font-medium text-[var(--text-strong)]">{s.name}</span>
              <span className="text-[var(--text-dim)] truncate">{s.description}</span>
              <button
                type="button"
                className="btn-icon-muted !p-1"
                aria-label={t("settings.skills.copy", { name: s.name })}
                onClick={() => void copy(s.content)}
              >
                <Copy size={11} />
              </button>
              <button
                type="button"
                className="btn-icon-muted !p-1 ml-auto"
                aria-label={t("settings.skills.delete", { name: s.name })}
                onClick={() => setSkills(skills.filter((x) => x.name !== s.name))}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <input
          className="input !py-1 !text-[11px]"
          placeholder={t("settings.skills.namePlaceholder")}
          aria-label="技能名称"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <input
          className="input !py-1 !text-[11px] w-full"
          placeholder={t("settings.skills.descPlaceholder")}
          aria-label="技能描述"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
        <textarea
          className="input !py-1 !text-[11px] w-full min-h-[4rem] resize-y"
          placeholder={t("settings.skills.contentPlaceholder")}
          aria-label="技能内容"
          value={draft.content}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        />
        <button type="button" className="btn btn-outline !py-1 text-[11px]" onClick={addDraft}>
          {t("settings.skills.addToList")}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className="btn !py-1 text-[11px]" onClick={() => void save()}>
          {t("settings.skills.save")}
        </button>
        {status && <span className="text-[10px] text-[var(--text-dim)]">{status}</span>}
      </div>
    </div>
  )
}
