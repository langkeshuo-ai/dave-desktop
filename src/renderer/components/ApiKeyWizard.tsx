/* =========================================================================
   API Key 可视化向导 —— 替代"在 Settings 里翻 5 屏才能配 Key"的体验。
   流程:
   1) 选 Provider
   2) 粘 Key + (可选)自定义 host / model
   3) 实时校验连通性(基于 probeProviderConnection)
   4) 选工作区(可选,但 Agent 模式需要)
   5) 完成
   ========================================================================= */

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, ChevronRight, Cpu, Eye, EyeOff, FolderOpen, Loader2, X } from "lucide-react"
import { useFocusRestore } from "../lib/useFocusRestore"
import { useMounted } from "../lib/useMounted"
import { track } from "../lib/telemetry"

interface ApiKeyWizardProps {
  onClose: () => void
  onCompleted: () => void
}

const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    desc: "gpt-4o / gpt-4o-mini / gpt-4-turbo",
    defaultModel: "gpt-4o",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    desc: "claude-sonnet-4 / claude-3.5-sonnet / opus",
    defaultModel: "claude-sonnet-4-20250514",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    desc: "deepseek-chat / deepseek-reasoner",
    defaultModel: "deepseek-chat",
  },
  {
    id: "custom",
    name: "自定义",
    desc: "OpenAI 兼容端点(自部署 / 代理)",
    defaultModel: "gpt-4o",
  },
] as const

type ProviderId = (typeof PROVIDERS)[number]["id"]

