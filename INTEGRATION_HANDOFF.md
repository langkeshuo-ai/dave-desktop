# INTEGRATION_HANDOFF — 仓库整合工作交接指南

> 创建日期：2026-08-26
> 交接方：GitHub 远程整合 Agent
> 接收方：本地开发 Agent（Claude Code / Cursor / Copilot 等）
> 核心仓库：langkeshuo-ai/dave-desktop
> 配套文档：`HANDOFF.md`（项目本身交接，2026-08-05）+ `docs/merge/desktop-merge-plan.md`

---

## 0. 这是什么

对 GitHub 账号 `langkeshuo-ai` 的 **7 个仓库**进行了深度盘点和整合，核心方向是**以 Dave 为统一品牌，将 zcode-client 合并到 dave-desktop，dave 作为核心引擎，zlagent 作为 Dave Lab 实验分支**。

已通过 GitHub API 创建了 **46 个文件**（安全模块、功能模块、配置系统、测试、计划文档），**剩余工作需要在本地开发环境执行**（typecheck/test/ipc.ts 集成/Renderer UI）。

> **注意**：本文件只覆盖"仓库整合"相关的新增工作。项目本身的交接信息（0.2.0/0.3.0 状态、踩坑记录、验证命令）请看 `HANDOFF.md`。

---

## 1. 仓库全景与处置

| 仓库             | 类型                       | 状态            | 处置                            |
| ---------------- | -------------------------- | --------------- | ------------------------------- |
| **dave**         | 私有, TS monorepo 259MB    | 活跃            | 核心引擎，保留                  |
| **dave-desktop** | 公开, Electron 42+React 19 | 活跃            | **整合目标**，吸收 zcode-client |
| **zcode-client** | 私有, Electron 43          | 2026-08-05 冻结 | 内容已迁移，待归档              |
| **zlagent**      | 私有, Python 自进化 Agent  | 活跃            | Dave Lab 实验分支，不合并代码库 |
| **ZCodeProject** | 私有, 备份项目             | 停滞            | 内容已迁移，待归档              |
| **WinPaste**     | 私有, Tauri 剪贴板工具     | 稳定维护        | 独立维护，不整合                |
| **dsh-codex**    | 私有, 4KB 空壳             | 空              | 待删除（用户延后）              |

---

## 2. 已完成：46 个新增文件

### 2.1 dave-desktop（23 个文件）

#### 安全架构（6 个文件，80+ 测试）

```
src/main/security/
├── ipc-guard.ts            # IPC 安全守卫（发送者验证+payload递归检查+zod schema+路径信任根）
├── tool-capability.ts      # HMAC-SHA256 一次性能力令牌（60秒TTL）
├── rpc-hub.ts              # JSON-RPC 2.0 Hub（中间件+批量请求+标准错误码）
├── browser-policy.ts       # URL协议白名单+路径受信任根+BrowserView导航+弹窗安全
├── index.ts                # 四模块统一导出
├── security.test.ts        # 综合测试 50+ 用例
└── browser-policy.test.ts  # 浏览器策略测试 30+ 用例
```

#### 功能模块（7 个文件）

```
src/main/utils/paths.ts                # 统一路径管理（Dave品牌+.zcode兼容+safeJoin防穿越）
src/main/session/checkpoints.ts        # 会话检查点（git stash+文件快照+回滚+级联回滚）
src/main/skills/skills-manager.ts      # 技能管理器（Agent Skills 1.0 发现/加载/搜索/系统提示词）
src/main/plugins/plugin-manager.ts     # 插件管理器（发现/加载/卸载+manifest验证+权限检查+IPC channel）
src/main/telemetry/usage-tracker.ts    # 本地使用统计（模型调用/Token/费用+工具频率+日聚合+7天汇总）
src/main/updater/updater-service.ts    # 自动更新服务（electron-updater+HTTPS-only feed）
src/main/marketplace/marketplace-client.ts  # 插件市场客户端（安装/卸载/更新+git clone+本地复制）
```

#### 引擎集成（1 个文件）

```
src/main/engine/sdk-adapter.ts   # @dave/sdk 适配层（agent run/abort+session+provider+tool+skill+local fallback）
```

#### 测试（5 个文件，155+ 用例）

