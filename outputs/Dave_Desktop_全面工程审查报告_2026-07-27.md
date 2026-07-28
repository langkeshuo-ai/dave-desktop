# Dave Desktop 全面工程审查报告

- 审查日期：2026-07-27
- 审查范围：`C:\Users\C\dave客户端开发`
- 审查方法：源码静态审查、配置与文档一致性核验、质量门禁、依赖审计、风险建模
- 审查维度：代码质量、架构设计、性能、安全、可维护性、文档、用户体验
- 说明：本轮仅审查并生成报告，未修改业务源码、依赖或现有项目文档。

## 一、执行摘要

项目具备较好的工程基础：Electron 三进程边界明确，TypeScript 严格模式、双 tsconfig、ESLint、Vitest、生产构建均能稳定通过；文件工具具备 realpath 路径守卫；Markdown 使用 sanitize；流式中止、审批和会话运行时有专门抽象；长会话已采用虚拟滚动和懒加载。

但当前尚不适合把 `full-auto` 描述为“工作区内安全自动执行”。最高风险不是普通代码风格，而是安全承诺与真实能力边界不一致：shell 仅设置 `cwd`，没有 OS 沙箱，仍可访问工作区外绝对路径；custom Provider 可让主进程访问任意地址；API Key 在安全存储不可用时会明文降级。另有中止消息持久化竞态、patch 非事务性、IPC 输入契约不足、GUI/E2E/覆盖率缺失、文档大面积漂移等问题。

### 总体评级

| 维度     | 评级 | 结论                                                                      |
| -------- | ---: | ------------------------------------------------------------------------- |
| 代码质量 |    B | 静态门禁通过，但异步错误处理、格式一致性和局部重复仍需收口                |
| 架构设计 |    B | 三进程和 shared 分层合理；App 根组件、IPC 契约和执行能力边界仍偏粗        |
| 性能     |   B- | 虚拟滚动和分包已落地；主包、Markdown chunk、遥测写放大和真实 FPS 尚未闭环 |
| 安全     |    C | 基础防护存在，但 shell、SSRF、sandbox、密钥降级属于发布前必须处理的问题   |
| 可维护性 |   B- | 纯函数测试较好；无覆盖率、GUI E2E、真实 IPC/Provider 集成测试             |
| 文档     |    C | 多份文档与代码、版本、测试数和安全实现不一致                              |
| 用户体验 |   B- | 中文优先、键盘与焦点基础较好；失败恢复、取消语义、可访问性仍有缺口        |

## 二、自动化验证结果

