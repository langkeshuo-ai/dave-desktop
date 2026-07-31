# 项目交接文档

> **更新**: 2026-07-31  
> **本节**: R3 冷启动重排(窗口先显)/ R4 Markdown chunk 瘦身(738→608KB,highlight 20 语言子集)/ R2 mock 流式全链路 E2E(免真实 Key)/ secure-storage async 解密字段名修复(真实 bug)/ FPS 真机采集(60fps,关闭 FPS-REAL)/ 发布 workflow(签名配置就绪)/ FunnelView 补 7 日回访  
> **下游**: 需代码签名证书 + 真实 API Key 全链路 E2E + 远端 CI 首绿 + 跨平台

## 1. 当前任务背景

- **问题**：Dave Desktop（Electron 本地 Agent）工程规范化 + Cursor 风格主题 + 0.2.0 性能/安全/可维护性持续收口。当前推进到所有代码级风险均已关闭，只剩外部依赖项。
- **目标**：门禁全绿、深色主题、Code Splitting、IPC 纵深防御、CI/E2E 基线、生产包可分发；向 Cursor/Codex 级 UX 靠拢。
- **技术栈**：Electron 42 + electron-vite 5 + React 19 + TS 5.8 + Tailwind 4 + Zustand 5 + Vitest 3.2.6 + Playwright + ESLint 9 + Prettier + Husky。
- **约束**：中文 UI；IPC 白名单 + sender 校验；API Key 走 safeStorage；主进程 CJS 打包 + `package.json` `"type":"module"` 并存；工作区 `C:\Users\C\dave客户端开发`。

## 2. 已完成工作

### 工程规范化（既有）

- ESLint 9 flat / Prettier / EditorConfig / Husky + lint-staged。
- `npm run verify` = format:check + lint + 双 tsconfig typecheck + coverage + build。
- store key 白名单、safeStorage、shell hard-deny、导航同源策略、rehype-sanitize。

### 性能 Phase 1-2（既有 + 本轮）

- 组件懒加载：Settings / Welcome / ApiKeyWizard / WorkspacePanel / CommandPalette / KeyboardHelp。
- `MarkdownContent` 独立 chunk（~738KB）；主 renderer ~746KB（已低于 900KB 目标）。
- 虚拟列表 `@tanstack/react-virtual`；dev-only 2000 消息压测 + FPS 报告（Gauge 按钮）。
- MessageBubble memo 避免历史消息随流式重渲染。

### 本轮完整新增

| 项                 | 位置                                                 | 说明                                                                               |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| IPC 滑动窗口限流   | `src/shared/rate-limit.ts` + `ipc.ts`                | store-set/chat-stream 30/s；apply-patch 10/s                                       |
| 流式 Markdown 节流 | `markdown-throttle.ts` + `MessageList`               | 流式 120ms + memo                                                                  |
| 全局快捷键         | `App.tsx`                                            | Esc 停流；Ctrl+1-9 切会话；Ctrl+N 新建；Ctrl+, 设置；Ctrl+K 命令面板；? 快捷键帮助 |
| CI workflow        | `.github/workflows/ci.yml`                           | verify + audit --omit=dev + electron smoke                                         |
| **用户消息编辑**   | `session-edit.ts` + `session-replace-messages` + IPC | 就地编辑 → 截断后续 → 重新生成；不再重复堆叠 user                                  |
| **会话内全文搜索** | `src/shared/message-search.ts` + `ChatView.tsx`      | Ctrl+F 搜索条；Enter/Shift+Enter 上下跳；命中高亮；Esc 关闭                        |
| **Assistant 导航** | `ChatView.tsx`                                       | Ctrl+↑/↓ 跳到上/下一条 assistant 消息                                              |
| E2E smoke 扩展     | `tests/electron-smoke.mjs`                           | 新增 Ctrl+F 搜索条断言 + 会话内搜索验证                                            |
| 单测               | `tests/unit.test.ts`                                 | **150 项**，含 rate-limit/throttle/session-edit/message-search                     |

### 验证结果（全绿）