| 文件                     | 用例数 | 覆盖                     |
| ------------------------ | ------ | ------------------------ |
| `security.test.ts`       | 50+    | 四模块综合               |
| `browser-policy.test.ts` | 30+    | 浏览器安全策略           |
| `paths.test.ts`          | 30+    | 路径工具+safeJoin        |
| `checkpoints.test.ts`    | 20+    | 检查点+回滚              |
| `skills-manager.test.ts` | 25+    | 技能发现+加载+系统提示词 |

#### 文档（3 个文件）

```
docs/merge/desktop-merge-plan.md   # zcode-client→dave-desktop 6阶段合并执行计划
docs/reference/skill-inventory.md  # 80 技能参考数据集+TypeScript 数据模型
BRAND.md                            # Dave Desktop 品牌定位
INTEGRATION_HANDOFF.md              # 本文件
```

### 2.2 dave（12 个文件）

```
packages/shared/src/config/
├── types.ts    # DaveConfig 统一配置类型（14接口+默认配置+路径常量）
├── loader.ts   # 配置加载器（多路径候选+环境变量覆盖+深度合并+JSONC+缓存单例）
├── paths.ts    # 配置路径解析器（.dave/.mimocode/.zcode/.claude兼容+迁移检查）
└── index.ts    # 配置模块统一导出

.dave/config.jsonc                        # 完整配置示例（3 providers+agent+权限+记忆+技能+插件+MCP+UI）
scripts/evolution/dave-growth-cycle.py    # 9维技能评分+进化补丁+备份回滚+审计清单
.mimocode/prompts/engineer-essence.md     # 工程师人格 prompt
docs/security/audit-methodology.md        # 通用安全审计方法论（10种密钥模式+P0/P1/P2分级）
docs/engine/engine-integration-plan.md    # dave SDK↔dave-desktop 5阶段打通方案
docs/brand/brand-unification.md           # 品牌统一方案（Dave产品线+@dave/*命名空间）
BRAND.md                                   # Dave 品牌定位+技术来源+命名空间规范
```

### 2.3 zlagent（7 个文件）

```
src/knowledge/graph.py                         # 知识图谱实现（Node/Edge/GraphStore，8+8类型，全文搜索，JSON持久化）
docs/design/knowledge-graph-schema.md          # 结构化知识图谱数据模型
docs/design/predictive-evolution.md            # 预测性进化设计（10项指标+线性回归+三级告警）
docs/design/three-layer-architecture.md        # L1路由/L2进化/L3记忆三层架构
docs/integration/zlagent-integration-path.md   # Dave Lab定位+4阶段整合路径
docs/integration/standard-alignment.md         # zlagent↔Dave标准对齐文档
BRAND.md                                        # Dave Lab(zlagent)品牌定位
```

### 2.4 其他仓库（4 个文件）

```
zcode-client/ARCHIVE_CHECKLIST.md   # 归档检查清单（12项已迁移+8项待确认+迁移映射表）
ZCodeProject/ARCHIVED.md             # 仓库归档说明（7项已迁移清单+恢复方式）
WinPaste/MAINTENANCE.md              # v1.6.1 维护状态（224测试/0 issues+短中长期计划）
```

---

## 3. 待办事项（按优先级）

### P0 — 必须先做（验证新代码不破坏现有构建）

1. **克隆仓库并安装依赖**

   ```bash
   git clone https://github.com/langkeshuo-ai/dave-desktop.git
   cd dave-desktop
   npm install
   ```

2. **运行 typecheck，修复类型错误**

   ```bash
   npm run typecheck
   ```
   - 新模块可能有类型错误（import 路径、类型不匹配）
   - 重点检查 `src/main/security/`、`src/main/utils/paths.ts`、`src/main/engine/sdk-adapter.ts`
   - `sdk-adapter.ts` 中 `import { getConfig } from "../../../shared/config"` 可能需要调整路径或暂时注释（`@dave/shared` 尚未发布）

3. **运行测试，确保 155+ 用例通过**

   ```bash
   npm test
   # 或只跑新模块测试
   npx vitest run src/main/security/ src/main/utils/paths.test.ts src/main/session/checkpoints.test.ts src/main/skills/skills-manager.test.ts
   ```
   - 项目已用 Vitest 3.2.6（见 HANDOFF.md）
   - 测试中 mock 了 electron 模块，如果 mock 方式不对需要调整

4. **运行 lint + build**
   ```bash
   npm run lint
   npm run build
   ```

### P1 — 核心集成（让新模块真正生效）