| 检查项           | 结果     | 证据/结论                                                                                                                                                                                                                         |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify` | 通过     | lint、双 tsconfig typecheck、129/129 Vitest、生产 build 全部通过                                                                                                                                                                  |
| 独立 ESLint      | 通过     | 无 error/warning 输出                                                                                                                                                                                                             |
| 生产依赖审计     | 通过     | `npm audit --omit=dev --json`：0 漏洞                                                                                                                                                                                             |
| 全依赖审计       | 失败     | 19 high、1 moderate，集中在 ESLint/electron-builder 及其传递构建链；不能按 npm 建议盲目降级 electron-builder                                                                                                                      |
| Prettier 检查    | 失败     | 10 个文件不符合格式：`OPEN_SOURCE_SEARCH.md`、`package.json`、`PERFORMANCE_REPORT.md`、`RESIDUAL_RISKS.md`、`src/main/ipc.ts`、`ChatView.tsx`、`MarkdownContent.tsx`、`fps-stats.ts`、`tests/SELF_CHECK.md`、`tests/unit.test.ts` |
| 覆盖率           | 无法生成 | 缺少 `@vitest/coverage-v8`，`npm run test -- --coverage` 失败                                                                                                                                                                     |
| 构建体积         | 需优化   | renderer 主 chunk 约 726.51 kB，Markdown chunk 约 738.02 kB；main 约 78.63 kB，preload 约 4.38 kB                                                                                                                                 |
| 真机 GUI/FPS     | 未验证   | 当前只有人工盲测说明和 dev 压测入口，没有可复核的 Electron GUI/E2E 实测结果                                                                                                                                                       |

> 全依赖审计的高危项属于开发/打包链，并不等同于已打包应用存在 19 个可远程利用漏洞；但构建机处理不可信文件或依赖供应链被攻击时仍有风险，应升级验证、锁定版本并持续审计。

## 三、详细问题清单

### P0：必须先处理

#### SEC-001：shell 的 `cwd` 被误当作工作区沙箱

- 维度：安全、架构
- 严重程度：严重（P0）
- 位置：`src/main/agent.ts:161-177`，`src/shared/shell-policy.ts`
- 证据：`execa(cmd, { cwd, shell: true })` 只改变工作目录，不限制绝对路径、父进程权限、网络、注册表或其他用户目录访问。
- 触发条件：Agent 获得 shell 执行机会，尤其处于 `full-auto` 或用户误判审批风险时。
- 影响：命令可读取/修改工作区外文件、执行解释器脚本、联网下载、调用系统程序；安全边界与产品文案不一致。
- 修复方案：
  1. 在完成真实隔离前，将 shell 在 `auto/full-auto` 中一律设为需审批。
  2. Windows 优先使用低权限独立 worker、Job Object、受限 token/AppContainer 或容器；禁网和文件系统 allowlist 分开配置。
  3. 不把正则黑名单作为主边界；改为 argv 化命令执行、命令 allowlist、参数 schema 和能力令牌。
  4. 审批框明确提示“shell 可访问工作区外资源”，展示解析后的 executable、args、cwd、网络/提权风险。
- 验证：自动测试绝对路径、`..`、PowerShell/Python/Node 解释器、重定向、环境变量展开、UNC 路径和网络命令，确认越界均被 OS 层阻止。

#### SEC-002：custom Provider 可造成主进程 SSRF 与明文传输

- 维度：安全
- 严重程度：严重（P0）
- 位置：`src/main/providers.ts:20, 195-249`，`src/renderer/components/Settings.tsx`
- 证据：custom host 直接拼接 `/models` 或 `/chat/completions` 后由主进程 `fetch`，未限制协议、localhost、内网、link-local、重定向目标。
- 触发条件：恶意或误配置 custom host，或 renderer 被 XSS/供应链代码控制。
- 影响：探测本机/内网服务、访问云元数据地址、向 HTTP 服务明文发送 API Key 和对话内容。
- 修复方案：仅允许 `https:`；默认拒绝 localhost、环回、RFC1918、link-local、IPv6 本地地址和非 HTTP(S) 协议；每次重定向重新校验；若确需本地模型，使用显式“允许本地地址”开关和高风险确认，不携带云端 API Key。
- 验证：覆盖 `127.0.0.1`、`localhost`、`169.254.169.254`、私网 IPv4/IPv6、DNS rebinding、302 跳转到私网、HTTP 明文等用例。

### P1：发布前修复

#### SEC-003：API Key 安全存储失败时静默明文降级

- 严重程度：高（P1）
- 位置：`src/main/store.ts:84-96, 108-120`，`src/main/secure-storage.ts`，`Settings.tsx:365-368`
- 触发条件：safeStorage 不可用、Linux 后端不安全、密文损坏或迁移失败。
- 影响：Key 可能以明文落盘；解密失败时密文还会被当作 Key 发送，造成难诊断认证错误；UI“仅本地加密存储”承诺不真实。
- 修复：使用带版本的 envelope（如 `v2:safeStorage:<hex>`）；安全存储不可用时拒绝持久化并允许仅内存使用；迁移旧明文需显式识别和一次性转换；解密失败应报错，不返回密文。

#### SEC-004：Electron renderer 沙箱关闭

- 严重程度：高（P1）
- 位置：`src/main/index.ts:253-258`
- 证据：`sandbox: false`，虽有 `contextIsolation: true`、`nodeIntegration: false`。
- 影响：renderer 漏洞或第三方内容执行后的纵深防御减弱。
- 修复：评估并启用 `sandbox: true`；将 preload 保持最小化；验证所有 contextBridge API 和打包 CJS 兼容性；增加 Electron fuses 与 ASAR integrity 策略。

#### SEC-005：shell hard-deny 正则可被解释器和间接执行绕过

- 严重程度：高（P1）
- 位置：`src/shared/shell-policy.ts`，`src/main/agent.ts:164-171`
- 触发：`node -e`、Python、PowerShell 非编码变体、重定向、变量展开、别名、间接脚本等。
- 影响：被禁止语义可用不同语法实现。
- 修复：黑名单仅作补充；以 allowlist + argv 解析 + OS 隔离为主；在缺少隔离时所有 shell 都必须人工批准。

#### REL-001：中止后的 partial 消息存在丢失竞态

- 严重程度：高（P1）
- 位置：`src/renderer/App.tsx:335-345`，`src/main/chat-loop.ts`
- 证据：renderer 先 `addMessage(partial)`，随后立即 `loadSession()`；主进程 abort 路径未持久化 partial，重载可能覆盖刚添加的消息。
- 影响：用户点击停止后看到的内容闪现后消失，破坏会话可信度。
- 修复：统一由主进程持久化 partial 后再发 done；或为 renderer 本地消息增加持久化确认和合并策略，禁止立即用旧快照覆盖。
- 验证：在不同 chunk 时机连续中止，重启应用后 partial 仍存在且只出现一次。

#### REL-002：发起 chat invoke 失败时可能永久停留在 streaming 状态

- 严重程度：高（P1）
- 位置：`src/renderer/App.tsx:425-490`
- 证据：`void window.dave.chat.stream(content, sid)` 无 `.catch()`。
- 触发：IPC handler 抛错、窗口销毁、参数拒绝、主进程异常。
- 影响：输入已清空、界面持续“正在生成”，只能重启或额外操作恢复。
- 修复：await/catch invoke；失败时原子回滚 `isStreaming/status/ttfb`，保留或恢复用户输入，并给出可重试错误。

#### REL-003：多文件 patch 非事务性且无回滚

- 严重程度：高（P1）
- 位置：`src/main/agent.ts:130-145`，`src/shared/patch.ts`
- 触发：前几个文件写入成功，后续 hunk 失败、权限失败、磁盘满或应用中断。
- 影响：工作区处于半应用状态，可能导致构建失败或数据损坏。
- 修复：先读取并在内存中计算全部结果；写入临时文件；全部校验成功后原子替换；失败回滚；返回逐文件状态和备份位置。

#### SEC-006：IPC sender 校验强度不足且开发模式完全放行

- 严重程度：高（P1）
- 位置：`src/main/ipc.ts` 的 `validateSender()`
- 证据：生产仅确认 sender 属于任一 BrowserWindow，未绑定唯一可信主窗口及其 URL/origin；开发模式直接 `true`。
- 影响：未来新增窗口、插件或被导航窗口可能调用高权限 IPC；开发环境更难暴露安全问题。
- 修复：绑定受信 webContents ID；校验 `senderFrame.url`、top frame 和预期 origin/path；开发模式仅放行明确 dev server origin；敏感 IPC 加 capability/会话校验。

#### SEC-007：CSP 允许脚本 `'unsafe-inline'`

- 严重程度：高（P1）
- 位置：`src/renderer/index.html:8-9`
- 影响：一旦出现 HTML 注入，可利用的脚本执行面扩大；生产 CSP 同时含 dev localhost/ws 来源。
- 修复：区分 dev/prod CSP；生产移除 `script-src 'unsafe-inline'`、localhost/ws；样式如必须 inline，优先 nonce/hash；构建后自动检查最终 HTML。

#### QA-001：无 Electron GUI E2E、真实 IPC 集成和 Provider/SSE 测试

- 严重程度：高（P1）
- 位置：`tests/unit.test.ts`、`vitest.config.ts`、`tests/SELF_CHECK.md`
- 影响：窗口启动、preload 暴露、焦点、键盘、停止/重生成、打包后路径和更新流程只能人工确认；核心竞态不易被单元测试发现。
- 修复：建立 Playwright Electron E2E；增加主/renderer IPC 契约测试；用本地 mock HTTP/SSE server 测试断流、畸形事件、超时和 abort；CI 至少跑 Windows 核心路径。

#### QA-002：无法生成覆盖率，测试质量没有量化门禁

- 严重程度：高（P1）
- 位置：`package.json`、`vitest.config.ts`
- 证据：缺少 `@vitest/coverage-v8`，coverage 命令失败。
- 修复：安装与 Vitest 3.2.6 兼容的 coverage provider；设置 shared/main 核心模块分支阈值；排除纯类型和生成文件；报告 statements/branches/functions/lines。

#### DOC-001：安全与能力文案存在误导

- 严重程度：高（P1）
- 位置：`Welcome.tsx`、`ApiKeyWizard.tsx`、`Settings.tsx`、`CONTRIBUTING.md:268-272`
- 证据：存在“读写搜索跑 shell 全部走统一 diff 审阅”“Key 仅本地加密存储”“仅允许白名单命令”等与实现不符表述。
- 影响：用户基于错误安全假设启用高权限模式；也构成发布合规和信任风险。
- 修复：先降低实际能力，再同步准确文案；分别说明“本地存储”“发送给所选 Provider”“安全存储不可用时行为”“shell 不等于工作区沙箱”。

### P2：近期迭代处理

#### ARC-001：`App.tsx` 职责过重

- 严重程度：中（P2）
- 位置：`src/renderer/App.tsx`（约 795 行）
- 影响：会话、流、遥测、主题、首启、快捷键、布局和模态状态相互耦合，竞态难测试。
- 修复：拆分 `useChatStream`、`useSessionController`、`useOnboarding`、`useGlobalShortcuts`、`useTelemetryLifecycle`；App 仅组合布局。

#### API-001：高权限 IPC 缺统一 runtime schema 和输入上限

- 严重程度：中（P2）
- 位置：`src/main/ipc.ts`、`src/preload/index.ts`
- 范围：chat message/sessionId、provider probe、workspace depth/diff、notification 等。
- 影响：异常对象、超长输入、伪造 sessionId 可造成内存/存储放大、运行时 Map 增长或难诊断异常。
- 修复：使用 Zod/Valibot 或纯函数 schema；统一限制消息、diff、输出、depth、sessionId 格式和 props 大小；错误码结构化。

#### PERF-001：遥测持久化每次事件 O(n) 读写整个数组

- 严重程度：中（P2）
- 位置：`src/main/telemetry-store.ts`
- 影响：最多 5000 条时频繁事件导致 JSON 序列化、磁盘写放大和主进程卡顿。
- 修复：内存 buffer + 定时/批量 flush；按天或固定段分片；空闲时压缩；避免在关键渲染路径同步写整表。

#### PERF-002：文件树串行递归 stat，depth/规模边界不足

- 严重程度：中（P2）
- 位置：`src/main/agent.ts:280+`，`ipc.ts`，`WorkspacePanel.tsx:36`
- 影响：大仓库、网络盘、node_modules、符号链接密集目录会拖慢主进程。
- 修复：IPC clamp depth；限制节点总数/耗时；使用 `Dirent` 信息减少 stat；受控并发；默认忽略大目录；支持取消和分页。

#### PERF-003：renderer 主 chunk 和 Markdown chunk 均较大

- 严重程度：中（P2）
- 位置：`electron.vite.config.ts`、`MarkdownContent.tsx`
- 证据：约 726.51 kB + 738.02 kB。
- 修复：限制 highlight.js 语言集；检查 `out/bundle-stats.html`；按功能拆分重依赖；记录 gzip/brotli 与冷启动时间，而非只看原始体积。

#### UX-001：设置“取消”不能撤销 Provider 切换时的落盘

- 严重程度：中（P2）
- 位置：`Settings.tsx:112-120`
- 证据：`switchProvider()` 在切换 UI 时立即保存当前 key/model。
- 影响：用户认为取消会放弃修改，但部分配置已写入。
- 修复：设置页使用 draft model；只有“保存”提交；取消完全丢弃 draft；敏感字段变更明确显示未保存状态。

#### UX-002：备用 API Key 明文显示

- 严重程度：中（P2）
- 位置：`Settings.tsx:332-340`
- 修复：使用 `type="password"`，增加临时显示按钮，默认不回填完整 Key，只展示掩码和“已配置”。

#### UX-003：自动启动开关忽略主进程返回的最终状态

- 严重程度：中（P2）
- 位置：`Settings.tsx:189+`
- 影响：系统拒绝或状态不一致时 UI 仍显示乐观结果。
- 修复：以返回 boolean 为准；失败显示原因；重新读取实际状态确认。

#### UX-004：消息输入在发送失败时无法自动恢复

- 严重程度：中（P2）
- 位置：`MessageInput.tsx`、`App.tsx`
- 影响：输入会立即清空；前置或 IPC 失败时用户文本丢失。
- 修复：发送接口返回接受/失败结果；成功接受后再清空，或保留 draft 快照并提供“一键恢复”。

#### UX-005：部分菜单/树/按钮的可访问性语义不完整

- 严重程度：中（P2）
- 位置：`ChatView.tsx` 模式菜单、`WorkspacePanel.tsx:152-190`、`MarkdownContent.tsx`
- 问题：模式菜单缺完整 menu/listbox 键盘模型；TreeRow 不统一可聚焦；部分图标按钮缺明确 aria-label；树容器语义不完整。
- 修复：采用 WAI-ARIA 对应模式，增加 roving tabindex、焦点环、Home/End/Escape、可读名称和自动化 axe 检查。

#### REL-004：SSE 解析容错不足

- 严重程度：中（P2）
- 位置：`src/main/chat-loop.ts`
- 影响：只处理 `data: ` 单行；多行 data、尾部 buffer、畸形 JSON 或超大非流响应可能丢数据或消耗内存。
- 修复：使用成熟 SSE parser；处理 CRLF、多行 data、尾部 flush、事件大小上限；限制 `resp.json()` body；对协议错误提供可诊断错误。

#### REL-005：会话 JSON 损坏时静默返回空数据

- 严重程度：中（P2）
- 位置：`src/main/session.ts:10-31`
- 影响：存储损坏会表现为“会话消失”，没有备份、告警或恢复入口。
- 修复：解析失败记录结构化日志并保留损坏原文；维护 `.bak`；提供恢复/导出；写入采用版本 schema 和原子策略。

#### SEC-008：renderer console 全量落盘可能记录敏感内容

- 严重程度：中（P2）
- 位置：`src/main/index.ts:299-305`
- 影响：Provider 错误、提示内容或调试输出可能进入长期日志；日志体积也可能增长。
- 修复：生产仅记录 warn/error；脱敏 API Key/token/Authorization/URL query；限制单条长度与日志轮转；用户导出日志前再清洗。

#### SEC-009：Provider 响应 body 直接进入 UI 错误

- 严重程度：中（P2）
- 位置：`providers.ts`、`chat-loop.ts`
- 影响：泄露内部代理信息、上游调试数据或回显请求内容；超长错误影响 UI。
- 修复：用户错误只显示状态码、请求 ID 和安全摘要；完整 body 脱敏后写受限日志；限制长度。

#### BUILD-001：开发/构建依赖有 20 项审计告警

- 严重程度：中（P2）
- 位置：`package-lock.json` 依赖树
- 证据：19 high + 1 moderate，涉及 `brace-expansion`、`minimatch`、`glob`、`electron-builder`、ESLint 等链路。
- 修复：不要执行 npm 建议的 electron-builder 22 强制降级；先在分支测试当前上游安全版本/overrides，验证打包和签名；CI 将生产依赖设为阻断，全依赖按可利用性和到期日管理。

#### DOC-002：核心文档大面积漂移

- 严重程度：中（P2）
- 位置：`README.md`、`AGENTS.md`、`PERFORMANCE_REPORT.md`、`CONTRIBUTING.md`、`HANDOFF.md`、`CHANGELOG.md`、`ABOUT.md`、`ROLE.md`
- 例子：React 18/19、electron-vite 3/5、Vitest 4/3.2.6、123/129 tests、深色/浅色默认、XOR/safeStorage、懒加载数量、bundle 降幅互相冲突。
- 修复：确立单一事实源；版本和测试数由脚本生成；历史报告与当前规范分离；文档 CI 校验命令、文件路径、依赖版本和链接。

#### DOC-003：`RESIDUAL_RISKS_HERMES.md` 与当前项目无关且含敏感运营上下文

- 严重程度：中（P2）
- 位置：仓库根目录 `RESIDUAL_RISKS_HERMES.md`
- 影响：公开交付污染、项目边界混乱、潜在信息泄露。
- 修复：确认归属后迁移到对应私有项目或受控知识库；若仓库已有发布历史，检查 Git 历史并按敏感级别决定是否清理历史。

#### DOC-004：贡献指南中的工程事实不成立

- 严重程度：中（P2）
- 位置：`CONTRIBUTING.md`
- 例子：写 123 tests；`no-explicit-any` 写 error 而配置为 warn；声称 Husky/typecheck 和 `--no-verify` 规范；路径别名 `#/` 错误；Provider 目录不存在；`vite.config.ts` 文件名错误；主题默认描述错误；shell 被描述成白名单；rehype 文件位置错误。
- 修复：按当前代码重写，不保留历史状态；禁止建议绕过 hooks；将安全要求从“注释”变成自动测试和 CI。

