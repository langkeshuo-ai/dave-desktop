# Open-Source Search Evaluation

> 根据开发指南要求，在实施任何自定义开发前，对 GitHub 和 npm 进行了彻底搜索。
> 评估日期: 2026-07-18

## 1. 搜索策略

### 关键词

- `electron react desktop ai chat app` (GitHub)
- `electron desktop agent chat` (GitHub)
- `electron-vite react template` (GitHub)
- `npm electron desktop ai chat react` (npm)
- `electron react shadcn template` (GitHub)

### 筛选标准

- ✅ 活跃维护（最近 6 个月有提交）
- ✅ 适当文档（README、架构说明）
- ✅ 兼容许可证（MIT / Apache 2.0）
- ✅ 技术栈匹配（Electron + React + TypeScript）

---

## 2. 候选方案评估

### 方案 A: pi-app（参考项目）

| 维度   | 评估                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------- |
| 仓库   | https://github.com/justhil/pi-app                                                                         |
| 星数   | 137 ⭐                                                                                                    |
| 技术栈 | Electron 35 + React 18 + TypeScript + Tailwind + shadcn + Zustand                                         |
| 许可证 | 未明确标注                                                                                                |
| 活跃度 | 活跃（36 个 Release，最近更新 2026-07）                                                                   |
| 评估   | **参考项目**，但它是 pi coding agent 的专用桌面壳，与 Dave 生态不直接兼容。可作为架构参考，不能直接复用。 |

### 方案 B: @opencode-ai/desktop（monorepo 已有）

| 维度   | 评估                                                           |
| ------ | -------------------------------------------------------------- |
| 位置   | `/packages/desktop` 在本仓库                                   |
| 技术栈 | Electron 42 + Solid.js + TypeScript + electron-vite            |
| 许可证 | MIT                                                            |
| 活跃度 | 活跃维护，与主线同步                                           |
| 评估   | **最接近的现有方案**，但存在以下问题：                         |
|        | 1. 使用 **Solid.js** 而非 React（pi-app 参考项目使用 React）   |
|        | 2. 深度绑定 OpenCode Server sidecar 架构                       |
|        | 3. 面向 OpenCode 产品，非 Dave 品牌                            |
|        | 4. 渲染层依赖 `@opencode-ai/app` 和 `@opencode-ai/ui` 工作区包 |
|        | 5. 仅支持 macOS 原生菜单栏，Windows 托盘未完全实现             |
|        | **结论**: 架构可参考，但不能直接复用作为 Dave 桌面应用。       |

### 方案 C: InferencerC

| 维度   | 评估                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------- |
| 仓库   | https://github.com/GenieWeenie/InferencerC                                                            |
| 星数   | ~0（新项目）                                                                                          |
| 技术栈 | Electron 40 + React 19 + TypeScript + Vite 7 + Tailwind                                               |
| 许可证 | ISC                                                                                                   |
| 活跃度 | 活跃（840 测试通过，96 测试套件）                                                                     |
| 评估   | 功能完整（MCP、多模型、代码预览），但架构复杂（38+ 功能），过度设计。学习成本高，与 Dave 集成难度大。 |

### 方案 D: Pointer

| 维度   | 评估                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| 仓库   | https://github.com/experdot/pointer                                                                          |
| 星数   | 91 ⭐                                                                                                        |
| 技术栈 | Electron + React 19 + TypeScript + Ant Design + Vite                                                         |
| 许可证 | MIT                                                                                                          |
| 活跃度 | 活跃（最近更新 2026）                                                                                        |
| 评估   | 功能丰富（多模型、消息树、数据分析），但使用 Ant Design（非 Tailwind），与 pi-app 参考项目的 UI 风格差异大。 |

### 方案 E: AIME Chat

