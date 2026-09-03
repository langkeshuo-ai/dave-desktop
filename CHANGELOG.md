# 更新日志

所有显著变更按 Keep a Changelog 格式记录。本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 端到端性能与安全加固（2026-07-27）

- 完整 Markdown 渲染链迁入 `MarkdownContent` 懒加载边界；主 renderer chunk 从约 1,203.59KB 降至约 726.51KB，Markdown 按需 chunk 约 738.02KB。
- 2000 条虚拟滚动压测工具改为 dev-only 动态加载，生产主包不再包含测试消息生成器和 FPS 监控实现。
- FPS 统计改为总帧数/总时长模型，新增 frame time P50/P95/P99、慢帧分档与卡顿率；抽出 `calculateFpsStats` 并加入单元测试。
- 修复压测消息恢复、快速双击、动态加载期间卸载、切换会话及 RAF 清理竞态。
- 修复无语言 fenced code 的 text 回退，并保留 Markdown sanitize 高亮 class 白名单。
- Vitest 固定为 3.2.6：规避 4.1.10 当前 runner 初始化回归，同时避开 3.2.4 已披露漏洞。
- Electron 主窗口新增跨源导航与 popup 拦截；全部 preload IPC handler 统一 sender 校验，补充 URL、通知及 auto-launch 输入边界。
- 自动化测试增至 129 项；生产依赖审计为 0 漏洞。全依赖开发工具链遗留 19 high + 1 moderate，已记录在风险台账，拒绝危险强制降级修复。

### 性能优化 Phase 1 — Code Splitting 与 Bundle 瘦身（2025-01-26）

#### 新增

- **Code Splitting（组件懒加载）**
  - React.lazy + Suspense 动态加载 6 个非核心组件
  - Settings（27KB）、Welcome（9KB）、ApiKeyWizard（18KB）、WorkspacePanel（7KB）、CommandPalette（7KB）、KeyboardHelp（4KB）
  - **ReactMarkdown 渲染链独立 chunk（266KB）** — 首条 assistant 消息时按需加载
  - **实测：首屏 bundle 从 1,468KB 降至 1,204KB（-264KB / -18%）**
- **虚拟滚动性能测试工具**
  - `src/renderer/lib/fps-monitor.ts`：FPS 实时监控（基于 requestAnimationFrame）
  - `src/renderer/lib/test-utils.ts`：测试消息生成器（支持 2000+ 条混合消息）
  - ChatView 集成性能测试按钮（仅 dev 模式，Gauge 图标）
  - 性能报告输出：FPS 平均值 + P50/P95/P99 帧延迟
- **消息导出功能**
  - 会话导出为 Markdown（含元数据：标题、sessionId、时间戳）
  - ChatView 右上角"导出"按钮（Download 图标）
- **类型定义增强**
  - `src/renderer/env.d.ts`：声明 Vite import.meta.env（DEV/PROD/MODE）
- **Bundle 分析工具**
  - rollup-plugin-visualizer 集成，生成 `out/bundle-stats.html`
  - 可视化展示 gzip/brotli 压缩后大小

#### 变更

- **Markdown 渲染链懒加载策略**
  - ReactMarkdown + remark-gfm + rehype-highlight + rehype-sanitize 拆为独立 chunk
  - Suspense fallback 显示纯文本内容，无白屏
- **Vite 构建配置优化**
  - manualChunks 策略：Markdown 渲染链单独打包
  - 保留 React/Zustand 在主 bundle（避免过度拆分）

#### 修复

- **MessageList.tsx 类型兼容问题**
  - rehypePlugins 参数类型兼容（移除 `as any` 断言，改用元组形式）
- **ESLint 配置警告**
  - electron.vite.config.ts 顶层 await 警告（不影响功能，记录待修复）

---

### 全面规范化与主题改造（2026-07-26）

- **ESLint 未使用变量警告**：移除 `generateTestMessages` 未使用导入，`complexRatio` 改为 `_complexRatio`

---

### 全面规范化与主题改造（2025-01-26）

#### 新增

- **工程规范化工具链**
  - ESLint 9 flat config（@eslint/js + typescript-eslint + react + react-hooks）
  - Prettier 统一格式化配置（.prettierrc + .prettierignore）
  - Husky + lint-staged pre-commit hooks（自动格式化 + 类型检查）
- **测试套件**
  - 123 个单元测试覆盖核心逻辑（shell-policy、store-policy、patch、telemetry）
  - Vitest 配置（Node 环境，5.8s 运行时间）
- **安全增强**
  - `src/shared/store-policy.ts`：统一 store key 白名单 + session title 校验
  - `src/main/secure-storage.ts`：基于 Electron safeStorage 的 OS 级密钥加密
  - IPC sender 校验（validateSender）防止非主窗口渲染进程绕过白名单
  - Linux basic_text 后端检测与拒绝逻辑