#### QA-003：Prettier 未纳入 `verify`，当前已有 10 个文件不一致

- 严重程度：中（P2）
- 位置：`package.json` 及上述 10 个文件
- 修复：先单独提交纯格式化变更并复核 shell 正则/Markdown 表格；随后将 `format:check` 加入 CI/verify，或使用 lint-staged 保证增量一致性。

### P3：可排期优化

#### CODE-001：固定版本号散落在 UI

- 严重程度：低（P3）
- 位置：`Sidebar.tsx:213-216`、`Settings.tsx:448`
- 修复：统一从 `window.dave.version()` 获取并缓存，避免发布后 UI 漂移。

#### CODE-002：上下文注释与实现语义不一致

- 严重程度：低（P3）
- 位置：`src/shared/context.ts`、`shell-policy.ts`、`secure-storage.ts` 等
- 例子：“永不丢最后 user”实际是保留最后非 system；“agent 循环无上限”实际有 50 次；注释引用不存在 API。
- 修复：删除历史叙述，仅保留当前不变量、原因和测试链接。

#### PERF-004：token 统计存在重复计算

- 严重程度：低（P3）
- 位置：`App.tsx`、`ChatView.tsx`
- 修复：统一 selector/memo 结果，避免长消息重复估算；对 UI 使用粗估，发送前才精确 token 化。