| 维度   | 评估                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------- |
| 仓库   | https://github.com/DarkNoah/aime-chat                                                                                     |
| 星数   | 35 ⭐                                                                                                                     |
| 技术栈 | Electron + React 19 + TypeScript + shadcn/ui + Tailwind + Mastra                                                          |
| 许可证 | MIT                                                                                                                       |
| 活跃度 | 活跃                                                                                                                      |
| 评估   | 技术栈与 pi-app 最接近（shadcn/ui + Tailwind + React 19）。依赖 Mastra AI 框架，与 Dave 现有后端（Vercel AI SDK）不兼容。 |

### 方案 F: Bernard

| 维度   | 评估                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------- |
| 仓库   | https://github.com/cpraun/bernard                                                                     |
| 星数   | 1 ⭐                                                                                                  |
| 技术栈 | Electron + React + TypeScript                                                                         |
| 许可证 | Apache 2.0                                                                                            |
| 活跃度 | 新项目（2026-03）                                                                                     |
| 评估   | 架构清晰（main/preload/renderer/shared），支持 MCP 和 RAG。但仅支持 macOS，Windows/Linux 支持未完成。 |

### 方案 G: CortexOne

| 维度   | 评估                                                                  |
| ------ | --------------------------------------------------------------------- |
| 仓库   | https://github.com/Itachi-1824/CortexOne                              |
| 星数   | 2 ⭐                                                                  |
| 技术栈 | Electron 38 + React 19 + TypeScript + Vite 6                          |
| 许可证 | MIT                                                                   |
| 活跃度 | 活跃（最近更新 2026）                                                 |
| 评估   | 功能完整（15+ 提供商、MCP、记忆系统）。但无系统托盘，窗口管理较简单。 |

### 方案 H: electron-vite-react（官方模板）

| 维度   | 评估                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------- |
| 仓库   | https://github.com/electron-vite/electron-vite-react                                           |
| 星数   | 2397 ⭐                                                                                        |
| 技术栈 | Electron + Vite + React + Sass                                                                 |
| 许可证 | MIT                                                                                            |
| 活跃度 | 非常活跃（官方维护）                                                                           |
| 评估   | **最成熟的基础模板**。但无 AI 功能，无系统托盘，无会话管理，纯空壳。需要从头构建所有业务逻辑。 |

### 方案 I: Electron React App (ERA)

| 维度   | 评估                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------- |
| 仓库   | https://github.com/guasam/electron-react-app                                                                           |
| 星数   | 774 ⭐                                                                                                                 |
| 技术栈 | Electron 40 + React 19 + TypeScript + Tailwind + shadcn/ui                                                             |
| 许可证 | MIT                                                                                                                    |
| 活跃度 | 非常活跃（40 个 Release，最近更新 2026-05）                                                                            |
| 评估   | **最成熟的功能模板**。内置 shadcn/ui、Conveyor（类型安全 IPC）、主题切换、自定义标题栏。但无 AI 对话功能，无会话管理。 |

---

## 3. 最终决策

| 候选方案             | 复用评分   | 结论                                                        |
| -------------------- | ---------- | ----------------------------------------------------------- |
| pi-app               | ⭐⭐⭐⭐   | **参考架构**，不能直接复用（生态绑定）                      |
| @opencode-ai/desktop | ⭐⭐⭐     | **参考架构**，Solid.js 不兼容 React，且绑定 OpenCode Server |
| InferencerC          | ⭐⭐       | 过度复杂，集成成本高                                        |
| Pointer              | ⭐⭐       | Ant Design 与目标 UI 风格不匹配                             |
| AIME Chat            | ⭐⭐⭐     | 技术栈匹配，但依赖 Mastra 框架                              |
| Bernard              | ⭐         | 仅 macOS，不满足 Windows 需求                               |
| CortexOne            | ⭐⭐       | 无系统托盘，窗口管理弱                                      |
| electron-vite-react  | ⭐⭐⭐⭐⭐ | **最佳基础模板**，官方维护，2397 ⭐                         |
| ERA                  | ⭐⭐⭐⭐⭐ | **最佳功能模板**，774 ⭐，shadcn/ui + Tailwind              |

### 最终决策：自定义构建，参考最佳实践

**原因:**

