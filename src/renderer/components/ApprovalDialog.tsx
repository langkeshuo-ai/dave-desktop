import { useEffect, useState } from "react"
import { Shield, Check, X, Terminal, FileCode2, FileDiff, FilePlus, Trash2 } from "lucide-react"
import { useFocusRestore } from "../lib/useFocusRestore"

interface ApprovalDialogProps {
  sessionId: string
  tool: string
  args: Record<string, unknown>
  mutates: boolean
  isShell: boolean
  onApprove: (sessionId: string, approved: boolean) => void
}

// Shares modal shell with Settings for visual unity.
export function ApprovalDialog({
  sessionId,
  tool,
  args,
  mutates,
  isShell,
  onApprove,
}: ApprovalDialogProps) {
  const [dismissed, setDismissed] = useState(false)
  const dialogRef = useFocusRestore<HTMLDivElement>(!dismissed)

  const resolve = (approved: boolean) => {
    if (dismissed) return
    setDismissed(true)
    onApprove(sessionId, approved)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        resolve(false)
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        resolve(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind once per open
  }, [sessionId])

  if (dismissed) return null

  return (
    <div className="modal-scrim !z-[60]" role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-card !max-w-md"
        role="dialog"
        aria-modal="true"
        aria-label="工具批准"
        onClick={(e) => e.stopPropagation()}
        style={{ outline: "none" }}
      >
        <div className="modal-header">
          <div className="flex items-center gap-2 min-w-0">
            <Shield
              size={14}
              className={mutates || isShell ? "text-[var(--diff-del)]" : "text-[var(--accent)]"}
            />
            <h3 className="modal-title truncate">批准 · {pickToolLabel(tool)}</h3>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {mutates && <span className="chip">写入</span>}
            {isShell && (
              <span className="chip">
                <Terminal size={9} /> shell
              </span>
            )}
          </div>
        </div>

        <div className="modal-body">
          <div className="flex items-start gap-2.5 mb-3">
            <div className="w-8 h-8 rounded bg-[var(--bg-sunk)] border border-[var(--border)] flex items-center justify-center shrink-0">
              {pickToolIcon(tool)}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-[var(--text-strong)] mono">{tool}</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{pickToolDesc(tool)}</div>
            </div>
          </div>
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded p-2.5 text-xs mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
            {renderPreview(tool, args)}
          </div>
          <p className="text-[10px] text-[var(--text-faint)] mt-2">Esc 拒绝 · Ctrl+Enter 批准</p>
        </div>

        <div className="modal-footer !justify-end">
          <button type="button" onClick={() => resolve(false)} className="btn btn-ghost text-xs">
            <X size={13} /> 拒绝
          </button>
          <button type="button" onClick={() => resolve(true)} className="btn text-xs">
            <Check size={13} /> 批准
          </button>
        </div>
      </div>
    </div>
  )
}

function pickToolIcon(tool: string) {
  const cls = "w-4 h-4 text-[var(--accent)]"
  switch (tool) {
    case "write_file":
      return <FilePlus size={16} className={cls} />
    case "apply_patch":
      return <FileDiff size={16} className={cls} />
    case "remove":
      return <Trash2 size={16} className="w-4 h-4 text-[var(--diff-del)]" />
    case "shell":
      return <Terminal size={16} className="w-4 h-4 text-[#9a6a00]" />
    default:
      return <FileCode2 size={16} className={cls} />
  }
}

function pickToolLabel(tool: string): string {
  const m: Record<string, string> = {
    read_file: "读取文件",
    list_files: "列出文件",
    write_file: "写入文件",
    propose_patch: "提议补丁",
    apply_patch: "应用补丁",
    remove: "删除",
    ast_grep: "AST 搜索",
    shell: "Shell",
    file_tree: "文件树",
  }
  return m[tool] ?? tool
}

function pickToolDesc(tool: string): string {
  const m: Record<string, string> = {
    read_file: "读取工作区文件",
    list_files: "列出目录",
    write_file: "写入/覆盖文件",
    propose_patch: "解析 diff，不落盘",
    apply_patch: "应用 unified-diff",
    remove: "删除文件或目录",
    ast_grep: "AST 结构搜索",
    shell: "工作区 shell（30s）",
    file_tree: "枚举文件树",
  }
  return m[tool] ?? tool
}

function renderPreview(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "read_file":
    case "list_files":
    case "remove":
      return `path: ${(args.path as string) ?? "(根)"}`
    case "write_file": {
      const p = (args.path as string) ?? ""
      const c = (args.content as string) ?? ""
      const truncated = c.length > 800 ? `${c.slice(0, 800)}\n\n…（${c.length} 字符）` : c
      return `path: ${p}\n\n${truncated}`
    }
    case "propose_patch":
    case "apply_patch": {
      const d = (args.diff as string) ?? ""
      return d.length > 1200 ? `${d.slice(0, 1200)}\n\n…（${d.length} 字符）` : d
    }
    case "ast_grep": {
      const pat = (args.pattern as string) ?? ""
      const lang = (args.lang as string) ?? "auto"
      const paths = (args.paths as string[]) ?? ["(root)"]
      return `pattern: ${pat}\nlang: ${lang}\npaths: ${paths.join(", ")}`
    }
    case "shell":
      return `command: ${(args.command as string) ?? ""}\ncwd: ${(args.cwd as string) ?? "(root)"}`
    case "file_tree":
      return `depth: ${(args.depth as number) ?? 3}`
    default:
      return JSON.stringify(args, null, 2)
  }
}
