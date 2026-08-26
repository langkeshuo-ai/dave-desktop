# 一键推进提示词

> 复制下方提示词发给本地 Agent（Claude Code / Cursor / Copilot 等），即可按当前整合方向继续推进。

---

## 提示词（直接复制）

```
你是 Dave Desktop 项目的本地开发 Agent。当前正在执行「7仓库整合为 Dave 统一产品」的收尾工作。

【项目】dave-desktop（Electron 42 + React 19 + TypeScript，公开仓库）
【核心目标】将 zcode-client 的功能合并到 dave-desktop，以 Dave 为统一品牌

【必读文档】（按顺序）
1. HANDOFF.md — 项目本身交接（0.2.0/0.3.0 状态、踩坑记录、验证命令）
2. INTEGRATION_HANDOFF.md — 整合工作交接（46个新增文件、P0-P4待办、代码结构）
3. docs/merge/desktop-merge-plan.md — 6阶段合并执行计划

【已完成】云端已通过 GitHub API 创建 52 个文件：
- 安全模块 4 个（ipc-guard/tool-capability/rpc-hub/browser-policy）
- 功能模块 7 个（paths/checkpoints/skills-manager/plugin-manager/usage-tracker/updater-service/marketplace-client）
- 引擎适配层 1 个（sdk-adapter.ts）
- 测试文件 10 个（235+ 用例）
- 配置系统 4 个（dave 仓库 packages/shared/src/config/）
- 计划/品牌/交接文档等

【第一步】立即执行：
cd dave-desktop && npm install && npm run typecheck

【优先任务】（按顺序）
P0: 修复 typecheck 错误 → npm test 跑通 235+ 测试 → npm run lint → npm run build
P1: 重构 src/main/ipc.ts，接入 createIpcSecurity().handle() 增强现有校验（不要破坏现有功能）
P1: 为 7 个功能模块注册 IPC handler（checkpoints/skills/plugins/usage/marketplace/updater）
P2: Renderer 端创建 API 封装 + UI 面板（技能/检查点/插件/市场）
P3: dave 仓库发布 @dave/sdk + @dave/shared，dave-desktop 安装并完善 sdk-adapter.ts

【禁止】
- 不要覆盖 HANDOFF.md（项目本身交接，与 INTEGRATION_HANDOFF.md 并存）
- 不要删除现有功能或 Welcome/ApiKeyWizard 组件
- 不要把默认主题改回 dark-first（当前是 light-first）
- 不要恢复启动自动 onboarding
- 不要 npm audit fix --force（会降级 electron-builder）
- 不要在未跑通测试的情况下继续创建新模块

【技术栈】Electron 42 · electron-vite 5 · React 19 · TS 5.8 · Tailwind 4 · Zustand 5 · Vitest 3.2.6 · i18next 26
【验证命令】npm run typecheck（双 tsconfig）→ npm test → npm run lint → npm run build
【测试框架】Vitest，新测试用 vi.mock("electron", ...) 方式 mock

开始执行 P0，遇到问题先读 HANDOFF.md 的踩坑记录。
```

---

## 使用说明

1. 打开本地 Agent（Claude Code / Cursor / Copilot 等）
2. 确保工作目录在 `dave-desktop` 仓库根目录
3. 复制上方提示词，粘贴发送
4. Agent 会自动按 P0→P1→P2→P3 顺序推进

## 变体提示词

### 只做验证（快速检查）
```
cd dave-desktop，执行 npm install → npm run typecheck → npm test → npm run lint → npm run build，
报告每一步的结果和需要修复的问题。不要修改代码，只报告。
```

### 只做 ipc.ts 集成
```
cd dave-desktop，先读 INTEGRATION_HANDOFF.md 的 P1 部分和 src/main/security/index.ts，
然后重构 src/main/ipc.ts，用 createIpcSecurity().handle() 增强现有 IPC 校验。
改完跑 npm test 和 npm run dev 手动验证。
```

### 只做功能模块 IPC 注册
```
cd dave-desktop，先读 INTEGRATION_HANDOFF.md，然后为 7 个功能模块
（checkpoints/skills/plugins/usage/marketplace/updater/paths）在 ipc.ts 中注册 IPC handler。
每个模块 2-4 个 channel，保持与现有 ipc.ts 风格一致。
```
