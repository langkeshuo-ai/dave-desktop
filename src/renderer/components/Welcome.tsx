/* =========================================================================
   三屏欢迎页:价值主张 → 隐私与数据流向 → 立即开始。
   - 任意屏可"跳过",跳过记 telemetry。
   - 左右箭头 + 进度点 + Enter / Esc 全键盘可达。
   - 与 Cursor/Codex 的"first-run 体验"对齐:克制、信息密度高、不营销。
   ========================================================================= */

import { useCallback, useEffect, useState } from "react"
import { Bot, Shield, Zap, ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react"
import { useFocusRestore } from "../lib/useFocusRestore"
import { useMounted } from "../lib/useMounted"
import { track } from "../lib/telemetry"

interface WelcomeProps {
  onComplete: () => void
  onSkip: () => void
}

const SCREENS = [
  {
    id: "value",
    title: "Dave · 你的本地编程搭档",
    subtitle: "AI Agent 直接住在你的电脑里",
    bullets: [
      "四种批准模式,精确控制 AI 能做什么",
      "文件修改可审阅；Shell 始终单独确认，工作目录不等于系统沙箱",
      "光白 Cursor 风格 UI · 浅/夜双主题 · 键盘优先",
    ],
    icon: Bot,
  },
  {
    id: "trust",
    title: "数据透明",
    subtitle: "这些信息会去哪",
    bullets: [
      "API Key 使用系统安全存储保存在本机，并发送给你选择的 Provider 鉴权",
      "代码片段 · 直接 HTTPS 走你选的 Provider,不经额外中转",
      "使用统计 · 全部本地留存,可随时在设置中清空",
      "没有内置远程埋点；对话内容会按请求发送给所选 Provider",
    ],
    icon: Shield,
  },
  {
    id: "start",
    title: "30 秒开始",
    subtitle: "三步完成首启",
    bullets: [
      "选 Provider(OpenAI / Anthropic / DeepSeek / 自定义)",
      "粘贴 API Key,自动校验连通性",
      "选一个工作目录(可选),然后开聊",
    ],
    icon: Sparkles,
  },
] as const

export function Welcome({ onComplete, onSkip }: WelcomeProps) {
  const dialogRef = useFocusRestore<HTMLDivElement>(true)
  const safeSet = useMounted()
  const [idx, setIdx] = useState(0)
  const isLast = idx === SCREENS.length - 1
  const cur = SCREENS[idx]
  const Icon = cur.icon

  // 首屏进入时打点,后续翻页也打点(漏斗会算 welcome 完整体验率)。
  useEffect(() => {
    track("onboarding_welcome_seen", { idx: String(idx), id: cur.id })
  }, [idx, cur.id])

  const next = useCallback(() => {
    if (isLast) {
      track("onboarding_welcome_dismissed", { via: "next" })
      onComplete()
      return
    }
    safeSet(() => setIdx(idx + 1))
  }, [idx, isLast, onComplete, safeSet])

  const prev = useCallback(() => {
    if (idx === 0) return
    safeSet(() => setIdx(idx - 1))
  }, [idx, safeSet])

  const skip = useCallback(() => {
    track("onboarding_welcome_dismissed", { via: "skip" })
    onSkip()
  }, [onSkip])

  // 全局键盘:← → Enter Esc 都能工作(焦点在 dialog 内时,默认就能用)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // IME 合成期不抢键,避免中文输入法候选窗期被截胡
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === "ArrowRight") {
        e.preventDefault()
        next()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        prev()
      } else if (e.key === "Escape") {
        e.preventDefault()
        skip()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [next, prev, skip])

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="欢迎使用 Dave Desktop"
      tabIndex={-1}
      style={{ outline: "none" }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 backdrop-blur-sm"
      onClick={(e) => {
        // 点 dialog 外部(scrim)跳过 — 与其他模态一致
        if (e.target === e.currentTarget) skip()
      }}
    >
      <div className="bg-[var(--bg)] text-[var(--text)] w-[520px] max-w-[92vw] rounded-lg shadow-xl border border-[var(--border)] overflow-hidden">
        {/* 顶部:关闭 + 进度 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-panel)]">
          <div className="flex items-center gap-1.5">
            {SCREENS.map((_, i) => (
              <span
                key={i}
                className={`block w-6 h-1 rounded-full transition-colors ${
                  i === idx ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                }`}
                aria-hidden
              />
            ))}
          </div>
          <button onClick={skip} className="btn-icon-muted" title="跳过" aria-label="跳过欢迎页">
            <X size={14} />
          </button>
        </div>

        {/* 主体 */}
        <div className="px-6 py-7">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)]">
              <Icon size={22} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-strong)]">{cur.title}</h2>
              <p className="text-[12px] text-[var(--text-dim)] mt-0.5">{cur.subtitle}</p>
            </div>
          </div>

          <ul className="space-y-2.5">
            {cur.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed">
                <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-sunk)] border border-[var(--border)] text-[11.5px] text-[var(--text-dim)]">
            <Zap size={12} className="text-[var(--accent)]" />
            <span>
              提示:任意屏可按 <kbd className="kbd px-1.5">Esc</kbd> 跳过,稍后可在设置里再次打开。
            </span>
          </div>
        </div>

        {/* 底部:左右 + 主按钮 */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-panel)]">
          <button
            onClick={prev}
            disabled={idx === 0}
            className="btn-icon-muted px-2.5 py-1.5"
            aria-label="上一屏"
            title="上一屏"
          >
            <ChevronLeft size={14} />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={skip}
              className="text-[12px] text-[var(--text-dim)] hover:text-[var(--text)] px-2 py-1.5"
            >
              跳过
            </button>
            <button onClick={next} className="btn" autoFocus data-welcome-primary>
              {isLast ? "开始配置" : "继续"}
              {!isLast && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
