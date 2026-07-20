# Dave Desktop — AI Agent Guide

## Build & verify

```bash
npm install
npm run dev          # electron-vite hot-reload
npm run build        # production build
npm run typecheck    # tsc --noEmit on BOTH tsconfigs (renderer + node)
npm run test         # vitest (tests/unit.test.ts)
npm run verify       # full CI: typecheck → test → build
npm run package:win  # electron-builder (NSIS + portable)
```

## Architecture

**Electron 3-process model**: `src/main/` (Node), `src/preload/` (contextBridge), `src/renderer/` (React 18 + Tailwind 4 + Zustand 5). `src/shared/` is imported by all three layers — pure functions and types only.

## Critical gotchas

### Dual tsconfig
`tsconfig.json` covers **renderer + shared** (paths: `@/*` → `src/renderer/*`).  
`tsconfig.node.json` covers **main + preload + shared + config** (paths: `@main/*`, `@preload/*`).  
`npm run typecheck` runs **both** — always do `npm run typecheck`, never just `tsc --noEmit`.

### ESM/CJS interop
`package.json` declares `"type": "module"` for dev tooling, but `electron-builder.config.ts` rewrites it to `"type": "commonjs"` inside the packaged asar via `extraMetadata`. The main process is bundled as CJS (`format: "cjs"`, `interop: "auto"`). Pure-ESM packages (e.g. `electron-store@11`) need `resolveDefaultExport()` from `src/main/esm-interop.ts` — without it `new Store()` throws "is not a constructor".

### electron-vite strips crossorigin from HTML
The `stripCrossorigin` plugin in `electron.vite.config.ts` removes `crossorigin="anonymous"` from the built `index.html` because Electron's `file://` origin treats it as cross-origin against the CSP.

### IPC / tray idempotency guards
`registerIpcHandlers()` in `ipc.ts` and `createTray()` in `tray.ts` have module-level `registered`/`trayCreated` flags — electron-vite's CJS-shim can re-run modules, causing duplicate registrations. Always add this guard when registering new handlers.

### lifecycle.ts breaks circular imports
The quit-flag (`setQuitting`/`isAppQuitting`) lives in its own module. Moving it out of `index.ts` broke a circular import that caused rollup to inline `index.ts`'s top-level side-effecting code twice.

### Store encryption
`electron-store` is encrypted with a per-machine key derived via XOR of `app.getPath("userData")` with a fixed salt — not a strong KDF, just machine-binding.

### Windows auto-launch sentinel
`isEnabled()` requires both the `.lnk` shortcut AND a `.dave-sentinel` file beside it. Legacy marker files from an old broken version are auto-cleaned.

### Agent shell policy
`src/shared/shell-policy.ts` has a **hard-deny list** (always blocked: `rm -rf /`, fork bomb, `mkfs`, `dd if=`, `curl|sh`, etc.) and an **elevated-risk list** (triggers approval dialog even in `full-auto` mode). The anti-pattern comments in Chinese at line 34-44 are the agent's behavioral rules — read them.

### Approval modes
Four modes in `needsApproval()`: `ask` (no tools), `suggest` (mutating tools need approval), `auto` (shell needs approval), `full-auto` (only elevated shell needs approval).

### UI is Chinese-first
All UI labels, error messages, and CLI output are in Chinese. The CSS has a light theme default and a `.night` variant.

### Tests live in tests/
Tests are in `tests/unit.test.ts`, not alongside source. Vitest config includes `tests/**/*.test.ts`. The test file mocks `electron-store` and `electron` modules.

### Tool output is clamped
`clampToolOutput()` in `shared/context.ts` truncates large tool outputs to 80K chars (head + tail, middle replaced with a Chinese "截断" message). Context truncation keeps the last user message under a 96K token budget.

### Provider default models
OpenAI → `gpt-4o`, Anthropic → `claude-sonnet-4-20250514`, DeepSeek → `deepseek-chat`, Custom → `gpt-4o`. Renderer uses `estimateTokensRough` (chars/4, no tiktoken) to keep the bundle small.

### rehype-sanitize@6 plugin typing
`rehype-sanitize@6` 工厂返回 `(tree: Root) => Root`,而 unified `Plugin<...>` 期望
`(tree, file, next) => ...`。直接 `rehypeSanitize(schema)` 给 `rehypePlugins` 会在
tsc 报 TS2322。`MessageList.tsx` 用元组 `[rehypeSanitize as never, schema as never]`
+ 显式标注 `Pluggable` / `PluggableList` 解决,运行期工作正常。

### shell-policy 正则回溯
解释器 -c 变体匹配必须用 `-[a-zA-Z0-9]*-?c\b`(让 `*` 参与回溯)。**不要**用
`(?:[a-zA-Z0-9]*-)?c\b` — 整个可选组跳过时位置无法回退到 `c`,`sh -lc` 之类
组合 flag 会全部漏匹配。详见 `src/shared/shell-policy.ts` 注释。

### ChatView scroll 行为
仅在 `atBottom` 时才自动跟随 streaming,否则等用户主动点浮起的 scroll-bottom 按钮。
否则长会话生成时用户阅读上半段,会被强制拖回底部。

