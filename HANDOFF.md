# 项目交接文档

> **更新**: 2026-08-05 16:45（Asia/Shanghai）  
> **HEAD**: `857cbee` · 分支 `master` · **工作区**: 仅未跟踪 `CLAUDE.md`，无未提交代码改动  
> **版本**: `package.json` 仍为 `0.1.0`（0.2.0 发布门槛未过；0.3.0 能力已部分落地）  
> **本文件目标**: 新会话零上下文可读本文继续；旧 `HANDOFF.md`（2026-07-31）信息已并入并覆盖

---

## 1. 当前任务背景

### 我们在解决什么

Dave Desktop（本地 Electron Agent 客户端）的工程化、安全纵深、性能、可观测性与 Cursor/Codex 级 UX。  
**0.2.0 代码侧目标已基本收口**（verify / smoke / UAT / FPS / MCP / 日志 / 诊断）。  
**当前阶段是 0.3.0 能力扩展 + UI 定稿**：

| 线                                          | 状态                                                                |
| ------------------------------------------- | ------------------------------------------------------------------- |
| 0.2.0 工程门禁 / 性能 / 安全 / MCP / 可观测 | ✅ 代码可收口项关闭，剩外部依赖                                     |
| 0.3.0 M1 skills                             | ✅ 基础 + agent 工具集成；⏳ 目录扫描 loader + UAT 步骤             |
| 0.3.0 M2 i18n                               | ✅ 基建 + Settings/Chat/Help 全量迁移；⏳ App 状态/模式等剩余硬编码 |
| UI 视觉（Cursor/Codex 级）                  | ✅ 设计系统抛光 + 布局级 rework；**最终定稿 light-first**           |
| 首启引导                                    | ✅ **启动自动弹 Welcome/ApiKeyWizard 已移除**（专业用户直达主界面） |

### 项目目标

- 本地多 provider Agent（OpenAI / Anthropic / DeepSeek / custom）+ shell/写文件/patch + 审批。
- 中文优先 UI，可切 en；IPC 白名单 + sender + 限流；API Key 走 safeStorage。
- 门禁：`npm run verify` + electron smoke + UAT +（可选）`node tests/verify-full.mjs`。
- 向 Cursor/Codex 级桌面体验靠拢，但不引入未验证的大型重写。

### 技术栈 / 环境 / 约束

| 项          | 值                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 工作区      | `C:\Users\C\dave客户端开发`                                                                                                                            |
| 栈          | Electron 42 · electron-vite 5 · React 19 · TS 5.8 · Tailwind 4 · Zustand 5 · Vitest 3.2.6 · Playwright · i18next 26 · `@modelcontextprotocol/sdk` 1.30 |
| 架构        | `src/main` / `src/preload` / `src/renderer` / `src/shared`（纯函数，node 可单测）                                                                      |
| 双 tsconfig | `tsconfig.json`（renderer+shared）+ `tsconfig.node.json`（main+preload+shared）；**必须** `npm run typecheck` 双跑                                     |
| ESM/CJS     | 根 `package.json` `"type":"module"`；主进程打包 CJS；`electron-store` 等用 `resolveDefaultExport()`                                                    |
| UI 语言     | 中文优先 + i18n zh-CN/en                                                                                                                               |
| 主题        | **light-first**（`:root` 浅色）；`html.night` 为深色变体。**不要**再默认 dark-first                                                                    |
| 远程        | **本地无 `git remote`**（`git remote -v` 空）；CI workflow 已入库但从未远端绿灯                                                                        |
| 平台        | 仅 Windows 真机验证过；builder 已有 mac/linux 配置                                                                                                     |

---

## 2. 已完成工作

### 2.1 0.2.0 基线（此前多轮，仍有效）

- 工程：ESLint 9 flat / Prettier / Husky / lint-staged / `npm run verify`
- 安全：store key 白名单、safeStorage、shell hard-deny、IPC sender + 限流、rehype-sanitize、导航同源
- 性能：Markdown lazy chunk、虚拟列表、流式 120ms 节流、MessageBubble memo、冷启动重排（实测 ~1726ms）
- 功能：会话编辑再生成、会话内 Ctrl+F 搜索、Assistant Ctrl+↑/↓、命令面板、导出 Markdown
- 可观测：JSON Lines 日志 + Settings 查看器、诊断一键导出、本地遥测漏斗
- MCP：官方 SDK stdio，`mcp__<server>__<tool>` 并入 agent 循环，**一律审批**，启动自动连接
- 测试：`tests/unit.test.ts` · `electron-smoke.mjs`（含 mock 流式/编辑/审批）· `electron-uat.mjs` · `verify-full.mjs`
- 发布骨架：`.github/workflows/ci.yml` + `release.yml`（缺签名与 remote）

