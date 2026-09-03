import { GitBranch, Folder, Shield, Hash } from "lucide-react"

interface StatusBarProps {
  status: "idle" | "running" | "warn" | "error"
  message: string
  mode: string
  sessionCount: number
  workspace?: string
  /** Approximate context tokens for current transcript. */
  tokenCount?: number
  tokenBudget?: number
}

function shortPath(path: string): string {
  if (!path) return "未设置"
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean)
  if (parts.length <= 2) return parts.join("/") || path
  return parts.slice(-2).join("/")
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}

// Cursor-style bottom status bar — single accent row.
export function StatusBar({
  status,
  message,
  mode,
  sessionCount,
  workspace = "",
  tokenCount,
  tokenBudget,
}: StatusBarProps) {
  const variant = status === "error" ? "error" : status === "warn" ? "warn" : ""
  const tokenTitle =
    tokenCount !== undefined
      ? `上下文约 ${tokenCount.toLocaleString()} / ${(tokenBudget ?? 96000).toLocaleString()} tokens`
      : "上下文"
  return (
    <div className={`statusbar ${variant}`}>
      <div className="statusbar-item" title="批准模式">
        <Shield size={11} />
        <span>{mode}</span>
      </div>
      <div className="flex-1 truncate px-2" title={message}>
        {message}
      </div>
      {tokenCount !== undefined && (
        <div className="statusbar-item" title={tokenTitle}>
          <Hash size={11} />
          <span>
            {formatTokens(tokenCount)}
            {tokenBudget ? `/${formatTokens(tokenBudget)}` : ""}
          </span>
        </div>
      )}
      <div className="statusbar-item" title="会话数">
        <GitBranch size={11} />
        <span>{sessionCount}</span>
      </div>
      <div className="statusbar-item" title={workspace || "工作区未设置"}>
        <Folder size={11} />
        <span className="max-w-[10rem] truncate">{shortPath(workspace)}</span>
      </div>
    </div>
  )
}
