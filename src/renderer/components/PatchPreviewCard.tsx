import { useState } from "react"
import { ChevronDown, ChevronRight, FileDiff } from "lucide-react"
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
 */
export function PatchPreviewCard({ patches }: { patches: PatchRecord[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (!patches || patches.length === 0) return null

  const totalPaths = patches.reduce((acc, p) => acc + (p.paths?.length ?? 0), 0)

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)]"
        >
          {open ? <ChevronDown size={14} className="text-[var(--ink-3)]" /> : <ChevronRight size={14} className="text-[var(--ink-3)]" />}
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
              <div key={i} className={i > 0 ? "mt-3" : ""}>
                {p.paths.length > 0 && (
                  <ul className="mb-1.5 space-y-0.5 font-mono text-[12px] text-[var(--ink-2)]">
                    {p.paths.map((path) => (
                      <li key={path} className="truncate" title={path}>
                        {path}
                      </li>
                    ))}
                  </ul>
                )}
                <CodeBlock className="language-diff">{p.diff}</CodeBlock>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}