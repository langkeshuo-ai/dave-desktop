# 更新日志

所有显著变更按 Keep a Changelog 格式记录。本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增
- 消息内联操作条:复制 / 重新生成 / 停止
  - 复制:本地 clipboard,无 IPC 开销
  - 重新生成:仅末条 assistant 可见,复用最后一条 user 内容触发流式
  - 停止:流式中常显(否则 hover 显),继承现有 abort 通道
- 滚到底按钮:用户离开底部时浮出,避免长会话中 auto-scroll 抢权
- 命令面板(Cmd/Ctrl+K):会话快速跳转 + 全局动作(新会话 / 设置 / 主题 / 侧栏)
- 侧栏键盘可达性:role=listbox / role=option,Enter / Space 选中,Cmd+Delete 删除
- Alt+Up/Down 全局切换会话(侧栏可见时)
- 键盘帮助面板(`?` 触发,Shift+/):列出所有声明的快捷键,焦点恢复
- 焦点恢复 hook `useFocusRestore` — 统一模态框焦点保存/恢复,避免各自手写
- `?` 键全局打开键盘帮助(`?` 触发,非 input 焦点生效)
- 首启三屏欢迎页 `Welcome.tsx`:价值主张 → 数据透明 → 30 秒开始,键盘可达 + 进度条
  - IME 合成期不抢 Enter/方向键(中文输入法不冲突)
  - 任意屏可 Esc / scrim 跳过
- API Key 向导 `ApiKeyWizard.tsx`:Provider 选择 → Key 实时校验 → 工作区(可选)
  - 复用主进程 `probeProviderConnection`,失败原因直接展示
  - 切 Provider 自动清空 Key,避免误用上家凭据
- 空状态"试试这些"模板 `EmptyStateTemplates.tsx`:6 个一键 prompt,无工作区自动置灰
- 本地遥测(无第三方,仅落 electron-store):首启 / onboarding / 漏斗 / 模板点击
  - 环形缓冲 5000 条,过期滚动
  - 漏斗 `computeFunnel` 计算 launched → onboarded → workspaceReady → firstMessage
  - 7 日回访窗口(28 天上限),同 ts 不同 props 分别计数
- 渲染端 `track()` 助手:fire-and-forget,IPC 失败静默
- 主进程 telemetry-store + 5 个 IPC handler(emit / funnel / events / clear / isFirstRun)
- 设置 → 关于 → FunnelView:展示当前漏斗,支持"重新查看欢迎页"
  和"清空统计"按钮
- 懒加载非关键组件(Settings / CommandPalette / KeyboardHelp / WorkspacePanel
  / Welcome / ApiKeyWizard)首次进入时按需加载,改善 cold start
- 自检清单 + 录屏盲测脚本 `tests/SELF_CHECK.md`:9 节、100+ 步骤
  覆盖自动化 / 引导 / 向导 / 主界面 / 性能 / 录屏剧本
- 性能预算三道闸 + 自动打点(锁住产品规约)
  - `FIRST_RUN_BUDGET_MS = 60_000` (首启到可输入)
  - `TTFB_BUDGET_MS = 5_000` (API key 已就位 → 首问首字节)
  - `COLD_WINDOW_BUDGET_MS = 3_000` (主进程拉起 → 主窗口可见)
  - 主进程 `ready-to-show` 打 `first_window_shown` + elapsed + within 标记
  - 渲染端 mount 第一次 effect 打 `renderer_ready`
  - 渲染端首个 onChunk 打 `ttfb_recorded` + 实际 ms + within 标记
  - `checkStartupBudget(kind, elapsed)` 纯函数,可单测
- telemetry 事件名白名单(IPC 注入防御)
  - `src/shared/telemetry.ts` 导出 `TELEMETRY_EVENT_NAMES` 常量
  - `satisfies readonly TelemetryEventName[]` 锁住类型与运行时同步
  - `src/main/ipc.ts` telemetry-emit handler 拒绝未知事件名
  - 防止渲染端被注入撑爆 store(原仅长度校验,新增白名单校验)
- 错误边界 a11y 增强(`ErrorBoundary.tsx`)
  - `role="alertdialog"` + `aria-modal` + `aria-labelledby` + `aria-describedby`
  - 错误堆栈 `role="status"` + `aria-label`
  - "重置界面"按钮自动 focus,键盘用户立即可操作
- WorkspacePanel a11y 增强
  - `aria-live="polite"` + `aria-atomic` 状态播报区(`.sr-only` 不打扰视觉)
  - 错误条 `role="alert"` 立即播报
  - `src/renderer/styles/globals.css` 新增 `.sr-only` 工具类
- `applyPatchToText` 缺 structured 时的 null guard
  - 修复 `null as StructuredPatch` 时底层抛 `Cannot read properties of null` 的"未翻译"错误
  - 统一抛"patch 应用失败:缺少结构化 patch"

### 修复
- shell-policy 解释器 -c 变体匹配:正则重写支持 -c / -lc / -xc / -lxc / -l -c 全形式
  (回溯语义:`-[a-zA-Z0-9]*-?c\b` 替代 `(?:...)?` 包,避免整组跳过)