#### UX-006：模式菜单与初始滚动状态仍有细节风险

- 严重程度：低（P3）
- 位置：`ChatView.tsx`
- 问题：滚动阈值实现与文档不一致；`didInitialScroll` 对会话切换的重置依赖生命周期；导出 URL 立即 revoke 兼容性不足。
- 修复：按 sessionId 重置初始滚动；定义并测试阈值；延后一拍 revoke；增加长会话切换回归测试。

#### BUILD-002：构建配置注释仍引用 electron-vite v3

- 严重程度：低（P3）
- 位置：`electron.vite.config.ts:6-10`
- 修复：更新为当前 v5 行为，并增加构建后断言，避免只依赖注释。

## 四、风险矩阵

| 风险                              | 发生概率 | 影响 | 综合等级 | 主要场景                              |
| --------------------------------- | -------: | ---: | -------: | ------------------------------------- |
| shell 越过工作区访问系统资源      |       高 | 严重 |       P0 | full-auto、解释器、绝对路径、联网命令 |
| custom Provider SSRF/密钥明文外发 |     中高 | 严重 |       P0 | 自定义 host、重定向、私网/元数据地址  |
| API Key 明文降级                  |       中 |   高 |       P1 | safeStorage 不可用或迁移失败          |
| renderer 被利用后的纵深不足       |       中 |   高 |       P1 | sandbox=false + CSP unsafe-inline     |
| 中止 partial 丢失/会话不一致      |     中高 |   高 |       P1 | 流式中止后立刻 reload session         |
| patch 半应用损坏工作区            |       中 |   高 |       P1 | 多文件 patch 中途失败                 |
| GUI/IPC 回归未被自动发现          |       高 | 中高 |       P1 | 打包、焦点、停止、preload、SSE        |
| 文档误导用户安全决策              |       高 | 中高 |       P1 | full-auto、密钥、shell 说明           |
| 开发依赖供应链/DoS                |       中 |   中 |       P2 | 构建机处理恶意路径/归档               |
| 大仓库主进程卡顿                  |       中 |   中 |       P2 | 文件树、遥测、token 统计              |