#### 变更

- **Cursor 风格主题系统**
  - 深色优先调色板：`--bg: #0f1117`（Cursor 经典深蓝灰）+ `--accent: #5b8cff`（签名蓝）
  - 面板层级：`--bg-panel: #171a23`、`--bg-sunk: #1e222e`、`--bg-active: #252a38`
  - 浅色模式备份：`html.light` 选择器覆盖（白底 + 蓝色重点）
  - 移除旧 `html.night` 主题变量残留
- **API Key 存储迁移**
  - 从自定义 XOR-KDF 方案迁移至 safeStorage（DPAPI/Keychain/libsecret）
  - `getSecure` / `setSecure` 异步 API，支持 key rotation（Electron 新版特性）
- **IPC 安全加固**
  - 所有 store 操作增加白名单校验（isAllowedStoreKey）
  - value 长度限制（STORE_VALUE_MAX: 512KB）
  - session title 过滤（sanitizeSessionTitle，上限 200 字符）

#### 修复

- **TypeScript 类型错误**
  - `secure-storage.ts`：AsyncSafeStorage 类型定义，tryAsync 泛型声明
  - `ipc.ts`：validateSender 返回 boolean 而非 void
  - `MessageList.tsx`：rehypeSanitize 类型兼容（元组 + never 断言）
- **构建警告**
  - 动态导入优化提示（store.ts / secure-storage.ts，不影响功能）

#### 安全

- rehype-sanitize 白名单防御 LLM 输出中的 `<script>` / `<iframe>` 标签
- IPC 通信三层防护：sender 校验 + key 白名单 + value 长度上限
- Session title 注入防护：截断超长标题，过滤非法字符

---

### 色彩调试面板(历史记录)

- `Settings.tsx` 新增「色彩」tab + `PalettePanel` 组件
  - 可视化展示 globals.css 中定义的 39 个色彩变量,7 组分类与规范源一一对应
  - 顶部 light/night toggle 仅在面板根 div 切换 `.night` class,不修改实际主题
  - 每个色块点击复制 `var(--xxx)` 到剪贴板,clipboard 受限时静默
  - 色块用 `style={{ background: var(--xxx) }}` 内联,避开 Tailwind 任意值类扫描
- 同步更新 `AGENTS.md` 新增"色彩调试面板 PalettePanel"工程经验段

### 色彩系统统一化(本轮新增)

- `src/renderer/styles/globals.css` 重构为色彩系统 single source of truth
  - 顶部注释段定义完整色彩规范:HEX/RGB/HSL 三格式 + 适用场景 + 使用限制
  - 变量分层(7 层 39 个变量):表面/边框/文本/主色/语义/diff 别名/代码高亮/工具图标/滚动条/阴影遮罩
  - 新增 `--surface-input` 统一 input/select/composer 表面色(替代 3 处硬编码 + 3 处 night 选择器)
  - 新增 `--text-on-inverse` / `--text-on-inverse-dim` / `--text-on-accent` 反色背景文本层
  - 新增 `--border-inverse` titlebar 深色边框
  - 新增 `--success` / `--danger` / `--warning` 三态语义色(+ 对应 -bg)
  - `--diff-add` / `--diff-del` 改为 `var(--success)` / `var(--danger)` 别名,统一语义源
  - 新增 `--syntax-built-in` / `--syntax-variable` / `--syntax-name` 拆分 hljs 颜色
  - 新增 `--tool-shell` shell 工具图标琥珀色(特殊语义,不扩展)
  - 新增 `--scrollbar-thumb` / `--scrollbar-thumb-hover` 滚动条变量
  - 新增 `--scrim` / `--scrim-strong` 模态/命令面板遮罩