关键证据：`INTEGRATED_OVERVIEW.md`、`RESIDUAL_RISKS.md`、`PERFORMANCE_REPORT.md`、`tests/verification-result.txt`（2026-08-01 分步全绿：build + 170 unit + smoke 三场景 + UAT 21/21）。

### 2.2 0.3.0 M1 skills（2026-08-01）

| 步          | 内容                                                                                                                                   | 位置                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 基础        | `SkillDefinition` / `validateSkill` / `parseSkills`；store key `skills`；IPC `skills-list` / `skills-set`；Settings「扩展」SkillsPanel | `src/shared/skills.ts`、`src/main/ipc.ts`、Settings           |
| agent 集成  | `skill__<name>` 工具定义进 `runAgentLoop`；`runToolCalls` 技能分支；**无条件审批**；内容注入工具结果                                   | `src/main/agent.ts`（或 chat-loop 工具路径）、单测 skill 相关 |
| review 加固 | skills IPC 硬化 + decision 可测                                                                                                        | commit `9137e3e`                                              |

**未做**：`skills-loader` 目录扫描；UAT「已安装 skills 展示」步骤。

### 2.3 0.3.0 M2 i18n（2026-08-01）

| 步       | 内容                                                                                                                             | 位置                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 基建     | i18next + react-i18next；`shared/locale.ts`；`src/renderer/i18n/index.ts`；Settings 语言选择持久化 store `locale`                | `0cf1a6f`                              |
| 全量迁移 | Settings（模型/工作区/扩展/MCP/技能/漏斗/日志/诊断）、ChatView/MessageInput、KeyboardHelp（17 条 `descKey`）；zh/en key 成对单测 | `2a3fd4e`                              |
| 工具     | `scripts/scan-hardcoded-zh.mjs` 扫描剩余硬编码中文                                                                               | 报告 App 状态消息/模式标签等为后续清单 |
| UAT      | 语言切换步骤（en 标题 Settings 再切回）                                                                                          | `tests/electron-uat.mjs`               |

**未做**：`App.tsx` 状态栏文案、模式标签等剩余硬编码抽干净；扫完后 UAT 全量再跑一次落档。

### 2.4 UI 定稿序列（2026-08-01 晚，同一作者线）

按时间：

1. `ff07ca7` — 设计系统抛光：阴影双层、radius、focus-visible、Sidebar/消息/Settings 圆角间距
2. `5cd7d64` — **短暂 dark-first**（Cursor 风格默认深色，`html.light` 变体）
3. `8b5b3eb` — 布局 rework：会话行、assistant 消息卡片、居中列 860px / body 720px、composer 悬浮圆角
4. **`857cbee`（HEAD）— 回滚 light-first + 去掉启动自动 onboarding**
   - `globals.css`：浅色默认（Apple 白 + `#0071E3`），深色仅 `html.night`
   - `App.tsx`：`theme` 默认 `"light"`；`classList.toggle("night", theme === "night")`；store 仅在 `"night"` 时切深色
   - **不再**因 `isFirstRun` 自动 `setOnboarding("welcome")`；仍打 `app_launch` ret 0/1
   - Welcome / ApiKeyWizard **组件与 Settings「重开引导」入口保留**（`onReopenWelcome` → `setOnboarding("welcome")`）
   - 视觉基线 `tests/screenshots/baseline-light.png` / `baseline-night.png` 已按 light-first 更新

### 2.5 重要决策（必须遵守）

1. **主题最终 light-first** — 中间 dark-first 实验已回滚；不要在无产品决策下再把默认改回 night。
2. **启动不自动 onboarding** — 面向专业用户直达主界面；引导仅手动从设置重开。
3. **skills / MCP 工具一律审批** — 任意 prompt / 外部工具视为注入与 mutates 载体。
4. **校验逻辑放 `src/shared/`** — main 只做 adapter；Vitest 零 Electron mock。
5. **不 `npm audit fix --force`** — 会把 electron-builder 降到 22.x。
6. **不 React.lazy 插件** — 只 lazy 组件（含 MarkdownContent）。
7. **搜索不引入 Fuse.js** — 子串匹配足够。
8. **secure-storage**：`decryptStringAsync` 字段是 **`result`** 不是 `plainText`；encrypt/decrypt 同一 async/sync 路径。
9. **开源优先已评估**：i18next 复用；skills 自建（与审批/工作区深度耦合）；MCP 复用官方 SDK。见 `OPEN_SOURCE_REVIEW.md` / `ROADMAP_0.3.0.md`。
10. **语言栈不重构**（不迁 Tauri 等）— 见 overview 差距矩阵结论。

