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

**Electron 3-process model**: `src/main/` (Node), `src/preload/` (contextBridge), `src/renderer/` (React 19 + Tailwind 4 + Zustand 5). `src/shared/` is imported by all three layers — pure functions and types only.

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

### secure-storage async API 字段名(2026-07-31 修复)

Electron 42 的 `safeStorage.decryptStringAsync` 返回 `{ shouldReEncrypt, result }` — 字段名是 **`result`**,不是 `plainText`(electron.d.ts 确认)。取错字段会静默返回 undefined → `secure-storage: decrypt failed for <key>` → 渲染端守卫误判"未配置 API Key"。另:encrypt/decrypt 必须走**同一** API 路径(async 或 sync),初始化时一次性决定 `useAsyncApi`,不能运行时探测混用(async 密文与 sync 解密格式不兼容)。详见 `src/main/secure-storage.ts` 注释。

### MCP 集成(2026-07-31,复用官方 SDK)

- 复用 `@modelcontextprotocol/sdk`(MIT/活跃),stdio 连接外部工具服务器,工具以
  `mcp__<server>__<tool>` 全名并入 agent 循环(`runToolCalls` 的 MCP 分支),**一律审批**
  (视为 mutates,任何模式都需批准)。
- SDK `CallToolResult.content` 的 TS 推断为 `{}`,读取时必须显式标注
  `as Array<{ type?: string; text?: string }>` 再 filter/map,否则 tsc 报 TS2339。
- 配置存 store key `mcp-servers`(JSON 数组,白名单已加);写操作走 `mcp-servers-set` IPC
  (parseMcpServers 校验+去重),渲染端不直接 store.set。
- Settings「扩展」tab 管理服务器;新增 IPC/preload 通道必须同步在 `KeyboardHelp` 与
  SELF_CHECK 的盲测小节登记(若为快捷键/用户可见功能)。

### Skills(用户自定义预置技能,0.3.0 M1 第一步)

- 存 store key `skills`(JSON 数组,白名单已加);写操作走 `skills-set` IPC(`parseSkills` 校验+去重),渲染端不直接 store.set;名称限字母数字-_ ≤48、内容 ≤2000 字符(见 `src/shared/skills.ts`)。
- 与 EmptyStateTemplates(内置模板)的区别:skills 是用户自定义的;0.3.0 完整版将注册到 agent 工具循环(`skill__<name>` 命名空间,与 MCP 同款审批)。

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

- 显式标注 `Pluggable` / `PluggableList` 解决,运行期工作正常。

### shell-policy 正则回溯

解释器 -c 变体匹配必须用 `-[a-zA-Z0-9]*-?c\b`(让 `*` 参与回溯)。**不要**用
`(?:[a-zA-Z0-9]*-)?c\b` — 整个可选组跳过时位置无法回退到 `c`,`sh -lc` 之类
组合 flag 会全部漏匹配。详见 `src/shared/shell-policy.ts` 注释。

### ChatView scroll 行为

仅在 `atBottom` 时才自动跟随 streaming,否则等用户主动点浮起的 scroll-bottom 按钮。
否则长会话生成时用户阅读上半段,会被强制拖回底部。

### 全局快捷键

- `Cmd/Ctrl+K` 命令面板 toggle(总是拦截,即使在 input 中)
- `Alt+Up/Down` 切换会话(只在非 input 焦点时生效,侧栏可见才生效)
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

### IPC store key 白名单 + title 长度校验(本轮加固)

- `src/shared/store-policy.ts` 是 IPC 边界输入校验的纯函数模块,与 `shell-policy.ts` 对称
- `ipc.ts` 的 `store-get/set/delete` 三处统一走 `isAllowedStoreKey(key)` 白名单:
  - 白名单 13 个已知配置 key + `${openai|anthropic|deepseek|custom}-api-key` 正则模式
  - 拒绝 `__proto__` / `constructor` / `prototype` / 路径穿越风格 key
  - 非字符串 / 空 / 超长(>64) 一律拒绝
- `store-set` 额外校验 value 长度 ≤ `STORE_VALUE_MAX`(16K),防止撑爆 store 文件
- `session-update-title` 委托 `sanitizeSessionTitle(title)`:
  - 非字符串 / trim 后为空 → 返回 null(调用方短路)
  - 超长截断到 `SESSION_TITLE_MAX`(80),正常 trim 后返回
- 规律:任何 IPC handler 的入参都应先过纯函数校验,校验逻辑放 shared 层,
  让 main 层只做 adapter,node 环境可直接单测,无需 mock electron

### 渲染性能:React.memo + useMemo(本轮加固)

- `MessageList.tsx` 的 `MessageBubble` 必须用 `memo()` 包裹:
  - streaming 时只有最末条 MessageBubble(带 isStreaming)的 props 变化
  - 其他历史消息的 message/lastUserContent 引用稳定,跳过重渲染
  - 否则长会话每帧都重跑 ReactMarkdown 解析,卡顿明显