## 五、优先修复路线

### 阶段 A：立即止血（建议 1-2 名资深工程师，2-4 个工作日）

1. shell 全部改为需审批，修正文案，不再宣称 cwd 是沙箱。
2. custom Provider 强制 URL 校验、重定向复核、默认拒绝私网与 HTTP。
3. safeStorage 不可用时禁止持久化 Key，删除静默明文降级。
4. 修复 chat invoke 错误回滚与 abort partial 持久化竞态。
5. 对高权限 IPC 增加最小输入长度/类型/sessionId 校验。

### 阶段 B：发布前加固（建议 2 名工程师 + 1 名 QA，5-8 个工作日）

1. 验证并启用 renderer sandbox，收紧生产 CSP。
2. patch 改为预计算、原子提交和失败回滚。
3. 建立 Electron Playwright 核心 E2E、mock SSE 和真实 IPC 契约测试。
4. 安装 coverage provider，建立 shared/main 核心模块覆盖率门禁。
5. 脱敏 Provider 错误和 renderer 日志。
6. 完成 Windows 安装包 GUI UAT、2000 条滚动 FPS、停止/重生成/焦点恢复验收。

### 阶段 C：工程治理（建议 1-2 名工程师，5-10 个工作日）

1. 拆分 App.tsx，统一异步 mounted/cancellation/error pattern。
2. 优化 telemetry、文件树、token 统计与 Markdown 语言集。
3. 修复 10 个格式文件并把 format check 纳入门禁。
4. 升级/约束开发依赖，保留可复现打包验证。
5. 清理并重写漂移文档，迁移 Hermes 无关风险文件。