### 全局快捷键
- `Cmd/Ctrl+K`        命令面板 toggle(总是拦截,即使在 input 中)
- `Alt+Up/Down`       切换会话(只在非 input 焦点时生效,侧栏可见才生效)
- 全局监听挂在 `window`,用 `cbsRef` 同步最新 callback,避免 effect 频繁重绑

### MessageActions 可见性
- hover 显(focus-within 也能显,键盘可达)
- `isStreaming` 时常显 — 停止按钮是关键交互,不能被 hover 隐藏

### 重新生成(Regenerate)
仅末条 assistant 可见该按钮,避免中间任意条触发产生"我在重发哪段"的语义歧义。
触发时先 abort 当前流(若有),再 `handleSendMessage(lastUserContent)`,无侵入安全网。

### 命令面板共享层抽象
`filterCommands` 抽到 `src/shared/commands.ts`,`CommandItem` 字段 `icon/run`
用 `unknown` 表达(非 React 上下文无关)。渲染层 `CommandPaletteItem extends CommandItem`
补 `icon?: ReactNode` 与 `run?: () => void`,filter 完 cast 回去。目的是让 shared
可被 main/preload/renderer 共用且能在 node 环境的 vitest 中单测,避免 .tsx 在
tsconfig.node 下触发缺 jsx 的 TS 错误。

### ErrorBoundary 已在 index.tsx 包好
`src/renderer/index.tsx` 已用 `<ErrorBoundary>` 包住 `<App />`,`src/renderer/components/ErrorBoundary.tsx`
必须存在(否则启动即崩)。错误态用 `location.reload()` 恢复 — 草稿类按 store 自管。

### 键盘帮助面板
`?` 键(`Shift+/`)全局打开,非 input 焦点时生效。焦点恢复与 CommandPalette 一致
(打开时存 prevFocus,关闭时若焦点仍在内则还原)。所有声明的快捷键必须在该面板里也列出,
避免"声明了但用户发现不了"。

### 焦点恢复 hook (useFocusRestore)
所有模态框(ApprovalDialog / CommandPalette / KeyboardHelp / Settings)
统一走 `src/renderer/lib/useFocusRestore.ts`:
- 打开时把焦点收到 dialog 根(配合外层 `setTimeout` 推到 input)
- 关闭时若焦点仍在 modal 内则还给触发元素
- 模态根加 `tabIndex={-1}` + `style={{ outline: "none" }}` 避免出现蓝框
不要再各自手写焦点保存/恢复代码 — 复用 hook,行为统一。

### 新建会话并发守卫
`App.tsx` 用 `creatingSessionRef = useRef(false)` 包住 `handleNewSession`:
- 菜单(Cmd+N)+ 侧栏"+"按钮并发触发会产生"孤儿会话"
  (后者覆盖前者,但前者已落库)
- finally 必须 reset,避免卡死
- `handleSendMessage` 内有自己 `currentSessionId` 双检,无需重复保护

### 异步操作 mounted 守卫(useMounted)
任何 `await window.dave.xxx` / `fetch` / `setTimeout` 之后的 setState
都应包入 `safeSet(() => setState(...))`,否则组件已卸载仍触发 setState
(React 18 静默吞掉,仍属"不干净"行为)。

`src/renderer/lib/useMounted.ts` 集中抽 hook,目前用于:
- `Settings`:`load` / `switchProvider` / `handleSave` / `pickDirectory` / `handleProbe` / `toggleAutoLaunch`
- `WorkspacePanel`:`refresh`

不要在每个组件里各自写 `mountedRef` + `useEffect cleanup` — 复用 hook,
行为统一,且加新异步路径时一行就接入。

### 流式中止的 partial 保留
- `ChatStreamDone` 加 `aborted?: boolean` 字段(主进程在 `AbortError` catch 路径
  发 `{ aborted: true }`)。
- 渲染端 `onDone` 收到 `aborted` 后,`useStore.getState().streamingContent` 取最新
  partial(避免 effect 依赖 streamingContent 触发每个 chunk 重绑监听器),
  `addMessage({ role: "assistant", content: partial })` 落为最后一条消息。
- 状态栏用 `data.aborted ? "已停止" : "就绪"` 区分语义,用户能看出"是流被停了"
  还是"是自然完成"。

### Tool 循环的 abort 检查
`runToolCalls` / `runAgentLoop` 必须在循环顶部检查 `sessionRuntime.getSignal(sessionId)?.aborted`,
**并抛 `DOMException("aborted", "AbortError")`** — 不要 `continue`,要让外层
`handleChatStream` 的 catch 统一发 `chat-stream-done { aborted: true }`,
渲染端才能把 partial `streamingContent` 落为最后一条 assistant 消息。

### abort 状态不能被 fresh signal 覆盖
- `SessionRuntime.abortSession` **不删 controller**(只 `controller.abort()`);
  否则 `getSignal().aborted` 立刻变 undefined,循环检查失效。
- `beginAbortScope` 看到 `prev.signal.aborted === true` 时**直接返回旧 signal**,
  不创建新 controller。否则新 signal 不带 aborted,循环用 fresh signal 重新启动,
  用户点"停止"无效。
