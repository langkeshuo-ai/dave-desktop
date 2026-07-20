import { useState, useEffect, useCallback } from "react"
import {
  X, Eye, EyeOff, Check, Power, Bot, FolderOpen, Shield,
  Cpu, FolderTree, Info,
} from "lucide-react"
import { useFocusRestore } from "../lib/useFocusRestore"
import { useMounted } from "../lib/useMounted"

interface SettingsProps {
  onClose: () => void
  onReopenWelcome?: () => void
}

const PROVIDERS = [
  { id: "openai", name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"] },
  { id: "anthropic", name: "Anthropic", models: ["claude-sonnet-4-20250514", "claude-3.5-sonnet", "claude-3-opus"] },
  { id: "deepseek", name: "DeepSeek", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "custom", name: "自定义", models: [] },
]

const TABS = [
  { id: "provider" as const, label: "模型", icon: Cpu },
  { id: "workspace" as const, label: "工作区", icon: FolderTree },
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
  const [customHost, setCustomHost] = useState("")
  const [customModel, setCustomModel] = useState("")
  const [customApiKey, setCustomApiKey] = useState("")
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false)
  const [tab, setTab] = useState<"provider" | "workspace" | "about">("provider")
  const [cwd, setCwd] = useState("")
  const [autoclear, setAutoclear] = useState(true)
  const [probeBusy, setProbeBusy] = useState(false)
  const [probeMsg, setProbeMsg] = useState<string | null>(null)
  const [probeOk, setProbeOk] = useState<boolean | null>(null)

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
      safeSet(() => {
        setCwd(w)
        setAutoclear(ac !== "false")
      })
    }
    void load()
  }, [safeSet])

  const switchProvider = async (nextId: string) => {
    await window.dave.store.set(`${provider}-api-key`, apiKey)
    await window.dave.store.set(`${provider}-model`, model)

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
      await window.dave.store.set(
        "custom-api-key",
        (customApiKey || apiKey).trim(),
      )
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
      await window.dave.autoLaunch.set(next)
    } catch {
      safeSet(() => setAutoLaunchEnabled(!next))
    }
  }

  const currentProvider = PROVIDERS.find((p) => p.id === provider)
  const sectionTitle =
    tab === "provider" ? "模型与密钥" : tab === "workspace" ? "工作区与启动" : "关于"

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
          <h2 className="modal-title">设置</h2>
          <button onClick={onClose} className="btn-icon-muted" title="关闭 (Esc)" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            {TABS.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`settings-nav-item ${tab === t.id ? "active" : ""}`}
                >
                  <Icon size={14} />
                  {t.label}
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
                    <label className="field-label">提供商</label>
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
                      {provider === "custom" ? "API Key" : `${currentProvider?.name} API Key`}
                    </label>
                    <div className="relative">
                      <input
                        type={showKey ? "text" : "password"}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-…"
                        className="input w-full !pr-9"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon-muted !p-1"
                        title={showKey ? "隐藏" : "显示"}
                        aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                      >
                        {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>

                  {currentProvider && currentProvider.models.length > 0 && (
                    <div>
                      <label className="field-label">模型</label>
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
                        <label className="field-label">Host</label>
                        <input
                          type="text"
                          value={customHost}
                          onChange={(e) => setCustomHost(e.target.value)}
                          placeholder="https://api.openai.com/v1"
                          className="input w-full"
                        />
                      </div>
                      <div>
                        <label className="field-label">模型名</label>
                        <input
                          type="text"
                          value={customModel}
                          onChange={(e) => setCustomModel(e.target.value)}
                          placeholder="gpt-4o"
                          className="input w-full"
                        />
                      </div>
                      <div>
                        <label className="field-label">备用 API Key</label>
                        <input
                          type="text"
                          value={customApiKey}
                          onChange={(e) => setCustomApiKey(e.target.value)}
                          placeholder="可选"
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
                      {probeBusy ? "测试中…" : "测试连接"}
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
                      Key 仅本地加密存储，不上云。
                    </p>
                  </div>
                </>
              )}

              {tab === "workspace" && (
                <>
                  <div>
                    <label className="field-label">工作区目录</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={cwd}
                        onChange={(e) => setCwd(e.target.value)}
                        placeholder="未设置 · 仅询问模式"
                        className="input flex-1 min-w-0"
                      />
                      <button
                        type="button"
                        onClick={() => void pickDirectory()}
                        className="btn btn-outline text-xs shrink-0"
                      >
                        <FolderOpen size={13} /> 浏览
                      </button>
                    </div>
                    <p className="field-hint">suggest / auto / full-auto 下用于读写与 shell。</p>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-text">
                      <div className="settings-row-title">切换会话时清空上下文</div>
                      <div className="settings-row-desc">避免跨会话污染</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={autoclear}
                      onChange={(e) => setAutoclear(e.target.checked)}
                      className="accent-[var(--accent)] w-4 h-4 shrink-0"
                      aria-label="切换会话时清空上下文"
                    />
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-text flex items-start gap-2 min-w-0">
                      <Power size={14} className="text-[var(--text-dim)] shrink-0 mt-0.5" />
                      <div>
                        <div className="settings-row-title">开机自启</div>
                        <div className="settings-row-desc">登录系统时启动 Dave</div>
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
                  <div className="flex items-center gap-3">
                    <div className="empty-state-icon !w-11 !h-11 !mb-0 !rounded-lg">
                      <Bot size={20} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-strong)]">Dave Desktop</div>
                      <div className="text-[11px] text-[var(--text-dim)] mt-0.5">v0.1.0 · 本地 Agent</div>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--text-dim)] leading-relaxed max-w-md">
                    浅白 Cursor UI · Codex 工具集 · 四种批准模式 · 工作区读写 · unified-diff
                  </p>
                  <div className="empty-state-meta !mb-0 !justify-start">
                    <span className="chip">ask / suggest / auto / full-auto</span>
                    <span className="chip">patch · shell · AST</span>
                    <span className="chip chip-accent">Electron</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-outline text-xs"
                      onClick={() => void window.dave.logs.openDir()}
                    >
                      打开日志目录
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
                </div>
              )}
            </div>

            <div className="modal-footer">
              <div className="min-h-[1.25rem]">
                {saved && (
                  <span className="flex items-center gap-1.5 text-[var(--diff-add)] text-xs">
                    <Check size={13} /> 已保存
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="btn btn-ghost text-xs">
                  取消
                </button>
                <button type="button" onClick={() => void handleSave()} className="btn text-xs">
                  保存
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
  const [funnel, setFunnel] = useState<{
    launched: number
    onboarded: number
    workspaceReady: number
    firstMessage: number
    rates: { onboardRate: number; firstMessageRate: number }
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
    if (!window.confirm("清空全部本地使用统计?不可恢复。")) return
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
        查看本地统计
      </button>
    )
  }

  const pct = (n: number) => `${Math.round(n * 100)}%`

  return (
    <div className="w-full mt-2 p-3 bg-[var(--bg-sunk)] border border-[var(--border)] rounded-md">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-medium text-[var(--text-strong)]">
          本地使用统计(只存本机,不上报)
        </div>
        <button
          type="button"
          className="text-[10.5px] text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-50"
          onClick={() => void clear()}
          disabled={clearing}
        >
          {clearing ? "清空中…" : "清空"}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div>
          <div className="text-[var(--text-dim)]">启动</div>
          <div className="text-[var(--text-strong)] font-medium">{funnel.launched}</div>
        </div>
        <div>
          <div className="text-[var(--text-dim)]">完成引导</div>
          <div className="text-[var(--text-strong)] font-medium">
            {funnel.onboarded}
            <span className="text-[var(--text-faint)] ml-1">({pct(funnel.rates.onboardRate)})</span>
          </div>
        </div>
        <div>
          <div className="text-[var(--text-dim)]">工作区就绪</div>
          <div className="text-[var(--text-strong)] font-medium">{funnel.workspaceReady}</div>
        </div>
        <div>
          <div className="text-[var(--text-dim)]">首问</div>
          <div className="text-[var(--text-strong)] font-medium">
            {funnel.firstMessage}
            <span className="text-[var(--text-faint)] ml-1">({pct(funnel.rates.firstMessageRate)})</span>
          </div>
        </div>
      </div>
    </div>
  )
}