5. **重构 `src/main/ipc.ts`，接入安全模块**
   - 当前 `ipc.ts` 已有基础的 `validateSender` + 速率限制 + store key 白名单（见 HANDOFF.md 2.1）
   - 目标：用 `createIpcSecurity().handle()` 增强现有校验
   - 步骤：
     1. 阅读现有 `ipc.ts` 完整内容
     2. 阅读 `src/main/security/ipc-guard.ts` 的 API
     3. 在 `ipc.ts` 顶部 `import { createIpcSecurity } from "./security"`
     4. 创建 `const ipcSecurity = createIpcSecurity({ allowedOrigins: [...] })`
     5. 对高风险 channel 用 `ipcSecurity.handle(channel, handler)` 包装
     6. 保留现有白名单逻辑，不要破坏现有功能
     7. **这是核心运行时文件，改完必须跑完整测试和手动验证**

6. **功能模块接入 IPC handler**
   - 为每个功能模块创建 IPC channel（在 `ipc.ts` 中注册）：
     - `checkpoints:create` / `checkpoints:list` / `checkpoints:previewRewind` / `checkpoints:executeRewind`
     - `skills:list` / `skills:read` / `skills:systemPrompt`
     - `plugins:list` / `plugins:load` / `plugins:unload`
     - `usage:getSummary` / `usage:export` / `usage:clear`
     - `marketplace:search` / `marketplace:install` / `marketplace:uninstall`
     - `updater:check` / `updater:install`

7. **Renderer 端创建类型安全的 API 封装**
   - 在 `src/preload/` 或 `src/renderer/api/` 中创建对应模块的 API 封装
   - 使用 `contextBridge.exposeInMainWorld`

### P2 — UI 集成（用户可见功能）

8. **技能面板 UI** — 展示已加载技能列表、技能详情、搜索
9. **检查点时间线 UI** — 展示检查点列表、回滚预览、执行回滚
10. **插件管理 UI** — 已安装插件列表、启用/禁用、卸载
11. **插件市场 UI** — 搜索、安装、更新
12. **设置面板集成** — 集成 `DaveConfig` 的配置项（模型选择、权限、记忆等）

### P3 — 引擎打通（中期）

13. **在 dave monorepo 中构建发布 `@dave/sdk` 和 `@dave/shared` 包**
14. **在 dave-desktop 中安装 `@dave/sdk`**
    ```bash
    npm install @dave/sdk @dave/shared
    ```
15. **完善 `sdk-adapter.ts`，接入真实 SDK**
    - 取消 `loadSdk()` 中的注释
    - 实现 `runAgent()` 委托给 `@dave/sdk` 的 AgentLoop

### P4 — 仓库收尾（用户手动操作）

16. **ZCodeProject 归档** — GitHub 网页端 Settings → Danger Zone → Archive
17. **zcode-client 归档** — 按 `ARCHIVE_CHECKLIST.md` 确认后归档
18. **dsh-codex 删除** — Settings → Danger Zone → Delete（用户延后）
19. **WinPaste git author 修复** — 本地 `git config` + `git filter-repo`

---

## 4. 关键文档索引（本地 agent 必读）

| 优先级  | 文档                        | 位置                           | 内容                                            |
| ------- | --------------------------- | ------------------------------ | ----------------------------------------------- |
| 🔴 必读 | HANDOFF.md                  | `dave-desktop/`                | 项目本身交接（0.2.0/0.3.0状态、踩坑、验证命令） |
| 🔴 必读 | desktop-merge-plan.md       | `dave-desktop/docs/merge/`     | 6阶段合并计划，模块对比表                       |
| 🔴 必读 | engine-integration-plan.md  | `dave/docs/engine/`            | SDK↔Desktop 5阶段打通方案                       |
| 🟡 建议 | brand-unification.md        | `dave/docs/brand/`             | 品牌统一方案，命名空间规范                      |
| 🟡 建议 | zlagent-integration-path.md | `zlagent/docs/integration/`    | Dave Lab 4阶段整合路径                          |
| 🟡 建议 | ARCHIVE_CHECKLIST.md        | `zcode-client/`                | 归档前检查清单，迁移映射表                      |
| 🟢 参考 | skill-inventory.md          | `dave-desktop/docs/reference/` | 80技能参考数据集                                |

---

## 5. 新增代码结构

### 5.1 dave-desktop 新增目录

