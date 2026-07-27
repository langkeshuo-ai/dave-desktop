/** 通用加载 spinner 组件 —— 用于 Suspense fallback 和其他加载状态 */

export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClass = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  }[size]

  return (
    <div className="flex items-center justify-center w-full h-full">
      <div
        className={`${sizeClass} border-2 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin`}
        role="status"
        aria-label="加载中"
      />
    </div>
  )
}

/** 全屏加载遮罩 —— 用于模态组件懒加载 */
export function LoadingOverlay() {
  return (
    <div
      className="fixed inset-0 bg-[var(--scrim)] backdrop-blur-sm flex items-center justify-center z-50"
      role="status"
      aria-label="加载中"
    >
      <LoadingSpinner size="lg" />
    </div>
  )
}