1. **无现成的 Dave 专用桌面应用** — 所有候选方案都是通用 AI 聊天应用，不包含 Dave 的 Goal/Memory/Calendar 等特有功能
2. **技术栈不匹配** — 最接近的 `@opencode-ai/desktop` 使用 Solid.js，不能与 pi-app 的 React 参考对齐
3. **过度设计风险** — InferencerC 等方案包含大量不需要的功能（38+ 功能），删除成本高
4. **许可证兼容性** — 部分方案许可证不明确或非标准（ISC）

**复用策略:**

- **架构参考**: pi-app（Electron + React + Tailwind + shadcn/ui 风格）
- **模板参考**: ERA（类型安全 IPC、主题切换、自定义标题栏）
- **构建工具**: electron-vite + electron-builder（行业标准）
- **状态管理**: Zustand（pi-app 使用）
- **UI 风格**: 深色主题 + Tailwind CSS（pi-app 风格）

**不从头造轮子的部分:**

- 使用 Electron 生态成熟方案（electron-store、electron-updater、electron-window-state）
- 使用 React 生态成熟方案（react-markdown、zustand、lucide-react）
- 使用 Vercel AI SDK 兼容的 API 调用模式（与 monorepo 现有依赖一致）
- 构建工具使用 electron-vite（官方模板，2397 ⭐）

---

## 4. npm 包搜索摘要

| 包名                  | 周下载量     | 用途                    | 选用                         |
| --------------------- | ------------ | ----------------------- | ---------------------------- |
| electron              | ~500k        | 桌面框架                | ✅ 已用                      |
| electron-vite         | ~50k         | 构建工具                | ✅ 已用                      |
| electron-builder      | ~200k        | 打包                    | ✅ 已用                      |
| electron-store        | ~100k        | 加密存储                | ✅ 已用                      |
| react                 | ~40M         | UI 框架                 | ✅ 已用                      |
| zustand               | ~5M          | 状态管理                | ✅ 已用                      |
| react-markdown        | ~10M         | Markdown 渲染           | ✅ 已用                      |
| lucide-react          | ~3M          | 图标库                  | ✅ 已用                      |
| tailwindcss           | ~20M         | CSS 框架                | ✅ 已用                      |
| tailwind-merge        | ~5M          | CSS 合并                | ✅ 已用                      |
| clsx                  | ~30M         | 类名工具                | ✅ 已用                      |
| ulid                  | ~1M          | ID 生成                 | ✅ 已用                      |
| zod                   | ~20M         | 验证                    | ✅ 已用                      |
| electron-updater      | ~100k        | 自动更新                | ✅ 已依赖（未接通 Releases） |
| electron-window-state | ~50k         | 窗口状态持久化          | ✅ 已用                      |
| diff                  | 活跃 2026-04 | unified-diff 解析/应用  | ✅ 2026-07-19 接入           |
| execa                 | 活跃 2026-07 | 异步进程执行            | ✅ 2026-07-19 接入           |
| js-tiktoken           | 维护中       | token 估算 / 上下文截断 | ✅ 2026-07-19 接入           |
| vitest                | 活跃         | 单测                    | ✅ 2026-07-19 接入           |

---

## 5. 2026-07-19 补强检索（P0 修复）

针对审查发现的 patch/shell/token 问题再次按「先搜后造」决策：

| 问题                  | 候选                             | 决策                                                    |
| --------------------- | -------------------------------- | ------------------------------------------------------- |
| multi-hunk patch 写坏 | 自写 splice vs `diff` applyPatch | **复用 diff**                                           |
| execSync 堵主进程     | 自写 spawn vs `execa`            | **复用 execa**                                          |
| 上下文爆炸            | 字符估算 vs `js-tiktoken`        | **复用 js-tiktoken**                                    |
| Anthropic tool 协议   | 全量 SDK vs 薄适配层             | **自建 providers.ts**（与 OpenAI 形统一存储，避免双栈） |

---

## 续 · 2026-07-20 能力检索