```
npm run verify        → 全绿（150 tests + coverage + build）
                        format:check ✓  lint ✓  typecheck ✓  test:coverage 150/150 ✓  build ✓
node tests/electron-smoke.mjs → Electron smoke passed（CSP/帮助/命令面板/设置/新建会话/导出/Ctrl+F）
主 bundle             → ≈ 745.72 KB
Markdown chunk        → ≈ 738.13 KB
```

### 重要决策

1. **不 React.lazy 插件** — remark/rehype 不是组件；只 lazy `MarkdownContent` 组件。
2. **流式节流用独立子组件** — 避免 MessageBubble 早退后再 hooks（Rules of Hooks）。
3. **限流失败静默/返回错误对象** — store-set 静默；apply-patch 返回 `{ok:false}`；不抛崩主进程。
4. **CI 不 force audit fix** — 开发链 high 漏洞在 electron-builder/eslint 传递依赖，force 会降级 builder。
5. **主题命名保持 `light|night`** — CSS 用 `html.night`；不急于改成 dark。
6. **搜索不引入 Fuse.js** — 聊天场景精确子串匹配足够，避免额外 bundle。
7. **关闭搜索时重置 navCursor** — 否则 Ctrl+↑/↓ 导航高亮会残留到下次打开搜索。
8. **导航消息高亮与搜索高亮共享 activeSearchIndex** — Ctrl+↑/↓ 和 Ctrl+F 搜索都使用同一个 index 状态，避免两个状态冲突。

## 3. 当前状态

### 正常工作

- 生产 Windows 包（约 2026-07-27）：`dist/dave-desktop-win-x64-setup.exe`、portable（~108MB）。
- 主题变量层（light/night）、懒加载、虚拟列表、命令面板、导出会话 Markdown、侧栏会话标题搜索。
- `npm run verify` → 全绿（150 单测、format、lint、双 tsc typecheck、V8 coverage、production build）。
- `node tests/electron-smoke.mjs` → Electron smoke passed。
- 主 bundle ~746KB，Markdown chunk ~738KB。

### 按键映射一览

| 快捷键      | 动作                    | 实现位置              |
| ----------- | ----------------------- | --------------------- |
| Esc         | 关闭弹窗/停止流式       | `App.tsx`             |
| Ctrl+1~9    | 切换会话（1 索引）      | `App.tsx`             |
| Ctrl+N      | 新建会话                | 主进程 globalShortcut |
| Ctrl+,      | 打开设置                | 主进程 globalShortcut |
| Ctrl+K      | 命令面板                | 主进程 globalShortcut |
| Ctrl+F      | 搜索栏（会话内全文）    | `ChatView.tsx`        |
| Ctrl+↑/↓    | 跳到上/下一条 assistant | `ChatView.tsx`        |
| Enter       | 搜索下一处              | `ChatView.tsx`        |
| Shift+Enter | 搜索上一处              | `ChatView.tsx`        |
| ?           | 快捷键帮助面板          | `App.tsx`             |

### 未完成 / 外部依赖

| ID             | 级别 | 状态                                                                                 | 阻塞原因                                                                |
| -------------- | ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| FPS-REAL       | P1   | 工具就绪（Gauge 按钮），**未人工采集**                                               | 需在目标 Windows 机手动：`npm run dev` → 点 Gauge → 滚动 → 读控制台报告 |
| UAT-E2E        | P1   | smoke 基线有；**流式/编辑/Agent 批准全链路仍缺**                                     | 需真实 API Key；编辑消息 GUI 断言需 Playwright 脚本                     |
| SIGNING        | P1   | **无代码签名证书**                                                                   | 需采购 Windows 代码签名证书（$200/年）                                  |
| UPDATE-RELEASE | P1   | updater 已接线（`index.ts:setupAutoUpdater`）                                        | 缺签名 + GitHub Releases 发布策略                                       |
| DEV-AUDIT      | P2   | `npm audit --omit=dev` = 0；全 audit 仍在开发链有 19 high（electron-builder/eslint） | 上游依赖修复；不可 `audit fix --force`                                  |
| CI 远端        | P2   | workflow 已入库（`.github/workflows/ci.yml`）                                        | 需 push 后观察 runner 首次绿灯                                          |
| Worker/冷启动  | P2   | 没做                                                                                 | 主进程 worker 线程 + lazy require 优化                                  |
| MAC-LINUX      | P3   | 仅 Windows 环境                                                                      | 需 macOS/Linux 机器构建和 smoke                                         |

