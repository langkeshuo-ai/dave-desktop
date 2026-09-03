import { Component, type ErrorInfo, type ReactNode } from "react"
import { i18n } from "../i18n"

interface Props {
  children: ReactNode
  /** 错误面板标题（默认通用） */
  label?: string
}

interface State {
  error: Error | null
}

/**
 * 组件错误边界：子树渲染/生命周期异常时隔离崩溃，降级为可读面板，
 * 避免一次渲染错误拖垮整个应用（生产级韧性）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 结构化日志走控制台（生产可接 diagnostics 上报）
    console.error("[ErrorBoundary]", error.message, info.componentStack)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="grid h-full min-h-[160px] place-items-center bg-[var(--bg)] p-6"
        >
          <div className="max-w-[420px] rounded-xl border border-[var(--err)]/40 bg-[var(--surface)] p-5 shadow-sm">
            <p className="text-[13px] font-semibold text-[var(--err)]">
              {this.props.label ?? i18n.t("common.interfaceError")}
            </p>
            <p className="mt-2 break-words font-mono text-[12px] text-[var(--ink-2)]">
              {this.state.error.message}
            </p>
            <button
              onClick={this.reset}
              className="mt-4 rounded-lg border border-[var(--err)]/40 px-3 py-1.5 text-[12.5px] font-medium text-[var(--err)] hover:bg-[var(--err-bg)] active:scale-[0.98]"
            >
              {i18n.t("common.retry")}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