| 需求             | 检索                           | 决策                                |
| ---------------- | ------------------------------ | ----------------------------------- |
| API 连通探测     | 官方 REST；无必要 SDK 仅为探测 | **自研** fetch                      |
| Diff 应用 UI     | 已有 `diff` + PatchView        | **复用**                            |
| 高危 shell       | 完整沙箱过重                   | **自研** policy elevated            |
| Token UI         | tiktoken 进 renderer 体积爆炸  | **自研** rough；主进程保留 tiktoken |
| 导出会话 / @path | 无必要新包                     | **自研**                            |
| 自动更新         | electron-updater 已依赖        | **DEFERRED 接线**（签名+Releases）  |
| 虚拟列表         | @tanstack/react-virtual MIT    | **DEFERRED** 到消息量大             |

## 续 · 2026-07-21 系统性加固检索

| 需求                                        | 检索                                                                           | 决策                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| 聊天虚拟列表(anchorTo:end + followOnAppend) | @tanstack/react-virtual v3.14.2 新增 chat 原生支持(MIT, 活跃, 有 e2e 测试)     | **已安装** ^3.14.7, 待 MessageList 重构时接入    |
| OS 级 shell 沙箱(Windows)                   | zerobox(Apache-2.0, 0 依赖, Windows 计划中) / secure-exec(Apache-2.0, V8 隔离) | **DEFERRED** Windows 支持未完成, 继续自研 policy |
| 会话/消息 SQLite 存储                       | better-sqlite3(MIT, WAL 模式, 事务, 需 @electron/rebuild)                      | **DEFERRED** 当前 electron-store 够用            |
| 自动更新接线                                | electron-updater@6.0.0 已依赖, 需 GitHub Releases + 签名                       | **DEFERRED** 签名证书未采购                      |
| 安全: CSP 强化                              | 补充 object-src 'none', frame-src 'none', base-uri 'self'                      | **已实施**                                       |
| 安全: IPC store-keys 泄露                   | 仅返回白名单内 key, 避免 API key 名泄露                                        | **已实施**                                       |
| 安全: 加密存储                              | Electron safeStorage (DPAPI/Keychain) 替代 XOR KDF                             | **已实施**，API Key 走 OS 级安全存储             |
| 安全: IPC sender 校验                       | Electron 原生 `event.sender` + BrowserWindow 校验，无需引入额外依赖            | **已实施**，所有 preload handler 统一校验        |

## 续 · 2026-07-27 性能、E2E 与安全治理检索

| 需求              | 候选与成熟度检查                                                           | 决策                                                                            |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 聊天虚拟列表      | `@tanstack/react-virtual`（MIT，活跃维护，官方文档含安装/API/示例）        | **继续复用**，已接入 chat anchor/follow 策略                                    |
| Electron E2E      | Playwright Electron experimental API（Apache-2.0，持续活跃，官方示例完整） | **推荐后续接入**；当前尚未把 GUI UAT 自动化，不虚构通过                         |
| Markdown 安全     | `rehype-sanitize`（MIT，unified 生态，文档与 schema 示例完整）             | **继续复用**，自定义 schema 仅放行高亮 class                                    |
| Markdown 高亮     | `rehype-highlight`/highlight.js（BSD-3-Clause，成熟、文档完整）            | **保留**；约738KB按需 chunk 可接受，真实加载数据不足前不换库                    |
| FPS 指标          | 浏览器 `requestAnimationFrame` + 纯统计函数                                | **自研薄层**；避免为少量 frame-time 算法新增依赖，已单测数学模型                |
| Electron 导航防护 | Electron 官方 `will-navigate` / `setWindowOpenHandler`                     | **复用平台原生 API**，无需第三方包                                              |
| 依赖漏洞治理      | npm audit + Dependabot/Renovate 候选                                       | **生产 audit 作为门禁**；开发链 20 项等待上游安全兼容版本，不执行危险 `--force` |

说明：旧表中的“最近更新”或下载量是历史快照，不能替代发布时重新核验。对新增第三方依赖仍执行“过去 6 个月至少 3 次更新、安装/API/示例文档、宽松许可证”的三项门槛；本轮代码改动优先复用现有依赖与 Electron 原生能力，未引入新的运行时包。
