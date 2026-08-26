# Dave Brand — 品牌说明

> 本仓库是 **Dave（戴夫）** 产品矩阵的一部分。

## 品牌定位

**Dave Desktop** 是 Dave 产品矩阵的桌面端 AI Agent 应用。

| 产品 | 仓库 | 定位 |
|------|------|------|
| **Dave CLI** | dave | 终端原生 AI 编码助手 |
| **Dave Desktop** | dave-desktop（本仓库） | AI Agent 桌面应用，Electron + React |
| **Dave Engine** | dave/packages/sdk | 核心引擎 SDK |
| **Dave Lab** | zlagent | 自进化 Agent 实验分支 |

## 与 Dave CLI 的关系

Dave Desktop 和 Dave CLI 共享同一套核心引擎（Dave Engine）和配置格式（`.dave/config.jsonc`）。
当前 Desktop 使用独立的 Agent 实现，正在逐步迁移到共享的 `@dave/sdk`（见 `docs/engine/engine-integration-plan.md`）。

## 安全架构

本仓库已从 zcode-client 迁移了完整的安全架构（见 `src/main/security/`）：
- `ipc-guard` — IPC 传输层安全（发送者验证、payload 递归检查、zod schema、路径信任根）
- `tool-capability` — 工具能力授权（HMAC-SHA256 一次性令牌）
- `rpc-hub` — JSON-RPC 2.0 应用层路由

## 协议

MIT License
