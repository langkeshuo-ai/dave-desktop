import { useEffect, useRef } from "react"

/**
 * 模态打开时把焦点收进 modal,关闭时把焦点还给原触发元素。
 * 设计为 hook 而不是 HOC/组件,避免给简单模态套层组件树。
 *
 * 用法:
 *   useFocusRestore(open)  // 渲染时挂到 dialog root
 *   <div ref={rootRef} role="dialog" ...>
 *
 * 行为约定:
 *   - 打开瞬间保存 document.activeElement,延迟一帧再 focus 自身
 *     (等 overlay 的 transition / mount 完)
 *   - 关闭时若焦点仍在 modal 内才归还,避免覆盖用户后续主动 focus
 *   - 切换 open 状态时总是执行清理,即使在卸载前也会跑 effect cleanup
 */
export function useFocusRestore<T extends HTMLElement>(open: boolean) {
  const rootRef = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const t = setTimeout(() => rootRef.current?.focus(), 0)
    return () => {
      clearTimeout(t)
      const r = rootRef.current
      if (prev && r && document.activeElement && r.contains(document.activeElement)) {
        prev.focus()
      }
    }
  }, [open])
  return rootRef
}