### 已知报错条件

1. **ESM require 崩溃**（已修）：`type:module` + 未 externalize 的 `require("electron-updater")`。
2. **dev Vite join undefined**（偶发）：`npm install` 后立刻 `npm run dev` 可能 exit 3；重试或清 Vite cache。
3. **IPC 限流触发**：1s 内 >30 次 store-set/chat-stream 会被丢弃（日志 `IPC rate limited`）。

## 4. 下一步行动计划

按优先级排列：

### P0 — 人工操作（无外部依赖）

1. **FPS 真机采集**（~2 分钟）
   - `npm run dev` → 点工具栏 Gauge（仪表盘）按钮 → 注入 2000 条 → 手动滚动 → 再点 Gauge 停止
   - 从控制台复制 FPS 报告 → 写入 `PERFORMANCE_REPORT.md`
   - 验证目标：avg >50fps、P95 <30ms、P99 <50ms

2. **E2E smoke 补完**（~1 天）
   - 用真实 API Key 覆盖：发消息 → 流式回显 → 编辑消息 → 截断再生成 → Agent 批准
   - 在 `tests/electron-smoke.mjs` 追加断言

### P1 — 需外部输入

3. **签名 + 自动发布**
   - 采购 Windows 代码签名证书
   - 配置 electron-builder signing（`package.json` build.win.certificateFile）
   - 建立 GitHub Releases 发布策略 + latest.yml

4. **CI 远端绿灯**
   - push CI workflow 到 GitHub
   - 观察 Actions runner 首次 `npm run verify` 的结果
   - 可选 package:win smoke（需 Windows runner）

### P2 — 长期优化

5. **主进程性能**
   - Worker threads：`src/main/agent.ts` 的 `toolShell` / `toolWriteFile` 移 worker
   - Lazy require：非关键模块（electron-updater、electron-log）延迟加载
   - 冷启动优化（窗口先显示再初始化 store）

6. **消息内关键词 mark 高亮**（搜索命中词在气泡内高亮）
   - 在 `MessageBubble` 内拆分 content 文本，包裹 `<mark>` 标签
   - 但注意虚拟列表下重渲染代价，建议在 `UserMessageBubble` / `AssistantMarkdownBubble` 内添加

### 每个操作的验证方式

```
# 验证门禁
npm run verify
npm run test:electron
npm audit --omit=dev

# 打包
npm run package:win
```

## 5. 踩坑记录（重要）

| 坑                                            | 原因                                                                          | 不要再做                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| `require is not defined in ES module`         | type:module + CJS require 未 external                                         | 主进程 dynamic require 必须 externalize             |
| React.lazy 包装 remark/rehype 插件            | 插件不是 Component                                                            | 只 lazy 组件；插件静态 import                       |
| hooks 在 MessageBubble 条件 return 后         | Rules of Hooks                                                                | 流式节流放到 `AssistantMarkdownBubble` 独立子组件   |
| rehype-sanitize 直接塞 Plugin 类型            | 工厂签名不兼容                                                                | 元组 + `as never`                                   |
| virtualizer 泛型 HTMLDivElement vs Element    | prop 过宽                                                                     | `ReactVirtualizer<HTMLDivElement, Element>`         |
| 预估组件 850KB 懒加载收益                     | 组件很小，大头 Markdown/React                                                 | 以 `out/bundle-stats.html` 为准                     |
| dual tsconfig                                 | main 不在 renderer tsconfig                                                   | 必须 `npm run typecheck` 双跑                       |
| `npm audit fix --force`                       | 会把 electron-builder 降到 22.x                                               | 只用 omit=dev 门禁                                  |
| electron-smoke 里直接写 `document`            | Node ESLint no-undef                                                          | `waitForFunction` 用字符串回调                      |
| husky typecheck 超时                          | 双 tsc 慢                                                                     | 紧急 `HUSKY=0`，事后补绿                            |
| **搜索关闭后 Ctrl+↑ 高亮残留**                | 关闭搜索时没重置 navCursor                                                    | **closeSearch 里必须一并设置 `setNavCursor(null)`** |
| **搜索和导航共享 activeSearchIndex 但不同步** | Ctrl+↑ 设 navCursor，搜索设 activeSearchIndex，但 ChatView:582 传 `searchOpen |                                                     | navCursor != null ? activeSearchIndex : null` | 导航和搜索使用同一套 index 和 setter，navCursor 只在 keydown 中临时用，最终统一走 `activeSearchIndex` |