- waitApproval 默认 5 分钟超时(此前 promise 永久挂起,关掉批准窗即卡死)
- Agent 工具循环硬上限 50 轮(模型故障时防止 token/内存耗尽)
- registerFocusScopedShortcuts 监听器泄漏(bound 标志幂等)
- 渲染进程崩溃自动 reload(单次重试,避免 loop)
- LLM 输出 XSS 防御:rehype-sanitize 白名单 schema(className 保留供 hljs)
- 新建会话并发守卫:菜单 + 侧栏按钮并发触发产生孤儿会话
  (`creatingSessionRef` 包住 handleNewSession,finally reset 避免卡死)
- App.tsx 缺失 `status` / `statusMsg` state 声明
  (前轮只引用未声明,补回 `useState<"idle"|"running"|"warn"|"error">` 字面量联合)
- `session.ts` `deleteSession` 未调用 `sessionRuntime.abortSession(sessionId)`
  (import 存在但调用缺失,导致删除会话后 AbortController 与 pending approval
   仍驻留 sessionRuntime.Map,长生命周期下出现内存泄漏;已在函数顶部补回调用)
- 中途中止流(streamingContent 丢失):用户点"停止" / iteration cap / abort 时,
  主进程不再落库 streamingContent,渲染端却直接清空,体感"打字打一半不见了"。
  已在 `ChatStreamDone` 加 `aborted?: boolean` 字段,主进程在 AbortError catch 路径
  发送 `{ aborted: true }`,渲染端 onDone 收到后把当前 streamingContent
  落为最后一条 assistant 消息(用 `useStore.getState()` 取最新值,
  避免 effect 依赖 streamingContent 触发每个 chunk 重绑监听器)。
- `computeFunnel` dedup 漏算同 ts 不同 ret(0/1)事件:之前 key 只用 `name+ts`,
  测试 `computes rates from a healthy funnel` 期望 launched=2(两个 app_launch 同 ts
  但 ret=0/1)却拿到 1。修正 dedup key = `name+ts+JSON.stringify(props)`,
  同 ts 不同 props 视为不同事件,同 name+ts+props 仍只算 1。
- `tests/unit.test.ts` 末尾有两个 `it` 块漂浮在 `describe` 外(Vitest 不识别,
  报 uncaught it warning)。已收纳到 `providers — body / delta extras` describe 下。
- abort 状态下 runAgentLoop / runToolCalls 仍会继续:
  原 `abortSession` 从 `aborts Map` 里删了 controller,导致
  `getSignal(sessionId)?.aborted` 永远为 `undefined`,
  循环在用户点"停止"后会被新一轮 `beginAbortScope` 用 fresh signal 重启。
  修法:
  1) `SessionRuntime.abortSession` 不再删 controller(只 `controller.abort()`);
  2) `beginAbortScope` 看到 `prev.signal.aborted` 时直接返回已中止 signal,
     避免被 fresh signal 覆盖 abort 状态;
  3) `runAgentLoop` 每轮 while 顶部 / `runToolCalls` 每个工具顶部
     检查 `getSignal(sessionId)?.aborted`,已中止则抛 `DOMException("aborted", "AbortError")`,
     让 `handleChatStream` 的 catch 统一发 `chat-stream-done { aborted: true }`,
     渲染端才能把 partial 落为最后一条 assistant 消息。

### 工程
- rehype-sanitize@6 工厂签名(少 file/next)与 unified Plugin 不严格兼容
  → 元组 + `as never` 断言 + `PluggableList` 标注
- 命令面板 `filterCommands` 抽到 `src/shared/commands.ts`(`icon/run` 用 unknown 表达,
  渲染层扩展 `CommandPaletteItem extends CommandItem` 补 ReactNode/强类型 run);
  在 vitest 中覆盖空 query / 大小写不敏感 / hint 命中 / 无匹配四个场景
- `ErrorBoundary` 组件已存在并包住 `<App />`,防止渲染错误导致白屏
- 依赖:新增 `rehype-sanitize@^6.0.0`
- 菜单新增 `open-palette` 动作,绑定 `CommandOrControl+K`

### 修复(本轮)
- App.tsx 全局快捷键 effect 缺少 IME 合成期保护
  - 早返回加 `e.isComposing || e.keyCode === 229`
  - 与 Welcome / ApiKeyWizard 内的 Enter/方向键一致,避免中文输入法候选窗期
    误触发 Cmd+K / Alt+Arrow / `?` 等全局快捷键
- App.tsx `store.get("theme"|"cwd"|"mode")` 三个 Promise 缺 catch,IPC 偶发失败
  时会抛 unhandled rejection。已改为 `.then(success, error)` 双参形式,
  失败静默回退默认
- `src/main/chat-loop.ts` 死代码清理:移除未使用的 `TOOLS` 导入和 `void TOOLS`
  占位(import 与 `getTool`/`toolDefsFor` 等子项混用导致 unused import 警告,
  顺手清掉,实际无功能影响)

### 测试
- `tests/unit.test.ts` 累计 104 用例,涵盖 shell-policy 边界 / needsApproval 矩阵
  / extractDelta 边界 / SessionRuntime abort+approval 契约 / deleteSession 清理
  / 命令面板过滤 / 漏斗同 ts 不同 props 去重 / patch null guard / patch 多 hunk /
  truncateMessages / 启动预算 / eslint 类型 / patch parse view 等