### 阶段 D：真正的安全自动执行（单独项目，需安全工程投入）

1. 设计 Windows 受限执行 worker、文件 allowlist、网络策略和资源限额。
2. 对 shell/工具执行建立能力模型，而不是继续扩充正则。
3. 引入对抗性测试：路径、解释器、编码、重定向、环境变量、网络、子进程、符号链接。
4. 通过后才恢复“full-auto 可不审批 shell”的产品能力。

## 六、资源投入建议

| 角色                      |           建议投入 | 主要职责                                         |
| ------------------------- | -----------------: | ------------------------------------------------ |
| 资深 Electron/Node 工程师 |    1 人，8-12 人日 | IPC、sandbox、CSP、shell worker、patch 原子性    |
| React/前端工程师          |     1 人，5-8 人日 | 流状态、设置 draft、错误恢复、可访问性、App 拆分 |
| QA/自动化工程师           |     1 人，5-8 人日 | Electron E2E、SSE mock、打包 UAT、FPS 与焦点回归 |
| 安全工程师                | 0.5-1 人，3-6 人日 | shell threat model、SSRF、密钥、日志与发布审查   |
| 文档/项目维护             |   0.5 人，2-3 人日 | 单一事实源、发布说明、风险台账整理               |

如资源有限，先投入一名资深 Electron/Node 工程师处理 SEC-001、SEC-002、SEC-003、REL-001/002；其余优化不得早于这五项。