**特殊配置**

- 主/preload：`format: "cjs"` + `interop: "auto"`；`external: ["electron","electron-updater"]`。
- smoke 隔离：`DAVE_TEST_USER_DATA` 临时目录，避免单实例锁冲突。
- store 白名单：`src/shared/store-policy.ts`。
- 限流实现：`src/shared/rate-limit.ts`（可单测，无 Electron 依赖）。
- 搜索纯函数：`src/shared/message-search.ts`（零依赖，Vitest 可测）。

## 6. 新对话启动指南

写给下一位 AI（或开发者）：

1. **先检查**：`git status`、`git log -5`、读本文件 + `RESIDUAL_RISKS.md` + `OPTIMIZATION_ROADMAP.md`。
2. **第一操作**：`npm run verify`（全绿后才开始工作）；需要 GUI 时 `npm run test:electron` 或 `npm run dev`。
3. **不要重做**：
   - typecheck/安全存储/主题变量/ESLint 基建/Markdown lazy/主 bundle 瘦身到 ~730KB
   - 不要 React.lazy 插件
   - 不要 `audit fix --force`
   - 不要给搜索引入 Fuse.js（精确子串已够用）
   - 不要在 `MessageBubble` 里加 hooks（早退问题）
4. **当前代码全部已提交**（`git status` 应该干净或只有待定改动）。
5. **路径**：工作区 `C:\Users\C\dave客户端开发`；产物 `out/`、`dist/`；分析 `out/bundle-stats.html`（若启用 visualizer）。
6. **优先**：FPS 真机采集 → E2E 业务场景（需 API Key）→ 签名发布。不需要重做搜索或编辑。
7. **已知未提交**：无。按用户意图决定是否 commit。
8. **skill 自动路由**：
   ```powershell
   python "C:/Users/C/.zcode/skills/skills/do.py" "用户需求" --top=3
   ```
   只加载 composition 结果的 1-3 个 skill.md。

### 本轮关键文件清单（新建/大改）

```
src/shared/rate-limit.ts        — IPC 限流（滑动窗口，无 Electron 依赖）
src/shared/markdown-throttle.ts — 流式 120ms 节流逻辑
src/shared/session-edit.ts      — 消息编辑纯函数（truncate/regenerate）
src/shared/message-search.ts    — 全文搜索纯函数（零依赖子串匹配）
.github/workflows/ci.yml        — GitHub Actions verify + audit + smoke
src/main/ipc.ts                 — IPC handler（含限流 + replaceMessages）
src/main/session.ts             — replaceSessionMessages
src/preload/index.ts            — 暴露 replaceMessages
src/renderer/App.tsx            — 快捷键 Esc/Ctrl+1-9/N/,/K；编辑/再生成入口
src/renderer/components/ChatView.tsx — 搜索条 UI、导航、Gauge 压测按钮
src/renderer/components/MessageList.tsx — UserMessageBubble 编辑、命中高亮
src/renderer/components/KeyboardHelp.tsx — Ctrl+F / Ctrl+↑/↓ 帮助
src/renderer/styles/globals.css — .msg-search-hit / .msg-search-active
tests/unit.test.ts              — 150 tests
tests/electron-smoke.mjs        — 含 Ctrl+F 搜索断言
```
