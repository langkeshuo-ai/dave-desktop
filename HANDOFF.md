# 项目交接文档

## 1. 当前任务背景

- **问题**：Dave Desktop（Electron 本地 Agent）工程规范化 + Cursor 风格主题 + 0.2.0 性能/安全/可维护性持续收口。
- **目标**：门禁全绿、深色主题、Code Splitting、IPC 纵深防御、CI/E2E 基线、生产包可分发；向 Cursor/Codex 级 UX 靠拢。
- **技术栈**：Electron 42 + electron-vite 5 + React 19 + TS 5.8 + Tailwind 4 + Zustand 5 + Vitest 3.2.6 + Playwright + ESLint 9 + Prettier + Husky。
- **约束**：中文 UI；IPC 白名单 + sender 校验；API Key 走 safeStorage；主进程 CJS 打包 + `package.json` `"type":"module"` 并存；工作区 `C:\Users\C\dave客户端开发`。

## 2. 已完成工作

### 工程规范化（既有）

- ESLint 9 flat / Prettier / EditorConfig / Husky + lint-staged。
- `npm run verify` = format:check + lint + 双 tsconfig typecheck + coverage + build。
- store key 白名单、safeStorage、shell hard-deny、导航同源策略、rehype-sanitize。

### 性能 Phase 1（既有）

- 组件懒加载：Settings / Welcome / ApiKeyWizard / WorkspacePanel / CommandPalette / KeyboardHelp。
- `MarkdownContent` 独立 chunk（~738KB）；主 renderer ~730KB（已低于 900KB 目标）。
- 虚拟列表 `@tanstack/react-virtual`；dev-only 2000 消息压测 + FPS 报告。
- MessageBubble memo 避免历史消息随流式重渲染。

### 本轮（2026-07-29）新增

| 项                 | 位置                                               | 说明                                         |
| ------------------ | -------------------------------------------------- | -------------------------------------------- |
| IPC 滑动窗口限流   | `src/shared/rate-limit.ts` + `ipc.ts`              | store-set/chat-stream 30/s；apply-patch 10/s |
| 流式 Markdown 节流 | `markdown-throttle.ts` + `MessageList`             | 流式 120ms + memo                            |
| 快捷键             | `App.tsx`                                          | Esc 停流；Ctrl+1-9；Ctrl+N / Ctrl+,          |
| CI                 | `.github/workflows/ci.yml`                         | verify + audit + smoke                       |
| **用户消息编辑**   | `session-edit.ts` + `session-replace-messages` IPC | 就地编辑 → 截断后续 → 重新生成               |
| **再生成截断**     | `planRegenerate` + `replaceMessages`               | 不再重复堆叠 user 轮次                       |
| E2E smoke          | `tests/electron-smoke.mjs`                         | CSP/帮助/命令面板/设置/新建会话/导出         |
| 单测               | `tests/unit.test.ts`                               | **147** 项全绿                               |

### 验证结果（本轮实测）

```
npm run verify        → 全绿（147 tests + coverage + build）
node tests/electron-smoke.mjs → Electron smoke passed
主 bundle             → ≈ 736.60 KB
Markdown chunk        → ≈ 738.13 KB
```

### 重要决策

1. **不 React.lazy 插件** — remark/rehype 不是组件；只 lazy `MarkdownContent` 组件。
2. **流式节流用独立子组件** — 避免 MessageBubble 早退后再 hooks（Rules of Hooks）。
3. **限流失败静默/返回错误对象** — store-set 静默；apply-patch 返回 `{ok:false}`；不抛崩主进程。
4. **CI 不 force audit fix** — 开发链 high 漏洞在 electron-builder/eslint 传递依赖，force 会降级 builder。
5. **主题命名保持 `light|night`** — CSS 用 `html.night`；不急于改成 dark。

## 3. 当前状态

### 正常工作

- 生产 Windows 包（约 2026-07-27）：`dist/dave-desktop-win-x64-setup.exe`、portable（~108MB）。
- 主题变量层、懒加载、虚拟列表、命令面板、导出会话 Markdown、侧栏会话搜索。
- `npm run verify` + `npm run test:electron` 本机绿。
- 主 bundle 已 <900KB。

### 未完成 / 外部依赖

| ID             | 级别 | 状态                                                     |
| -------------- | ---- | -------------------------------------------------------- |
| FPS-REAL       | P1   | 2000 消息真窗口滚动 FPS **未人工采集**（Gauge 按钮已有） |
| UAT-E2E        | P1   | smoke 基线有；首启/发消息/Agent 批准全链路仍缺           |
| SIGNING        | P1   | 无代码签名证书                                           |
| UPDATE-RELEASE | P1   | updater 已接线，缺签名 + Releases 策略                   |
| DEV-AUDIT      | P2   | `npm audit` 开发链仍有 high；`omit=dev` 为 0             |
| CI 远端        | P2   | workflow 已入库，**远端 runner 首次绿灯待确认**          |
| 消息编辑       | —    | **已完成**（就地编辑 + 截断 + 再生成）                   |
| 消息全文搜索   | P2   | 仅会话标题搜索                                           |
| Worker/冷启动  | P2   | 主进程 worker、lazy require 启动优化未做                 |
| MAC-LINUX      | P3   | 仅 Windows 环境                                          |

