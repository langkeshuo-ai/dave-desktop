import { useState } from "react"
import { ChevronDown, ChevronRight, CircleCheckBig, CircleX, Minus, Wrench } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ToolTrace } from "../../shared/tool-trace"

const STATUS_STYLE: Record<ToolTrace["status"], { dot: string; label: string }> = {
  ok: { dot: "bg-[var(--ok)]", label: "tool.done" },
  denied: { dot: "bg-[var(--ink-3)]", label: "tool.denied" },
  failed: { dot: "bg-[var(--err)]", label: "tool.failed" },
}

const STATUS_ICON: Record<ToolTrace["status"], typeof CircleCheckBig> = {
  ok: CircleCheckBig,
  denied: Minus,
  failed: CircleX,
}

/**
 * 执行轨迹卡（候选 A2'：执行可视化收尾）：
 * 折叠式总结卡，聚合本轮会话中 role:"tool" 消息（工具名 → 状态徽标 → 输出折叠）。
 * 工具输出不进入正文流与 patch 卡分离：tool 输出为执行结果、patch 为文件变更。
 */
export function ExecTraceCard({ traces }: { traces: ToolTrace[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (!traces || traces.length === 0) return null

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${t("tool.traces")} (${traces.length})`}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)]"
        >
          {open ? (
            <ChevronDown size={14} className="text-[var(--ink-3)]" />
          ) : (
            <ChevronRight size={14} className="text-[var(--ink-3)]" />
          )}
          <Wrench size={14} className="text-[var(--amber-600)]" />
          <span className="text-[13px] font-semibold">{t("tool.traces")}</span>
          <span
            role="status"
            className="ml-auto rounded-full bg-[var(--amber-50)] px-2 py-0.5 text-[11px] font-medium text-[var(--amber-600)]"
          >
            {traces.length}
          </span>
        </button>
        {open && (
          <div className="border-t border-[var(--line)] px-3.5 py-3">
            <ul className="space-y-2.5">
              {traces.map((trace, i) => {
                const Icon = STATUS_ICON[trace.status]
                const style = STATUS_STYLE[trace.status]
                return (
                  <li
                    key={i}
                    className="rounded-lg border border-[var(--line)] bg-[var(--bg)]/60 px-2.5 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--amber-700)]">
                        {trace.name}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-medium ${trace.status === "failed" ? "text-[#8f2f22]" : "text-[var(--ink-3)]"}`}
                      >
                        <Icon size={12} strokeWidth={2} className={style.dot} />
                        {t(style.label)}
                      </span>
                    </div>
                    <p className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[var(--ink-2)]">
                      {trace.content}
                    </p>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
