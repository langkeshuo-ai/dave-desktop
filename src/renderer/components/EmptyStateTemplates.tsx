/* =========================================================================
   空状态"试试这些"模板 —— 让用户首问前就能"做点什么"。
   设计目标:把"开始对话"这个空白门槛降成"点一个按钮就出示例消息"。
   ========================================================================= */

import { useCallback } from "react"
import { FileSearch, Wrench, BookOpen, Bug, Code2, ListChecks } from "lucide-react"
import { track } from "../lib/telemetry"

interface Template {
  id: string
  icon: typeof FileSearch
  title: string
  prompt: string
  needsWorkspace: boolean
}

const TEMPLATES: Template[] = [
  {
    id: "explain-readme",
    icon: BookOpen,
    title: "帮我读 README",
    prompt: "读一下 README.md,用 5 句话告诉我这个项目做什么、怎么跑。",
    needsWorkspace: true,
  },
  {
    id: "find-bug",
    icon: Bug,
    title: "找出最近一次 commit 引入的 bug",
    prompt: "git log --oneline -20,然后看最近 5 个 commit 改了什么,告诉我哪里可能出 bug。",
    needsWorkspace: true,
  },
  {
    id: "list-todos",
    icon: ListChecks,
    title: "在 TODO 注释里列任务",
    prompt: "扫一遍 src/ 下所有 TODO/FIXME/XXX 注释,按文件整理成清单,告诉我哪些最该先做。",
    needsWorkspace: true,
  },
  {
    id: "explain-code",
    icon: Code2,
    title: "解释一段陌生代码",
    prompt: "随便挑 src/ 下 80 行内的文件,逐段讲它在做什么。",
    needsWorkspace: true,
  },
  {
    id: "shell-help",
    icon: Wrench,
    title: "用 shell 跑个诊断",
    prompt: "跑一下 `node -v && npm -v && ls -la`,告诉我环境是不是齐的。",
    needsWorkspace: true,
  },
  {
    id: "search-text",
    icon: FileSearch,
    title: "在 src 里搜一段文字",
    prompt: "在 src/ 里搜 'TODO',列出命中位置。",
    needsWorkspace: true,
  },
]

interface EmptyStateTemplatesProps {
  hasWorkspace: boolean
  onPick: (prompt: string) => void
}

export function EmptyStateTemplates({ hasWorkspace, onPick }: EmptyStateTemplatesProps) {
  const handle = useCallback(
    (t: Template) => {
      track("template_clicked", { id: t.id })
      onPick(t.prompt)
    },
    [onPick],
  )
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-[560px] mt-2">
      {TEMPLATES.map((t) => {
        const Icon = t.icon
        const disabled = t.needsWorkspace && !hasWorkspace
        return (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => handle(t)}
            title={disabled ? "需要在设置里配置工作区" : t.prompt}
            className={`group text-left px-3 py-2.5 rounded-md border transition-colors ${
              disabled
                ? "border-[var(--border)] bg-[var(--bg-sunk)] text-[var(--text-faint)] cursor-not-allowed"
                : "border-[var(--border)] bg-[var(--bg-panel)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon
                size={14}
                className={disabled ? "text-[var(--text-faint)]" : "text-[var(--accent)]"}
              />
              <span className="text-[12.5px] font-medium text-[var(--text-strong)]">{t.title}</span>
            </div>
            <div className="text-[11.5px] text-[var(--text-dim)] mt-1 line-clamp-2">{t.prompt}</div>
          </button>
        )
      })}
    </div>
  )
}