```
src/main/
├── security/          # 🔒 安全架构（4模块+2测试）
├── engine/            # ⚙️ 引擎集成（sdk-adapter）
├── utils/             # 🔧 工具（paths + 测试）
├── session/           # 💾 会话（checkpoints + 测试）
├── skills/            # 🎯 技能（skills-manager + 测试）
├── plugins/           # 🔌 插件（plugin-manager）
├── telemetry/         # 📊 统计（usage-tracker）
├── updater/           # 🔄 更新（updater-service）
└── marketplace/       # 🛒 市场（marketplace-client）
```

### 5.2 模块间依赖

```
ipc.ts (现有，待增强)
  ├── security/ (ipc-guard → tool-capability → rpc-hub → browser-policy)
  ├── engine/sdk-adapter (→ @dave/sdk, 待接入)
  ├── session/checkpoints (→ utils/paths)
  ├── skills/skills-manager (→ utils/paths)
  ├── plugins/plugin-manager (→ utils/paths)
  ├── telemetry/usage-tracker
  ├── updater/updater-service
  └── marketplace/marketplace-client (→ utils/paths)
```

### 5.3 dave 配置系统

```
packages/shared/src/config/
├── types.ts    # DaveConfig 接口（14个接口）
├── loader.ts   # 加载器（多路径+环境变量+深度合并+JSONC+缓存）
├── paths.ts    # 路径解析器（.dave/.mimocode/.zcode/.claude 兼容+自动迁移）
└── index.ts    # 统一导出
```

---

## 6. 本地开发环境

### dave-desktop

```bash
git clone https://github.com/langkeshuo-ai/dave-desktop.git
cd dave-desktop
npm install
npm run typecheck    # 双 tsconfig
npm run lint
npm test             # Vitest
npm run dev          # 开发模式
```

### dave (monorepo)

```bash
git clone https://github.com/langkeshuo-ai/dave.git
cd dave
# 看 package.json / turbo.json，可能是 bun + turbo
bun install
bun run build
```

### zlagent

```bash
git clone https://github.com/langkeshuo-ai/zlagent.git
cd zlagent
pip install -e ".[dev]"  # 或 uv sync
pytest
# 验证知识图谱模块
python -c "from zlagent.src.knowledge.graph import KnowledgeGraph; print('OK')"
```

---

## 7. 常见问题

### Q: 新模块 import 路径报错？

A: 新模块用了相对路径 import。先跑 `npm run typecheck` 看具体错误，逐个修复。重点是 `src/main/engine/sdk-adapter.ts` 中的 `getConfig` import。

### Q: `sdk-adapter.ts` 的 `getConfig` 报错？

A: 预期的。`@dave/shared` 尚未发布。暂时注释掉 import，用本地配置替代：

```typescript
// import { getConfig } from "../../../shared/config"
function getConfig() {
  return { model: "openai/gpt-4o", provider: {} }
}
```

### Q: electron mock 在测试中失败？

A: 项目已有 Vitest + electron mock 模式。看现有测试（`tests/unit.test.ts`）的 mock 方式，保持一致。新测试用了 `vi.mock("electron", () => ({...}))`，如果项目用了不同的 mock 方式需要调整。

### Q: 怎么验证 ipc.ts 改动没破坏现有功能？

A: 1. `npm test` 全量 2. `npm run dev` 手动测试 3. 看 DevTools Console 有没有 IPC 错误。参考 HANDOFF.md 中的验证命令。

### Q: zlagent 的 graph.py import 路径不对？

A: 文件在 `zlagent/src/knowledge/graph.py`。如果 zlagent 的包结构不同，需要调整 import 路径或移动文件位置。看 zlagent 的 `pyproject.toml` 确认包名和源码目录。

---

## 8. 交接确认清单

本地 agent 接手后逐项确认：

- [ ] 已阅读 `HANDOFF.md`（项目本身交接）
- [ ] 已阅读 `desktop-merge-plan.md` 和 `engine-integration-plan.md`
- [ ] 已克隆 dave-desktop 并安装依赖
- [ ] `npm run typecheck` 通过（或已记录需修复的错误）
- [ ] `npm test` 通过（或已记录需修复的测试）
- [ ] `npm run lint` + `npm run build` 通过
- [ ] 已阅读 `src/main/security/index.ts` 了解安全模块 API
- [ ] 已阅读现有 `src/main/ipc.ts` 了解当前 IPC 结构
- [ ] 已确认测试框架为 Vitest（见 HANDOFF.md）
- [ ] 已制定 ipc.ts 增强计划

---

_本文档由 GitHub 远程整合 Agent 创建，交接给本地开发 Agent 继续执行。_
_项目本身的交接信息请看 `HANDOFF.md`（2026-08-05）。_
_整合计划细节请看 `docs/merge/desktop-merge-plan.md`。_

