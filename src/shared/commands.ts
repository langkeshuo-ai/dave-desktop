/**
 * 命令面板的过滤逻辑(纯函数,可测)。
 * 设计:大小写不敏感,空 query 返回全量,命中 title 或 hint 任一即保留。
 * 抽到 shared 是为了让 main / preload / 渲染层共用同一份实现(测试可单测),
 * 同时不依赖 React/JSX 运行时(避免 tsconfig.node 编译时缺 jsx 报错)。
 */
export interface CommandItem {
  id: string
  title: string
  hint?: string
  // 渲染层可选字段(icon / run);非 UI 上下文(纯过滤测试)用不到,
  // 用 unknown / () => unknown 比 React.ReactNode 更解耦。
  icon?: unknown
  run?: () => unknown
}

export function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter(
    (it) => it.title.toLowerCase().includes(q) || (it.hint || "").toLowerCase().includes(q),
  )
}