- `App.tsx` 的 `tokenCount` 必须用 `useMemo([messages, streamingContent])`:
  - App 重渲染频率高(主题/模式/状态栏/侧栏开关都会触发)
  - messages 引用稳定时跳过 reduce 重算,避免每次都遍历所有消息
- 规律:任何"全量遍历消息列表"的派生值都要 useMemo,deps 用引用稳定的数组

### a11y:role=alert / role=status / aria-live(本轮加固)

- `ChatView.tsx` 错误条必须 `role="alert"` + `aria-live="assertive"`:
  - 屏幕阅读器需主动播报错误出现,assertive 会打断当前播报
- `ChatView.tsx` 生成中 spinner 必须包 `role="status"` + `aria-live="polite"` + `aria-label`:
  - polite 不会打断,等当前播报结束再通知
  - 内部 `<span className="spinner">` 加 `aria-hidden="true"`,避免与外层 aria-label 重复播报
- 规律:任何"瞬态状态条"(错误/警告/生成中/成功)都要明确 aria 角色,
  纯视觉的装饰元素(图标/spinner)要 aria-hidden

### 滚到底动态阈值(本轮加固)

- `ChatView.tsx` 的 atBottom 判定阈值改为 `Math.max(24, Math.floor(el.clientHeight * 0.05))`:
  - 固定 24px 在小窗口合理,大窗口(2k+ px)因 rounding 误判非底部
  - 5% 视口高度让大窗口容差等比放大,避免最后一屏永远显示"滚到底"按钮
- 规律:任何"贴边判定"都要考虑视口尺寸,固定像素阈值只适合小尺寸元素

### 色彩系统统一规范(本轮加固)

- `src/renderer/styles/globals.css` 是色彩系统 single source of truth
- 顶部注释段定义完整色彩规范:HEX/RGB/HSL 三格式 + 适用场景 + 使用限制
- 变量分层(共 7 层,39 个变量):
  - 表面层(6):bg / bg-panel / bg-sunk / bg-active / bg-title / surface-input
  - 边框层(3):border / border-strong / border-inverse
  - 文本层(7):text / text-strong / text-dim / text-faint / text-on-inverse / text-on-inverse-dim / text-on-accent
  - 主色(3):accent / accent-hover / accent-soft
  - 语义色(6):success / success-bg / danger / danger-bg / warning / warning-bg
  - diff 别名(4):diff-add / diff-add-bg / diff-del / diff-del-bg — 与 success/danger 同源
  - 代码高亮(8):syntax-fn / str / kw / comment / num / built-in / variable / name
  - 工具图标(1):tool-shell(shell 工具琥珀色,特殊语义不扩展)
  - 滚动条(2):scrollbar-thumb / scrollbar-thumb-hover
  - 阴影/遮罩/圆角(5):shadow-sm/md/lg + scrim / scrim-strong + radius / radius-sm
- night 模式只覆盖变量,禁止写 `html.night .xxx {}` 选择器分支
- 禁止在组件 className 中硬编码 `text-[#xxx]` / `bg-[#xxx]` / `rgba()` — 必须走 `var(--xxx)`
- 语义约束:
  - 用 --accent 表达错误/成功/警告 → 禁止,必须用对应语义色
  - 用 --text-faint 表达"次要文本" → 禁止,应按层级用 --text-dim
  - --text-on-inverse / --text-on-accent 仅用于反色/accent 背景
  - --tool-shell 仅用于 shell 工具图标,不扩展为通用语义
- diff-del 手动 rgba 展开改为 `color-mix(in srgb, var(--danger) 30%, transparent)`,
  避免 diff-del 改色时手动同步 rgba 值(color-mix 浏览器支持:Electron 42+ 已稳定)

### 色彩调试面板 PalettePanel(本轮新增)

- `Settings.tsx` 新增「色彩」tab + `PalettePanel` 组件,可视化展示 39 个色彩变量
- 设计目标:设计/开发对照用,不需翻 globals.css 即可看到每个变量实际渲染色
- 实现要点:
  - 顶部 light/night toggle 仅在面板根 div 加/移除 `.night` class,**不修改实际主题**
    (避免调试过程中切换主题污染用户实际使用)
  - 7 组(表面/边框/文本/主色/语义/代码高亮/工具图标+滚动条)与 globals.css 顶部注释段一一对应
  - 每个色块点击复制 `var(--xxx)` 到剪贴板,方便开发时贴到 className
  - `navigator.clipboard.writeText` 在 file:// 下可能受限,失败静默(不弹错)
  - 色块本身用 `style={{ background: var(--xxx) }}` 内联,不走 Tailwind 任意值类
    (Tailwind 不会扫描动态字符串,内联 style 是最直接的方式)
- 规律:
  - 任何"可视化调试面板"都不应污染实际状态,用局部 state + 包裹根节点 class 切换预览
  - 调试面板的分组要与规范源文件一一对应,避免"两份真相"漂移
  - 涉及剪贴板/CFS 等可能受限的 API 必须静默 fallback,不打扰用户
