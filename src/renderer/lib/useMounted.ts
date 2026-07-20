import { useCallback, useEffect, useRef } from "react"

/**
 * 组件挂载状态 + safeSet 守卫。
 *
 * 为什么需要:异步操作(`await window.dave.xxx` / `fetch` / `setTimeout`)的回调
 * 可能在组件已卸载后才执行,React 18 静默吞掉 setState,但仍是"不干净"的副作用。
 * 用 ref + cleanup 显式跳过,意图清楚。
 *
 * 用法:
 *   const safeSet = useMounted()
 *   await window.dave.x()
 *   safeSet(() => setState(...))
 *
 * 何时不用:同步事件处理(没有 await)直接 setState 即可。
 */
export function useMounted() {
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  return useCallback(<T,>(fn: () => T) => {
    if (mountedRef.current) fn()
  }, [])
}