- controller 走两条路清理:`clearAbort`(正常 done / error 路径)或
  下次 `beginAbortScope` 看到非 aborted 的 prev 时被 `prev.abort()` 替换。

### deleteSession 必须清理 sessionRuntime
`AbortController` 与 pending approval 都挂在 `sessionRuntime` 的 `Map` 里,
仅从 electron-store 删消息不够 — 必须先 `sessionRuntime.abortSession(sessionId)`。
否则长生命周期下 Map 无限增长。
回归测试 `tests/unit.test.ts` "deleteSession cleans sessionRuntime" 用
`vi.doMock` 注入带 spy 的 `SessionRuntime` 子类,断言 `deleteSession` 必触发
`abortSession(sessionId)`。

### 首启三屏 + API Key 向导(转化率核心)
- `Welcome.tsx` 三屏:价值主张 → 数据透明 → 30 秒开始
- `ApiKeyWizard.tsx` 四步:Provider → Key + 实时 probe → 工作区(可选)→ 完成
- 触发条件:首启(无 `onboarding_completed` 事件)时自动弹
- 任意屏可 Esc / scrim 跳过,跳过记 `onboarding_skipped`
- 全局键盘:← → 翻页,Enter 确认,Esc 跳过 — 必须用 `e.isComposing || e.keyCode === 229` 排除 IME 合成期
- 焦点走 `useFocusRestore` hook,关闭时还给触发元素

### 本地遥测 + 漏斗
- `src/shared/telemetry.ts` 定义事件类型,`src/main/telemetry-store.ts` 落 electron-store
- 环形缓冲 5000 条(超过滚动丢最旧)
- 漏斗事件:launched → onboarding_completed → onboarding_workspace_chosen → first_message_sent
- `computeFunnel` 是纯函数,node 环境单测
- dedup key = `name+ts+JSON.stringify(props)`,同 ts 不同 props(ret=0/1)算多份
- 渲染端 `track()` fire-and-forget,IPC 失败静默
- 7 日回访窗口(28 天上限),防止一年前的脏数据污染

### 懒加载非关键组件
- `App.tsx` 用 `React.lazy` + `Suspense fallback={null}` 包所有模态 / 设置 / 帮助
- 关键分包:Settings / CommandPalette / KeyboardHelp / WorkspacePanel / Welcome / ApiKeyWizard
- Cold start 只加载主入口 + 必要 hook,首屏 JS 体积下降
- `useFocusRestore` / `useMounted` 必须保持纯函数,不能在 lazy chunk 顶层副作用

### 录屏盲测脚本
- `tests/SELF_CHECK.md` 9 节、100+ 步骤:自动化 / 引导 / 向导 / 主界面 / 性能 / 录屏剧本
- 新增用户可见功能必须追加人工盲测小节
- 第 6 节"录屏盲测脚本"给出 Puppeteer/Playwright 可参考的操作序列

### 性能预算(产品规约)
- `src/shared/telemetry.ts` 暴露 `FIRST_RUN_BUDGET_MS` / `TTFB_BUDGET_MS` / `COLD_WINDOW_BUDGET_MS` 常量
  和 `checkStartupBudget(kind, elapsed): BudgetVerdict` 纯函数(node 环境可单测)
- 主进程 `ready-to-show` 触发时,算 `elapsed = Date.now() - processStartedAt`,
  打 `first_window_shown` 事件,带 `elapsedMs` + `within` 标记
- 渲染端 `App.tsx` mount 第一次 effect 打 `renderer_ready`(可交互)
- 渲染端 `onChunk` 首次调用打 `ttfb_recorded`,用 `performance.now()` 取差值
- 边界:elapsed == budget 视为 within(便于测试可重复断言)

### 命令面板共享层抽象(本轮加固)
- `filterCommands` 不读 `icon` / `run` 字段,只看 `title + hint`
- 因此 `CommandItem.icon?: unknown` / `run?: () => unknown`,渲染层 `CommandPaletteItem extends` 再补 React 类型
- shared / main / preload / 渲染层共用同一份实现 + node 环境可单测

### 全局快捷键 IME 保护(本轮加固)
- `App.tsx` 的 window keydown 监听也必须 `if (e.isComposing || e.keyCode === 229) return` 早返回
- 否则中文输入法候选窗期,Cmd+K / Alt+Arrow / `?` 等全局快捷键会被截胡触发
  (Welcome / ApiKeyWizard 内层 Enter/方向键已被守卫,外层必须对齐)
- 规律:任何 `window.addEventListener("keydown", ...)` 的 effect 都要先看 `e.isComposing` 再决定要不要 preventDefault

### IPC Promise 必带 catch(本轮加固)
- `window.dave.store.get` 等 IPC Promise 必须用 `.then(success, error)` 双参形式兜底
- 避免 IPC 偶发失败时抛 unhandled rejection(React 18 不会崩,但日志噪音 + 主进程遥测会增加)
- 失败静默回退默认(theme 走 light / cwd 走 "" / mode 走 "ask")