### 2.6 验证结果（最近一次完整证据）

```
# 2026-08-01 落档 tests/verification-result.txt
build: PASS
unit:  170 passed
smoke: mock ask streaming / edit+regenerate / agent approval+patch + Electron smoke PASS
UAT:   21/21 PASS
FULL VERIFICATION: ALL PASS

# i18n 全量迁移 commit 声明（2a3fd4e）
172 tests / typecheck / lint / build 全绿（此后 UI 提交未宣称改测试数）
# 当前 tests/unit.test.ts 约 172 个 it/test 调用（待确认：下一会话应先 npm test 校准数字）
```

**待确认**：HEAD `857cbee` 之后**未**重新跑 `verify-full` 落新证据；下一会话应用 `npm run verify` 或 `node tests/verify-full.mjs` 刷新。

---

## 3. 当前状态

### 阶段

- **产品代码**：可本地 dev / package:win；功能完整度接近 0.2.0 发布候选 + 0.3.0 半成品（skills/i18n）。
- **发布**：**未**正式 0.2.0（无 remote、无签名、无真实 Key 发布级 E2E 证据）。
- **文档**：`INTEGRATED_OVERVIEW.md` / `RESIDUAL_RISKS.md` 主体停在 2026-07-31；**以本 HANDOFF + ROADMAP_0.3.0 + git log 为准补 8 月增量**。

### 正常工作（预期）

- 主界面直达（无自动欢迎页）
- light / night 切换与持久化（默认 light）
- 聊天流式、停止（Esc）、编辑再生成、Ctrl+F、命令面板、设置全 tab
- MCP / Skills 配置与 agent 工具路径（审批）
- i18n 设置/聊天/帮助核心文案
- 布局：侧栏会话、消息卡片、居中列、悬浮 composer
- 门禁脚本与 mock E2E / UAT 框架

### 未完成

| ID           | 优先级  | 内容                                                                       |
| ------------ | ------- | -------------------------------------------------------------------------- |
| M1-LOADER    | P1      | skills 目录扫描 loader + 安装展示 UAT                                      |
| M2-REST      | P1      | `scripts/scan-hardcoded-zh.mjs` 扫出的 App 状态/模式等硬编码 → t()         |
| VERIFY-HEAD  | P1      | 对 HEAD 重跑 verify / verify-full 并更新 `verification-result.txt`         |
| DOCS-SYNC    | P2      | 同步 overview / residual risks 到 0.3.0 + light-first + no auto-onboarding |
| UAT-E2E-REAL | P1 外部 | 真实 API Key 全链路                                                        |
| SIGNING      | P1 外部 | 代码签名证书 + Secrets                                                     |
| CI-REMOTE    | P2 外部 | 建仓 + `git remote add` + push，Actions 首绿                               |
| MAC-LINUX    | P3      | 真机构建 smoke                                                             |
| DEAD-CODE?   | P3      | Welcome/ApiKeyWizard 仍 lazy 保留（设置可重开）— **非死代码**，勿删        |

### 已知问题 / 阻塞

1. **无 git remote** — 无法 push / 远端 CI / GitHub Release。
2. **无代码签名** — SmartScreen；auto-update 发布链不完整。
3. **dev audit high** — 开发链 electron-builder/eslint 传递依赖；prod `audit --omit=dev` = 0。
4. **文档漂移** — overview 仍写 skills ❌、门禁 164 tests 等旧数字。
5. **smoke/UAT 仍防御性跳过欢迎页** — 与「不再自动弹出」兼容（`isVisible` 才 skip）；若将来删组件需改测试文案。
6. **偶发**：`npm install` 后立刻 `npm run dev` 可能 Vite exit 3 — 重试或清 cache。
7. **IPC 限流**：1s 内 >30 store-set/chat-stream 丢弃（日志 `IPC rate limited`）。

### 报错条件（历史已修，勿回退）

- `decryptStringAsync` 取 `plainText` → API Key 静默丢 → 必须用 `result`
- ESM 下错误 `require("electron-updater")` 未 external
- MessageBubble 条件 return 后加 hooks → Rules of Hooks 崩
- `beginAbortScope` 在 aborted 后换新 controller → 停止按钮失效
- shell-policy 解释器 `-c` 用错非回溯正则 → `sh -lc` 漏匹配

---

## 4. 下一步行动计划

### 1. 最高优先：校准 HEAD 门禁（30–90 min）

