import { AlertTriangle, TerminalSquare, FileWarning } from "lucide-react"
import { useTranslation } from "react-i18next"

/** 审批卡片：展示待批准工具与风险，允许/拒绝。 */
export function ApprovalCard({
  tool,
  args,
  mutates,
  isShell,
  onDecision,
}: {
  tool: string
  args: Record<string, unknown>
  mutates: boolean
  isShell: boolean
  onDecision: (approved: boolean) => void
}) {
  const { t } = useTranslation()
  const argText = Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ")
  const risky = mutates || isShell

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-[var(--amber-600)]/50 bg-[var(--surface)] shadow-[0_0_0_3px_rgba(245,158,11,0.10)]">
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-3.5 py-2.5">
          <TerminalSquare size={15} className="text-[var(--amber-600)]" />
          <span className="text-[13px] font-semibold">{t("approval.title")}</span>
          {risky && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--err-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--err)]">
              <AlertTriangle size={11} />
              {mutates ? t("approval.mutates") : t("approval.isShell")}
            </span>
          )}
        </div>
        <div className="px-3.5 py-3">
          <div className="font-mono text-[12.5px] text-[var(--ink)]">
            <span className="text-[var(--ink-3)]">{t("approval.tool")}:</span> {tool}
          </div>
          {argText && (
            <div className="mt-1.5 truncate font-mono text-[12px] text-[var(--ink-2)]" title={argText}>
              {argText}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onDecision(true)}
              className="flex-1 rounded-lg border border-[var(--ok)]/40 py-1.5 text-[13px] font-medium text-[var(--ok)] hover:bg-[var(--ok-bg)] active:scale-[0.98]"
            >
              {t("approval.allow")}
            </button>
            <button
              onClick={() => onDecision(false)}
              className="flex-1 rounded-lg border border-[var(--err)]/40 py-1.5 text-[13px] font-medium text-[var(--err)] hover:bg-[var(--err-bg)] active:scale-[0.98]"
            >
              {t("approval.deny")}
            </button>
          </div>
        </div>
        {isShell && !mutates && (
          <div className="flex items-center gap-1.5 border-t border-[var(--line)] bg-[var(--amber-50)] px-3.5 py-2 text-[12px] text-[var(--amber-600)]">
            <FileWarning size={13} />
            {t("approval.isShell")}
          </div>
        )}
      </div>
    </div>
  )
}