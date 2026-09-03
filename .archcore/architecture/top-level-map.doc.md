---

type: doc
title: Top-level domain map
status: accepted
tags: \[top-level-map, architecture]
------------------------------------

# 顶层域图谱

| 域               | 路径              | 说明                                                                               |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------- |
| main             | src/main/         | 主进程：编排、生命周期、安全、会话、技能、插件、市场、多代理、遥测                 |
| shared           | src/shared/       | 纯函数共享层：状态机、契约、限流、policy、i18n 基建                                |
| preload          | src/preload/      | contextBridge 暴露 window\.dave（IPC 白名单面）                                    |
| renderer         | src/renderer/     | React 层：App/ChatView/Settings(五 tab)/Sidebar/ActivityBar/消息组件，i18n zh/en   |
| tests            | tests/            | 单测 + chat:e2e(4 场景) + preview:e2e(18) + electron-uat(6) + verify-full 门禁矩阵 |
| scripts          | scripts/          | scan-hardcoded-zh.mjs / scan-ipc-consistency.mjs 等工程门禁                        |
| frontend-preview | frontend-preview/ | 前端设计与交互原型（静态，带 E2E 验证）                                            |

## 关注点

- 会话处理的推送契约与状态机在 shared/main 边界已完整落地并有门禁（**477 unit** + 门禁矩阵：chat:e2e 4 + preview:e2e 18 + uat 6，2026-09-03）。

- IPC 契约单一真相源：main 全部 handler 走 security.handle + zod schema；推送走 pushWithGuard/registerPushChannel；
  `scripts/scan-ipc-consistency.mjs` 静态核查 preload↔main 双向缺口（MISSING/DEAD 归零门禁，已入 verify-full）。

- 领域钻取：改 src/main/\*\* 先看 ipc-guard 与 chat-loop；改 shared 状态机先跑 npm test 对应用例；改前端先跑 npm run preview:e2e；改 IPC 通道先跑 scan-ipc-consistency。
