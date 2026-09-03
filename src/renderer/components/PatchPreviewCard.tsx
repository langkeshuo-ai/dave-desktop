import { useState } from "react"
import { Check, ChevronDown, ChevronRight, CircleSlash2, FileDiff } from "lucide-react"
import { useTranslation } from "react-i18next"
import { CodeBlock } from "./MessageBubble"

export interface PatchRecord {
  diff: string
  paths: string[]
}

/**
 * 文件变更卡（候选 A：执行可视化补全）：
 * 折叠式总结卡，聚合一轮会话中的 patch（diff 独立载体，不污染正文流），
 * 复用 CodeBlock（hljs diff 语言已注册）渲染补丁预览。
 * 每行 patch 提供「应用 / 忽略」操作：复用已注册的 workspace-apply-patch 契约
 * （主进程 applyWorkspaceDiff + 限流），忽略为本地隐去，不触发 IPC。
 */
export function PatchPreviewCard({ patches }: { patches: PatchRecord[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [applied, setApplied] = useState<Record<number, string>>({})
  const [ignored, setIgnored] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<number | null>(null)

  if (!patches || patches.length === 0) return null

  const totalPaths = patches.reduce((acc, p) => acc + (p.paths?.length ?? 0), 0)

  const applyPatch = async (i: number, diff: string) => {
    setBusy(i)
    try {
      const res = await window.dave.workspace.applyPatch(diff)
      setApplied((prev) => ({
        ...prev,
        [i]: res.ok ? t("common.patchApplied") : res.output || t("common.patchFailed"),
      }))
    } catch {
      setApplied((prev) => ({ ...prev, [i]: t("common.patchFailed") }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)]"
        >
          {open ? (
            <ChevronDown size={14} className="text-[var(--ink-3)]" />
          ) : (
            <ChevronRight size={14} className="text-[var(--ink-3)]" />
          )}
          <FileDiff size={14} className="text-[var(--amber-600)]" />
          <span className="text-[13px] font-semibold">{t("common.fileChanges")}</span>
          {totalPaths > 0 && (
            <span className="ml-auto rounded-full bg-[var(--amber-50)] px-2 py-0.5 text-[11px] font-medium text-[var(--amber-600)]">
              {totalPaths}
            </span>
          )}
        </button>
        {open && (
          <div className="border-t border-[var(--line)] px-3.5 py-3">
            {patches.map((p, i) => (
              <div
                key={i}
                className={`${i > 0 ? "mt-3" : ""} ${ignored.has(i) ? "opacity-45" : ""}`}
              >
                <div className="flex items-center gap-1.5">
                  {p.paths.length > 0 && (
                    <ul className="mb-1 mr-auto space-y-0.5 font-mono text-[12px] text-[var(--ink-2)]">
                      {p.paths.map((path) => (
                        <li key={path} className="truncate" title={path}>
                          {path}
                        </li>
                      ))}
                    </ul>
                  )}
                  {applied[i] && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ok-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--ok)]">
                      <Check size={11} />
                      {applied[i]}
                    </span>
                  )}
                  {!applied[i] && (
                    <button
                      disabled={busy === i}
                      onClick={() => void applyPatch(i, p.diff)}
                      className="rounded-md bg-gradient-to-br from-[#f59e0b] to-[#d97706] px-2 py-0.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {t("common.patchApply")}
                    </button>
                  )}
                  {!applied[i] && (
                    <button
                      disabled={busy === i}
                      onClick={() => setIgnored((prev) => new Set(prev).add(i))}
                      aria-label={t("common.patchIgnore")}
                      title={t("common.patchIgnore")}
                      className="grid h-5 w-5 place-items-center rounded-md text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                    >
                      <CircleSlash2 size={13} />
                    </button>
                  )}
                </div>
                <CodeBlock className="language-diff">{p.diff}</CodeBlock>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
