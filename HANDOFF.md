# 项目交接文档

## 1. 当前任务背景

- **问题**：对 Dave Desktop（Electron 本地 Agent）做行业标准工程规范化 + Cursor 风格主题，并推进 0.2.0 性能优化。
- **目标**：可验证门禁全绿、深色 Cursor 主题默认、Code Splitting 落地、文档/路线图齐全，生产包可分发。
- **技术栈**：Electron 42 + electron-vite 5 + React 19 + TS 5.8 + Tailwind 4 + Zustand 5 + Vitest + ESLint 9 + Prettier + Husky。
- **约束**：中文 UI；IPC 白名单；API Key 走 safeStorage；主进程 CJS 打包 + `package.json` `"type":"module"` 并存。

## 2. 已完成工作

### 工程规范化

- ESLint 9 flat config、Prettier、EditorConfig、Husky + lint-staged、`npm run verify` = lint + typecheck + test + build。
- typecheck 修复：MessageList virtualizer 泛型、secure-storage 异步 API 类型、ipc `getStore` 重复导入。
- 清理 `ts-test-*` 临时目录并写入 `.gitignore`。

### 安全 / 架构

- `src/main/secure-storage.ts`：safeStorage 同步 + 异步探测，Linux basic_text 拒绝。
- `src/shared/store-policy.ts`：store key 白名单 + session title 校验。
- IPC `validateSender` + telemetry 事件白名单。
- `electron-updater` 已 externalize，避免 ESM require 崩溃（commit `6198dd1`）。

### UI / 主题

- `globals.css`：深色优先 Cursor 色板（`:root` dark，`html.light` 浅色）。
- 组件走 CSS 变量；LoadingOverlay 用于模态懒加载 fallback。

### 性能 Phase 1

- 组件懒加载：Settings / Welcome / ApiKeyWizard / WorkspacePanel / CommandPalette / KeyboardHelp。
- ReactMarkdown **本体** lazy + Suspense（插件静态导入，不能 React.lazy 插件）。
- 实测主 bundle **~1204KB**（自 ~1468KB，约 -18%）；Markdown 独立 chunk **~266KB**。
- FPS 工具：`src/renderer/lib/fps-monitor.ts`、`test-utils.ts`；ChatView dev 模式 Gauge 按钮。
- `rollup-plugin-visualizer` → `out/bundle-stats.html`。

### 文档

- `OPTIMIZATION_ROADMAP.md`、`PERFORMANCE_REPORT.md`、`CONTRIBUTING.md`、`CHANGELOG.md`、`README.md` 已更新。

### 关键提交（master）

```
fbeb48e perf: Code Splitting 与 Markdown 懒加载优化
603b55b feat(perf): implement code splitting and virtual scroll performance testing
6198dd1 fix: externalize electron-updater to resolve ES module error
e20c0a2 docs: 添加 0.2.0 版本优化提升路线图
4bacbe1 refactor: 全面规范化与 Cursor 风格主题改造
```

已入库：`LoadingSpinner`/`LoadingOverlay`、`setMessages` 压测注入、最新 Windows 安装包（2026-07-27）。

## 3. 当前状态

### 正常

- `npm run typecheck` / `lint` / `test`（123）/ `build` 全绿。
- 生产 Windows 包：`dist/dave-desktop-win-x64-setup.exe`、`...-portable.exe`（约 108MB）。
- 主题变量层与懒加载结构已进主分支（部分 LoadingOverlay 可能未 commit）。

### 未完成 / 待确认

- **主 bundle 仍 ~1.2MB**，未达路线图 900KB 目标；大头是 React 生态 + highlight 相关（插件仍静态进主图，仅 ReactMarkdown 拆出）。
- **虚拟滚动 2000 消息 >50fps**：工具有，**未做正式实测验收**（待确认）。
- **性能测试按钮** 已接 `useStore.setMessages` 注入 2000 条；**GUI 滚动 FPS 数值仍待人工点 Gauge 实测**。
- **`npm run dev` 偶发**：Vite lockfile re-optimize 时 `Cannot read properties of undefined (reading 'join')`（exit 3）；renderer 仍可能起在 5173 — **待确认是否可忽略/复现**。
- WorkspacePanel 仍 `fallback={null}`（侧栏，有意不挡布局）。
- OPTIMIZATION_ROADMAP 中大量 checkbox 仍未勾（键盘增强、Sentry、CI、E2E 等）。
- DEFERRED：代码签名、自动更新托管、mac/linux 真机构建、MCP、OS shell 沙箱。