### 已知报错条件

1. **ESM require 崩溃**（已修）：`type:module` + 未 externalize 的 `require("electron-updater")`。
2. **dev Vite join undefined**（偶发）：`npm install` 后立刻 `npm run dev` 可能 exit 3；重试或清 Vite cache。
3. **IPC 限流触发**：1s 内 >30 次 store-set/chat-stream 会被丢弃（日志 `IPC rate limited`）。

## 4. 下一步行动计划

1. **立刻（人工 2 分钟）**：`npm run dev` → Gauge 注入 2000 条 → 滚动采 FPS → 写入 `PERFORMANCE_REPORT.md`。
2. **E2E**：有 API Key 后加真实发消息/流式/编辑 GUI 断言；Agent 批准链路。
3. **UX**：消息全文搜索（评估 Fuse.js MIT）；消息导航 Ctrl+↑/↓。
4. **工程**：观察 CI 远端绿灯；可选 package:win smoke。
5. **发布**：证书 + latest.yml。

**验证口令**：

```bash
npm run verify
npm run test:electron
npm audit --omit=dev
```

## 5. 踩坑记录（重要）

| 坑                                         | 原因                                  | 不要再做                                    |
| ------------------------------------------ | ------------------------------------- | ------------------------------------------- |
| `require is not defined in ES module`      | type:module + CJS require 未 external | 主进程 dynamic require 必须 externalize     |
| React.lazy 包装 remark/rehype 插件         | 插件不是 Component                    | 只 lazy 组件；插件静态 import               |
| hooks 在 MessageBubble 条件 return 后      | Rules of Hooks                        | 流式节流放到 `AssistantMarkdownBubble`      |
| rehype-sanitize 直接塞 Plugin 类型         | 工厂签名不兼容                        | 元组 + `as never`                           |
| virtualizer 泛型 HTMLDivElement vs Element | prop 过宽                             | `ReactVirtualizer<HTMLDivElement, Element>` |
| 预估组件 850KB 懒加载收益                  | 组件很小，大头 Markdown/React         | 以 `out/bundle-stats.html` 为准             |
| dual tsconfig                              | main 不在 renderer tsconfig           | 必须 `npm run typecheck` 双跑               |
| `npm audit fix --force`                    | 会把 electron-builder 降到 22.x       | 只用 omit=dev 门禁                          |
| electron-smoke 里直接写 `document`         | Node ESLint no-undef                  | `waitForFunction` 用字符串回调              |
| husky typecheck 超时                       | 双 tsc 慢                             | 紧急 `HUSKY=0`，事后补绿                    |

**特殊配置**

- 主/preload：`format: "cjs"` + `interop: "auto"`；`external: ["electron","electron-updater"]`。
- smoke 隔离：`DAVE_TEST_USER_DATA` 临时目录，避免单实例锁冲突。
- store 白名单：`src/shared/store-policy.ts`。
- 限流实现：`src/shared/rate-limit.ts`（可单测，无 Electron 依赖）。

## 6. 新对话启动指南

1. **先检查**：`git status`、`git log -5`、读本文件 + `RESIDUAL_RISKS.md` + `OPTIMIZATION_ROADMAP.md`。
2. **第一操作**：`npm run verify`；需要 GUI 时再 `npm run test:electron` 或 `npm run dev`。
3. **不要重做**：typecheck/安全存储/主题变量/ESLint 基建/Markdown lazy/主 bundle 瘦身到 ~730KB；不要 React.lazy 插件；不要 force audit。
4. **优先**：FPS 真机采集 → E2E 业务场景 → 消息编辑/全文搜索 → 签名发布。
5. **路径**：工作区 `C:\Users\C\dave客户端开发`；产物 `out/`、`dist/`；分析 `out/bundle-stats.html`（若启用 visualizer）。
6. **本轮未提交**：若 `git status` 显示有改动，按用户意图决定是否 commit（含 CI、限流、快捷键、节流、文档）。

### 本轮关键文件清单

```
src/shared/rate-limit.ts / markdown-throttle.ts / session-edit.ts
.github/workflows/ci.yml
src/main/ipc.ts / session.ts
src/preload/index.ts                     (replaceMessages)
src/renderer/App.tsx                     (edit/regenerate 截断)
src/renderer/components/MessageList.tsx  (UserMessageBubble 编辑)
src/renderer/components/ChatView.tsx
src/shared/telemetry.ts                  (message_edited)
tests/unit.test.ts / electron-smoke.mjs
HANDOFF.md / RESIDUAL_RISKS.md / OPTIMIZATION_ROADMAP.md
```