---

## 9. 最终状态更新（2026-08-27 本地开发 Agent 完成）

### P0-P3 全部完成

| 阶段 | 任务                                                                 | 状态    |
| ---- | -------------------------------------------------------------------- | ------- |
| P0   | typecheck 修复 → 358 测试通过 → lint → build                         | ✅ 完成 |
| P1   | ipc.ts 接入 createIpcSecurity().handle() + 31 个整合模块 IPC handler | ✅ 完成 |
| P2   | preload 30 个 API 绑定 + ExtensionsPanel（4 标签页 UI）              | ✅ 完成 |
| P3   | @dave/shared + @dave/sdk 本地集成 + sdk-adapter.ts 完善              | ✅ 完成 |

### 模块激活状态（架构审计后）

| 模块               | 状态            | 接入点                                          |
| ------------------ | --------------- | ----------------------------------------------- |
| ipc-guard          | ✅ 激活         | ipc.ts createIpcSecurity()，31 个 handler       |
| checkpoints        | ✅ 激活         | 4 个 IPC handler + preload API                  |
| skills-manager     | ✅ 激活         | 3 个 IPC handler + preload API                  |
| plugin-manager     | ✅ 激活         | 7 个 IPC handler + preload API + 单例           |
| usage-tracker      | ✅ 激活         | 5 个 IPC handler + preload API                  |
| marketplace-client | ✅ 激活         | 6 个 IPC handler + preload API                  |
| updater-service    | ✅ 激活         | 6 个 IPC handler + preload API                  |
| browser-policy     | ✅ 激活         | setWindowOpenHandler + security/index.ts 导出   |
| sdk-adapter        | ✅ 激活         | main/index.ts getSdkAdapter().initialize()      |
| ExtensionsPanel    | ✅ 激活         | App.tsx lazy import + Cmd/Ctrl+Shift+E + 模态框 |
| tool-capability    | ⚠️ 可用基础设施 | security/index.ts 导出，待接入审批流程          |
| rpc-hub            | ⚠️ 可用基础设施 | security/index.ts 导出，待统一 IPC 层           |

### 验证结果

- **typecheck**（双 tsconfig）: 0 错误
- **lint**: 0 错误
- **test**: 358 测试通过（10 文件）
- **build**: 三端构建成功
- **npm run verify**: 全部通过（format:check → lint → typecheck → test:coverage → build）

### 关键修改文件

- src/main/ipc.ts — 31 个 security.handle() 注册
- src/main/index.ts — sdk-adapter.initialize() + browser-policy + shell 导入
- src/main/security/index.ts — 导出 browser-policy
- src/preload/index.ts — 30 个新 API 方法（checkpoints/skillsFs/plugins/usage/marketplace/updater）
- src/renderer/App.tsx — ExtensionsPanel lazy import + 快捷键 + 模态框 + cbsRef 同步
- src/renderer/components/ExtensionsPanel.tsx — 4 标签页 UI（技能/检查点/插件/市场）
- src/main/engine/sdk-adapter.ts — @dave/shared/config 真实导入 + @dave/sdk 动态导入
- src/shared/telemetry.ts — 新增 extensions_opened 事件
- package.json — @dave/sdk + @dave/shared file: 依赖
- tsconfig.node.json — lib 添加 DOM（支持 @dave/sdk Fetch 类型）

### dave-cli 仓库修复（预存问题）

- packages/shared/src/config.ts — 新增 barrel 文件（修复 exports 解析）
- packages/shared/src/config/paths.ts — 移除重复 export（DAVE_CONFIG_FILENAME/DAVE_CONFIG_DIRNAME）
- packages/shared/src/config/loader.ts — deepMerge 泛型约束修复（Record → object）
- packages/sdk/js/src/gen/client/utils.gen.ts — Headers.entries() 类型断言修复

### 后续可选工作

1. tool-capability 接入 ApprovalDialog（一次性令牌授权，减少重复弹窗）
2. rpc-hub 统一 IPC 层（将零散 ipcMain.handle 迁移到 JSON-RPC）
3. sdk-adapter 深度集成（将 chat-loop 委托给 @dave/sdk AgentLoop）
4. ExtensionsPanel 集成到 Settings 标签页（替代独立模态框）

---

_本章节由本地开发 Agent 于 2026-08-27 更新，记录 P0-P3 完成及死代码处理结果。_
