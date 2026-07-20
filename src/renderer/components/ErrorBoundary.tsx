import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 顶层错误边界。Electron renderer 一旦抛错整窗白屏(没有 reload 也没人点),
 * 而用户在写长 prompt 时遇到这种事故会丢失工作。
 *
 * 设计:只兜底"渲染期同步抛错",不接 Promise rejection(需要单独 window.onerror
 * hook 配合)。点击 "重置界面" 触发 location.reload — 这是最稳的恢复路径,
 * 渲染层状态(草稿等)会丢但能换回可用窗口。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 主进程日志路径走 preload bridge;renderer 端 console.error 会在 devtools 留痕。
    // 真实项目应该把 error+info 上报到主进程,这里先 console.error 兜住。
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  private handleReset = (): void => {
    // 主入口是 index.html,reload 是最干净的恢复(把已挂载的 React 树整体卸掉重挂)。
    // 草稿类状态(zustand persist 已在 store 里控制)按各自设计保留/丢弃。
    window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg)] text-[var(--text)] p-6"
        // 顶层错误面板:role=alert 让屏幕阅读器立即播报,不依赖 aria-live 异步通知。
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-boundary-title"
        aria-describedby="error-boundary-desc"
      >
        <div className="max-w-md w-full bg-[var(--bg-panel)] border border-[var(--border)] rounded-md shadow-lg p-5 space-y-3">
          <div className="flex items-center gap-2 text-[var(--diff-del)]">
            <AlertTriangle size={18} aria-hidden="true" />
            <h2 id="error-boundary-title" className="text-base font-semibold">
              界面遇到错误
            </h2>
          </div>
          <p id="error-boundary-desc" className="text-xs text-[var(--text-dim)]">
            渲染过程中抛出了未捕获的异常。为避免白屏已冻结子树。点击下方按钮重置界面即可继续使用。
          </p>
          <pre
            // 错误堆栈:role=status 让屏幕阅读器在更新时播报;
            // aria-label 让用户知道这个 pre 块是做什么的。
            role="status"
            aria-label="错误堆栈详情"
            className="max-h-40 overflow-auto text-[11px] font-mono whitespace-pre-wrap break-words bg-[var(--bg-sunk)] border border-[var(--border)] rounded p-2 text-[var(--text)]"
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.handleReset}
            className="btn w-full"
            // 自动 focus 让键盘用户立即可操作
            ref={(el) => {
              if (el) el.focus()
            }}
          >
            <RotateCcw size={14} aria-hidden="true" />
            重置界面
          </button>
        </div>
      </div>
    )
  }
}