export function ApiKeyWizard({ onClose, onCompleted }: ApiKeyWizardProps) {
  const dialogRef = useFocusRestore<HTMLDivElement>(true)
  const safeSet = useMounted()
  const [step, setStep] = useState<"provider" | "key" | "workspace" | "done">("provider")
  const [provider, setProvider] = useState<ProviderId>("openai")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState<string>(PROVIDERS[0].defaultModel)
  const [customHost, setCustomHost] = useState("")
  const [customModel, setCustomModel] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [probeBusy, setProbeBusy] = useState(false)
  const [probeOk, setProbeOk] = useState<boolean | null>(null)
  const [probeMsg, setProbeMsg] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState("")
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const probeAbortRef = useRef(false)

  // 取消进行中的 probe(组件卸载 / 切换 Provider 时)
  useEffect(() => {
    return () => {
      probeAbortRef.current = true
    }
  }, [])

  const chooseProvider = useCallback(
    (id: ProviderId) => {
      safeSet(() => {
        setProvider(id)
        setApiKey("")
        setProbeOk(null)
        setProbeMsg(null)
        const p = PROVIDERS.find((x) => x.id === id)
        if (p) setModel(p.defaultModel)
        if (id === "custom") {
          setModel("")
        } else {
          setCustomModel("")
        }
      })
      track("onboarding_provider_chosen", { provider: id })
    },
    [safeSet],
  )

  const probe = useCallback(async () => {
    if (!apiKey.trim() && provider !== "custom") {
      setProbeMsg("请先粘贴 API Key")
      setProbeOk(false)
      return
    }
    safeSet(() => {
      setProbeBusy(true)
      setProbeOk(null)
      setProbeMsg(null)
    })
    probeAbortRef.current = false
    try {
      const r = await window.dave.provider.probe({
        provider,
        apiKey: provider === "custom" ? customApiKeyOrKey(apiKey) : apiKey,
        model: provider === "custom" ? customModel || undefined : model || undefined,
        customHost: provider === "custom" ? customHost || undefined : undefined,
        customModel: provider === "custom" ? customModel || undefined : undefined,
      })
      if (probeAbortRef.current) return
      safeSet(() => {
        setProbeBusy(false)
        setProbeOk(r.ok)
        setProbeMsg(r.message + (r.ok ? ` · ${r.latencyMs}ms` : ""))
      })
      if (r.ok) {
        track("onboarding_api_key_validated", { provider, latencyMs: String(r.latencyMs) })
      } else {
        track("onboarding_api_key_failed", { provider, message: r.message.slice(0, 32) })
      }
    } catch (err) {
      if (probeAbortRef.current) return
      safeSet(() => {
        setProbeBusy(false)
        setProbeOk(false)
        setProbeMsg(err instanceof Error ? err.message : String(err))
      })
      track("onboarding_api_key_failed", { provider, message: "exception" })
    }
  }, [apiKey, customHost, customModel, model, provider, safeSet])

  const persist = useCallback(async () => {
    // 落盘:provider / key / model / cwd
    await window.dave.store.set("provider", provider)
    if (provider === "custom") {
      await window.dave.store.set("custom-host", customHost)
      await window.dave.store.set("custom-model", customModel)
      await window.dave.store.set("custom-api-key", apiKey)
    } else {
      await window.dave.store.set(`${provider}-api-key`, apiKey)
      await window.dave.store.set(`${provider}-model`, model)
    }
    if (workspace) {
      await window.dave.store.set("cwd", workspace)
    }
    track("onboarding_completed", { provider, hasWorkspace: workspace ? "1" : "0" })
  }, [apiKey, customHost, customModel, model, provider, workspace])

  const pickWorkspace = useCallback(async () => {
    safeSet(() => setWorkspaceBusy(true))
    try {
      const dir = await window.dave.dialog.openDirectory({ title: "选择工作目录" })
      safeSet(() => {
        if (dir) {
          setWorkspace(dir)
          track("onboarding_workspace_chosen", { len: String(dir.length) })
        }
        setWorkspaceBusy(false)
      })
    } catch {
      safeSet(() => setWorkspaceBusy(false))
    }
  }, [safeSet])

  const next = useCallback(async () => {
    if (step === "provider") {
      safeSet(() => setStep("key"))
      return
    }
    if (step === "key") {
      if (!probeOk) {
        await probe()
        return
      }
      safeSet(() => setStep("workspace"))
      return
    }
    if (step === "workspace") {
      await persist()
      safeSet(() => setStep("done"))
      // 短延迟后回调,让用户看到"完成"状态
      setTimeout(() => onCompleted(), 700)
      return
    }
  }, [step, probeOk, probe, persist, onCompleted, safeSet])

  // 步骤条:provider / key / workspace / done
  const steps = ["provider", "key", "workspace", "done"] as const
  const stepIdx = steps.indexOf(step)

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="配置 API Key"
      tabIndex={-1}
      style={{ outline: "none" }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-[var(--bg)] text-[var(--text)] w-[560px] max-w-[92vw] rounded-lg shadow-xl border border-[var(--border)] overflow-hidden">
        {/* 顶部 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-panel)]">
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-dim)]">
            <Cpu size={14} className="text-[var(--accent)]" />
            <span>
              配置向导 · {stepIdx + 1}/{steps.length}
            </span>
          </div>
          <button onClick={onClose} className="btn-icon-muted" title="关闭" aria-label="关闭">
            <X size={14} />
          </button>
        </div>

        {/* 进度条 */}
        <div className="flex h-0.5">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`flex-1 transition-colors ${
                i <= stepIdx ? "bg-[var(--accent)]" : "bg-[var(--bg-sunk)]"
              }`}
            />
          ))}
        </div>

        {/* 主体 */}
        <div className="px-6 py-7 min-h-[260px]">
          {step === "provider" && (
            <div>
              <h2 className="text-base font-semibold text-[var(--text-strong)]">选一个 Provider</h2>
              <p className="text-[12px] text-[var(--text-dim)] mt-1 mb-4">
                之后可以在设置里随时切换。
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {PROVIDERS.map((p) => {
                  const active = provider === p.id
                  return (
                    <button
                      key={p.id}
                      onClick={() => chooseProvider(p.id)}
                      className={`text-left p-3 rounded-md border transition-colors ${
                        active
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-[var(--border)] hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-medium text-[var(--text-strong)]">
                          {p.name}
                        </span>
                        {active && <Check size={14} className="text-[var(--accent)]" />}
                      </div>
                      <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{p.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {step === "key" && (
            <div>
              <h2 className="text-base font-semibold text-[var(--text-strong)]">
                粘贴 {PROVIDERS.find((p) => p.id === provider)?.name} Key
              </h2>
              <p className="text-[12px] text-[var(--text-dim)] mt-1 mb-4">
                Key 只存本机 electron-store,不会上传。
              </p>
              <div className="space-y-3">
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value)
                      setProbeOk(null)
                      setProbeMsg(null)
                    }}
                    onPaste={() => track("onboarding_api_key_pasted", { provider })}
                    placeholder="sk-…"
                    className="input w-full pr-9"
                    autoFocus
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon-muted"
                    title={showKey ? "隐藏" : "显示"}
                    aria-label={showKey ? "隐藏 Key" : "显示 Key"}
                    type="button"
                  >
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>

                {provider === "custom" ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    <input
                      className="input w-full"
                      placeholder="自定义端点 URL(https://…)"
                      value={customHost}
                      onChange={(e) => setCustomHost(e.target.value)}
                    />
                    <input
                      className="input w-full"
                      placeholder="模型名"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                    />
                  </div>
                ) : (
                  <input
                    className="input w-full"
                    placeholder="模型(可改)"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void probe()}
                    disabled={probeBusy}
                    className="btn-outline text-[12px] py-1.5 px-3 inline-flex items-center gap-1.5"
                    type="button"
                  >
                    {probeBusy && <Loader2 size={12} className="animate-spin" />}
                    {probeBusy ? "校验中…" : "校验连通性"}
                  </button>
                  {probeOk === true && (
                    <span className="text-[12px] text-[var(--diff-add)] inline-flex items-center gap-1">
                      <Check size={12} /> {probeMsg}
                    </span>
                  )}
                  {probeOk === false && (
                    <span className="text-[12px] text-[var(--diff-del)]">{probeMsg}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === "workspace" && (
            <div>
              <h2 className="text-base font-semibold text-[var(--text-strong)]">
                选一个工作目录(可选)
              </h2>
              <p className="text-[12px] text-[var(--text-dim)] mt-1 mb-4">
                Agent 模式(suggest / auto / full-auto)需要工作区才能读写文件;ask 模式不需要。
              </p>
              <div className="flex items-center gap-2">
                <input
                  className="input w-full"
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  placeholder="C:\Users\you\projects\my-app"
                  readOnly
                />
                <button
                  onClick={() => void pickWorkspace()}
                  disabled={workspaceBusy}
                  className="btn-outline text-[12px] py-1.5 px-3 inline-flex items-center gap-1.5"
                  type="button"
                >
                  <FolderOpen size={12} />
                  浏览
                </button>
              </div>
              <div className="mt-3 text-[11px] text-[var(--text-faint)]">
                也可稍后到设置里配置。
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center text-center py-3">
              <div className="w-12 h-12 rounded-full bg-[var(--diff-add-bg)] text-[var(--diff-add)] flex items-center justify-center mb-3">
                <Check size={24} />
              </div>
              <h2 className="text-base font-semibold text-[var(--text-strong)]">配置完成</h2>
              <p className="text-[12px] text-[var(--text-dim)] mt-1">正在进入主界面…</p>
            </div>
          )}
        </div>

        {/* 底部 */}
        {step !== "done" && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-panel)]">
            <button
              onClick={() => {
                if (step === "key") safeSet(() => setStep("provider"))
                else if (step === "workspace") safeSet(() => setStep("key"))
                else onClose()
              }}
              className="text-[12px] text-[var(--text-dim)] hover:text-[var(--text)] px-2 py-1.5"
            >
              {step === "provider" ? "取消" : "上一步"}
            </button>
            <button
              onClick={() => void next()}
              disabled={step === "key" && (probeBusy || !apiKey.trim())}
              className="btn"
              type="button"
            >
              {step === "provider" ? "继续" : step === "key" ? (probeOk ? "继续" : "校验") : "完成"}
              {step !== "workspace" && <ChevronRight size={14} />}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// "custom" 模式下,Key 复用到 custom-api-key 时只调一次,避免重复 store
function customApiKeyOrKey(key: string): string {
  return key
}