- 移除 27 处硬编码颜色:
  - scrollbar 4 处(#c4cad1/#98a2b3/#424242/#4f4f4f)→ 走变量
  - titlebar 2 处(#e4e4e4/#000)→ `--text-on-inverse` / `--border-inverse`
  - statusbar warn/error 2 处(#b85450 共用)→ `--warning` / `--danger` 语义分离
  - input/select/composer 6 处(#ffffff/#3c3c3c/#2d2d2d)→ `--surface-input`
  - modal/cmdk scrim 2 处 → `--scrim` / `--scrim-strong`
  - hljs 12 处(#953880/#6639ba/#6f42c1 重复 + night 9 处)→ 走 syntax-* 变量
  - 组件内 3 处(App.tsx #9a9a9a ×2 + ApprovalDialog.tsx #9a6a00)→ 走变量
- 移除 4 个 `html.night .xxx {}` 选择器分支(input/textarea/select/composer)
  → night 模式只覆盖变量,不写选择器
- 移除 9 个 `html.night .hljs-*` 选择器分支 → night 模式通过 syntax-* 变量覆盖
- `tool-fail` border / `tool-trace.fail` border 的 `rgba(207,34,46,0.3/0.35)` 手动展开
  → `color-mix(in srgb, var(--danger) 30%/35%, transparent)` 自动派生
- 同步更新 `AGENTS.md` 新增"色彩系统统一规范"工程经验段

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
  1. `SessionRuntime.abortSession` 不再删 controller(只 `controller.abort()`);
  2. `beginAbortScope` 看到 `prev.signal.aborted` 时直接返回已中止 signal,
     避免被 fresh signal 覆盖 abort 状态;
  3. `runAgentLoop` 每轮 while 顶部 / `runToolCalls` 每个工具顶部
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

### 加固(本轮新增 — 系统性审查收尾)

- IPC store-* handler 缺 key 白名单 + value 长度限制
  - 抽出 `src/shared/store-policy.ts` 纯函数(与 `shell-policy.ts` 对称):
    `isAllowedStoreKey` / `sanitizeSessionTitle` / `STORE_VALUE_MAX` / `SESSION_TITLE_MAX`
  - `ipc.ts` store-get/set/delete 三处统一走 `isAllowedStoreKey` 白名单
  - store-set 额外校验 value 长度 ≤ 16K,防止撑爆 electron-store 文件
  - 白名单覆盖 13 个已知配置 key + `${openai|anthropic|deepseek|custom}-api-key` 模式
  - 拒绝 `__proto__` / `constructor` / `prototype` 等原型污染尝试
  - 拒绝路径穿越风格 key(`../../etc/passwd`)
- `session-update-title` handler 无长度校验
  - 委托 `sanitizeSessionTitle`:非字符串 / trim 后为空 → 返回 null 忽略
  - 超长截断到 80 字符(autoTitleSession 用 40 截断自动标题,手动重命名允许稍长)
- `MessageList.tsx` `MessageBubble` 缺 `React.memo`
  - streaming 时所有历史消息重渲染,ReactMarkdown 重复解析(长会话卡顿)
  - 用 `memo()` 包裹,props 引用稳定时跳过重渲染
- `App.tsx` `tokenCount` 缺 `useMemo`
  - 每次 App 重渲染(主题/模式/状态栏变化)都全量 reduce 所有消息 token
  - 改为 `useMemo([messages, streamingContent])`,messages 引用稳定时跳过重算
- `ChatView.tsx` 错误条缺 `role="alert"`
  - 屏幕阅读器无法感知错误出现,补 `role="alert"` + `aria-live="assertive"`
- `ChatView.tsx` 生成中 spinner 缺 a11y
  - 补 `role="status"` + `aria-live="polite"` + `aria-label="生成中"`
  - spinner 元素加 `aria-hidden="true"` 避免重复播报
- `ChatView.tsx` 滚到底阈值固定 24px
  - 小窗口仍合理,大窗口(2k+ px)因 rounding 误判非底部
  - 改为 `Math.max(24, Math.floor(el.clientHeight * 0.05))` 动态阈值

### 测试(本轮新增)

- `tests/unit.test.ts` 累计 112 用例(+8):
  - `store-policy — IPC key whitelist + title sanitization` 全新 describe
  - 覆盖白名单接受 / api-key 模式匹配 / 拒绝未知与可疑 key(**proto** / constructor /
    prototype / 路径穿越 / 伪造 provider 后缀) / 非字符串与超长输入 / 常量边界 /
    sanitizeSessionTitle trim/truncate/empty/null 全场景
- 历史累计覆盖:shell-policy 边界 / needsApproval 矩阵 / extractDelta 边界 /
  SessionRuntime abort+approval 契约 / deleteSession 清理 / 命令面板过滤 /
  漏斗同 ts 不同 props 去重 / patch null guard / patch 多 hunk / truncateMessages /
  启动预算 / eslint 类型 / patch parse view 等

### 安全加固(2026-07-21 系统性审查)

- CSP 强化:补充 `object-src 'none'` / `frame-src 'none'` / `base-uri 'self'`,缩小攻击面
- `store-keys` IPC handler 过滤白名单:只返回白名单内的 key,避免 API key 名称等敏感字段名泄露
- `@tanstack/react-virtual` ^3.14.7 已安装,支持 chat 原生 `anchorTo: 'end'` / `followOnAppend` / `isAtEnd()`,待 MessageList 重构时接入

### 开源研究(2026-07-21)

- `OPEN_SOURCE_SEARCH.md` 新增系统性加固检索章节:
  - zerobox(Apache-2.0, 0 依赖) — Windows 沙箱方案(计划中)
  - better-sqlite3(MIT) — 会话存储方案(当前 electron-store 够用)
  - Electron safeStorage — 替代 XOR KDF 加密(当前 XOR 已够用)
  - @tanstack/react-virtual v3.14.2 — chat 原生支持(已安装)
- 所有决策记录:已实施 / 已安装 / DEFERRED 均有正当理由