```bash
cd "C:/Users/C/dave客户端开发"
git status          # 应仅见未跟踪 CLAUDE.md（或按用户意图处理）
npm run verify      # format + lint + 双 tsc + coverage + build
# 或一键：
node tests/verify-full.mjs
```

- **成功标准**：exit 0；单测数写入本文件/overview；UAT 全过；视觉 diff 若跑需与新基线一致。
- **依赖**：无。应在任何功能开发前完成。

### 2. 收口 0.3.0 M2 剩余硬编码（0.5–1 天）

```bash
node scripts/scan-hardcoded-zh.mjs
```

- 将 App 状态消息、模式标签等纳入 `src/renderer/i18n` zh/en，保持 key 成对单测。
- 跑 UAT 语言步骤 + verify。
- **成功标准**：扫描脚本无关键路径告警（或白名单仅剩故意中文测试夹具）。

### 3. 0.3.0 M1 skills-loader（1–2 天，可与 2 并行文件面小）

- 设计：目录扫描纯函数 + IPC 只读列表；**写入仍走 `skills-set` 校验**；工具仍一律审批。
- UAT 追加「扩展 tab 已安装 skills」。
- **不要**引入未评估的通用 skills 市场协议重写。

### 4. 文档台账同步（并行，数小时）

- 更新 `INTEGRATED_OVERVIEW.md`：skills/i18n 状态、light-first、无自动 onboarding、测试数、HEAD。
- 更新 `RESIDUAL_RISKS.md` 日期与 0.3.0 项。
- 保持 `ROADMAP_0.3.0.md` 勾选与实现一致。

### 5. 外部依赖（阻塞发布，非代码可独自完成）

1. 配置 git remote + 凭据 → push → CI 首绿
2. 采购 Windows 签名 → `WIN_CSC_*` Secrets → tag 触发 release
3. 真实 API Key 跑通发消息→流式→编辑→批准并留证据
4. 有机器后 macOS/Linux package + smoke

**依赖关系**：1 校准 → 2/3 功能收口 → 4 文档 → 5 发布。2 与 3 可并行。

---

## 5. 踩坑记录（重要）

| 坑                             | 原因                        | 不要再做                                                      |
| ------------------------------ | --------------------------- | ------------------------------------------------------------- |
| 默认改 dark-first 又改回       | 产品最终要浅色专业风        | **以 `857cbee` light-first 为准**；改主题先改基线与 UAT       |
| 启动强制 Welcome               | 转化漏斗假设 vs 专业用户    | **禁止**恢复自动 `setOnboarding("welcome")`，除非产品书面改回 |
| 删 Welcome 组件当死代码        | 设置仍 `onReopenWelcome`    | 保留 lazy 组件与手动入口                                      |
| `require is not defined`       | type:module + CJS           | 主进程 dynamic require 必须 external                          |
| React.lazy(remark 插件)        | 插件非 Component            | 只 lazy 组件                                                  |
| hooks 在 MessageBubble 早退后  | Rules of Hooks              | 流式节流放独立子组件                                          |
| rehype-sanitize 类型           | 工厂签名不兼容              | `[rehypeSanitize as never, schema as never]`                  |
| dual tsconfig 漏跑             | main 不在 renderer 工程     | 只用 `npm run typecheck` / `verify`                           |
| `audit fix --force`            | builder 降级 22             | 仅 `audit --omit=dev` 门禁                                    |
| secure-storage `plainText`     | Electron 42 字段名 `result` | 见 `src/main/secure-storage.ts` 注释                          |
| MCP content 类型 `{}`          | SDK 推断                    | 显式 `as Array<{type?:string;text?:string}>`                  |
| abort 后换新 signal            | 停止失效                    | `beginAbortScope` 见 aborted 则复用旧 signal                  |
| deleteSession 不 abort runtime | Map 泄漏                    | 必先 `sessionRuntime.abortSession`                            |
| 搜索关后 Ctrl+↑ 高亮残留       | 未 reset nav                | closeSearch 清 `navCursor`                                    |
| 全局快捷键抢 IME               | 合成期 keydown              | `e.isComposing \|\| e.keyCode===229` 早退                     |
| shell `-c` 正则                | 可选组不回溯                | 用 `-[a-zA-Z0-9]*-?c\b`                                       |
| verify-full 不 build           | smoke 验旧 out/ 假绿        | STEPS 必须先 build（已修于 `b81f3b1`）                        |
| smoke close 挂起               | playwright 管道             | teardown 超时 force kill                                      |
| 色彩硬编码                     | 漂移                        | 只用 `var(--*)`；night 只覆盖变量                             |
| 文档当唯一真相                 | overview 过期               | **以 git HEAD + 本 HANDOFF + 实测命令为准**                   |