## 七、验收标准

### 安全

- 任意 shell 命令无法在未经批准时执行；完成 OS 隔离后，绝对路径和解释器也无法越界。
- custom Provider 默认仅 HTTPS 公网地址；所有重定向均重复校验。
- safeStorage 不可用时磁盘上不存在明文 Key。
- 生产 CSP 不含 `script-src 'unsafe-inline'`，renderer sandbox 已启用或有正式风险豁免。

### 稳定性

- 发送 IPC reject 后 1 秒内恢复可输入状态，原文本可恢复。
- 任意时机中止后 partial 只保存一次，切会话和重启后不丢失。
- 多文件 patch 中任一文件失败时，工作区保持应用前状态。

### 测试

- `npm run verify` 增加 format check 和 coverage 后全绿。
- 核心 shared/main 分支覆盖达到约定阈值（建议 branches ≥80%，关键安全策略 ≥95%）。
- Electron E2E 覆盖首启、配置、发送、停止、重生成、审批、会话切换、设置取消、打包启动。

### 性能与体验

- 目标 Windows 真机冷启动、首问 TTFB 和 2000 条消息滚动均有环境、步骤、原始数据和结论。
- 主进程文件树在大仓库达到节点/时间上限时可取消且 UI 不冻结。
- 键盘与屏幕阅读器检查通过，设置取消不产生持久化副作用。

## 八、结论

Dave Desktop 已达到“工程原型质量较好、基础门禁可靠”的阶段，但距离“可放心发布的本地高权限 Agent”仍有明显差距。优先级必须以真实安全边界为中心，而不是继续打磨主题或追求小幅 bundle 优化。

明确建议：在 SEC-001 与 SEC-002 完成前，不对外宣传 shell 被工作区隔离，也不默认开放无审批 shell；在 SEC-003、REL-001、REL-002 和 QA-001 完成前，不把当前版本标记为高可信稳定版。完成阶段 A+B 后，再进入性能、文档和长期架构治理。