### 报错条件（已知）

1. **ESM require 崩溃**（已修）：`package.json` type module + 未 externalize 的 `require("electron-updater")` → 主进程 Uncaught。
2. **dev Vite join undefined**：依赖锁变更后 re-optimize 路径；条件：`npm install` 后立刻 `npm run dev`。

## 4. 下一步行动计划

1. **立刻**：`npm run dev`，开会话点 Gauge 注入 2000 条，滚动后停测，把 FPS 写入 PERFORMANCE_REPORT。
2. **安装包**：已刷新 `dist/dave-desktop-win-x64-setup.exe` / portable（约 108MB，2026-07-27）。
3. **继续瘦身**：分析 `out/bundle-stats.html`；评估 highlight 语言子集 / MessageList 进一步拆 chunk（注意 unified 插件不能 React.lazy）。
4. **Sprint 2 UX**：Cmd+K 已有基础，补消息复制/编辑、滚动体验与快捷键文档一致性。
5. **工程**：GitHub Actions CI；修 dev Vite 偶发；electron.vite 动态 import 警告是否可静态化（非阻塞）。

**验证**：`npm run verify` 全绿；`npm run dev` 窗口可开；懒加载 Network 可见 Settings/Markdown chunk；压测 avg FPS>50。

## 5. 踩坑记录（重要）

| 坑                                      | 原因                                      | 不要再做                                                       |
| --------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| `require is not defined in ES module`   | type:module + CJS require 依赖未 external | 主进程 dynamic require 必须 externalize（electron-updater 等） |
| React.lazy 包装 remark/rehype 插件      | 插件不是 Component                        | 只 lazy 组件；插件静态 import                                  |
| rehype-sanitize 直接塞 Plugin 类型      | 工厂签名不兼容                            | 元组 + `as never` / PluggableList                              |
| virtualizer HTMLDivElement vs Element   | MessageList prop 过宽                     | 用 `ReactVirtualizer<HTMLDivElement, Element>`                 |
| handleSelectSession 在 useEffect 前引用 | TDZ                                       | 回调定义在依赖它的 effect 之前                                 |
| Prettier 后 shell 正则                  | 无用 `\/`                                 | 字符类用 `[/~]`                                                |
| 预估组件 850KB 懒加载收益               | 实际组件很小，大头在 Markdown/React       | 以 visualizer 为准，勿用臆测 KB                                |
| husky typecheck 超时                    | 双 tsc 慢                                 | 本地可 `HUSKY=0` 紧急提交，但应修好再交                        |
| dual tsconfig                           | main 不在 tsconfig.json include           | `npm run typecheck` 必须双跑                                   |

**特殊配置**

- 主/preload：`format: "cjs"` + `interop: "auto"`；`external: ["electron","electron-updater"]`。
- `electron-builder` extraMetadata 可改 packaged type（见 AGENTS.md ESM 说明）。
- store key 白名单：`src/shared/store-policy.ts`。
- 主题：默认 dark 变量；浅色 `html.light`；App 里 theme 类型仍可能是 `light|night` — **迁移命名待确认**。

## 6. 新对话启动指南

1. **先检查**：`git status`、`git log -5`、读本文件与 `OPTIMIZATION_ROADMAP.md` / `PERFORMANCE_REPORT.md`。
2. **第一操作**：`npm run verify`；再 `npm run dev`（若 Vite join 报错，重试或清 Vite cache）。
3. **不要重做**：已修 typecheck/安全存储/主题变量架构/ESLint 基建；不要再 React.lazy 插件；不要假设 bundle 已 <900KB。
4. **优先**：提交未入库的 LoadingSpinner；完成虚拟滚动实测；按 visualizer 继续拆主 bundle。
5. **路径提示**：工作区 `C:\Users\C\dave客户端开发`；产物 `out/`、`dist/`；分析 `out/bundle-stats.html`。