### 特殊配置 / 隐藏依赖

- 主/preload：`format:"cjs"` + `interop:"auto"`；`external: ["electron","electron-updater"]`
- 测试隔离：`DAVE_TEST_USER_DATA`、`DAVE_TEST_MOCK_PROVIDER=1`
- store 白名单：`src/shared/store-policy.ts`（含 `skills` / `mcp-servers` / `locale` 等）
- IPC 注册 / tray：模块级幂等 guard（electron-vite CJS-shim 可能重跑）
- `lifecycle.ts` 拆 quit 标志，避免 circular import 双执行
- Windows auto-launch：shortcut + `.dave-sentinel` 双条件
- 视觉：`tests/electron-visual-diff.mjs` + pixelmatch；基线已随 light-first 更新
- Skill 路由（用户全局）：`python "C:/Users/C/.zcode/skills/skills/do.py" "<需求>" --top=3`

### 关键路径速查

```
src/main/{index,ipc,agent,chat-loop,secure-storage,session,session-runtime,mcp-client,diagnostics}.ts
src/shared/{skills,locale,shell-policy,store-policy,rate-limit,message-search,session-edit,mcp,telemetry}.ts
src/renderer/App.tsx                 # 主题默认 light；onboarding 默认 off；设置可重开引导
src/renderer/styles/globals.css      # light-first 设计系统 SSOT
src/renderer/i18n/index.ts           # zh-CN / en 资源
src/renderer/components/{Settings,ChatView,MessageList,MessageInput,Sidebar,Welcome,ApiKeyWizard}.tsx
tests/{unit.test.ts,electron-smoke.mjs,electron-uat.mjs,verify-full.mjs,verification-result.txt}
scripts/scan-hardcoded-zh.mjs
ROADMAP_0.3.0.md · INTEGRATED_OVERVIEW.md · RESIDUAL_RISKS.md · AGENTS.md · CLAUDE.md
```

---

## 6. 新对话启动指南

写给下一位 AI（无聊天记录）：

### 开始前检查

1. `pwd` / 工作区 = `C:\Users\C\dave客户端开发`
2. `git status` · `git log -8 --oneline` · `git remote -v`（预期无 remote）
3. **读本文件全文** + `CLAUDE.md`/`AGENTS.md` gotcha + `ROADMAP_0.3.0.md`
4. 不要把 2026-07-31 的 overview 数字当当前真理

### 第一件操作

```bash
npm run verify
# 或 node tests/verify-full.mjs
```

全绿后再改功能。需要 GUI：`npm run dev` 或 `npm run test:electron`。

### 不要重新调查 / 不要重复做

- 不要重做 IPC 白名单、safeStorage 字段修复、虚拟列表、Markdown lazy、mock E2E 骨架、MCP 接入、skills 基础 IPC、i18n 基建
- 不要把默认主题改回 dark-first
- 不要恢复启动自动 onboarding
- 不要 `audit fix --force`、不要 Fuse.js、不要 lazy 插件、不要在 MessageBubble 早退后加 hooks
- 不要假设已有 git remote 或签名证书
- 不要删除 Welcome/ApiKeyWizard（设置仍依赖）
- 不要从零发明 skills 市场协议；先读现有 `skills.ts` + agent 分支

### 推荐工作顺序

1. 校准 verify 并更新证据文件
2. `scan-hardcoded-zh` → 收 M2
3. skills-loader → 收 M1
4. 文档台账
5. 仅在用户提供 remote/证书/Key 时做发布与真实 E2E

### 用户约束（会话级，持续有效）

- 不保留向后兼容：过时直接删，不加 migration/fallback
- 最简实现，无预防性抽象
- 先最小端到端再加层
- 优先成熟开源；先查现有依赖
- 架构决策做长，拒绝「以后再换」临时方案

### 未跟踪文件

- `CLAUDE.md`：项目 Agent 指南副本（内容与 gotcha 长文一致）；**是否入库待用户确认**，勿擅自 `git add` 全盘提交除非用户要求。

### 粘贴续工提示（可选）

```
【工作目录】C:\Users\C\dave客户端开发
【HEAD】857cbee master · light-first · 无自动 onboarding · 无 remote
【必读】HANDOFF.md（2026-08-05）
【先跑】npm run verify
【优先】①校准门禁 ②i18n 剩余硬编码 ③skills-loader ④文档同步
【禁止】dark-first 默认、自动欢迎页、audit fix --force、删 Welcome
```

---

**交接完整度**：代码状态、决策、坑、命令、路径、优先级已写入。  
**不确定已标「待确认」**：HEAD 后最新全量测试精确计数与 verify-full 新证据需实测刷新。
