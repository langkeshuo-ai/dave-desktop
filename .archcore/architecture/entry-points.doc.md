---

type: doc
title: Entry-point inventory
status: accepted
tags: \[entry-points, architecture]
-----------------------------------

# 入口点清单

## CLI / Desktop

- src/main/index.ts —— Electron 主入口：单实例锁、窗口创建、启动注册推送通道契约（registerChatStreamPushChannels）。

## IPC（renderer → main，invoke）

- src/main/ipc.ts —— registerIpcHandlers：会话/聊天/工作区/遥测/设置/市场/插件/更新等全部 handler 注册点；chat-stream 入口 handleChatStream；marketplace:upgrade 走 security.handle + marketplaceUpgrade schema。

## 协议/服务（main 侧）

- src/main/chat-loop.ts —— 会话编排与流式推送（pushWithGuard 出口）。

- src/main/session-runtime.ts —— 生命周期域：abort/审批门（权限接口非 IPC）。

- src/main/security/ipc-guard.ts —— IPC 安全与推送契约（createIpcSecurity / registerPushChannel / pushWithGuard）。

- src/main/marketplace/marketplace-client.ts —— 插件市场客户端（install/uninstall/upgrade/update；upgradePlugin 失败回滚 installed.json）。

- src/main/plugins/plugin-manager.ts —— 插件生命周期（discover/load/unload/reportFailure/reportSuccess；连续失败 3 次自动禁用）。

- src/main/skills/skills-manager.ts —— 技能目录扫描 loader（listSkills/readSkill/systemPrompt；readSkill 与目录过滤走 SKILL\_NAME\_RE 白名单防路径穿越）。

## Shared 纯函数（node 可单测）

- src/shared/chat-stream-state.ts —— 流式状态机。

- src/shared/chat-stream-store.ts —— 订阅式 store（useSyncExternalStore 接口）。

- src/shared/event-contract.ts —— 事件契约闭环验证（回放 + 渲染文本还原）。

- src/shared/tool-trace.ts —— 工具执行轨迹纯函数（role:"tool" 消息 → 状态推导 ok/denied/failed + 幂等聚合）。

## Renderer（React）

- src/renderer/main.tsx / App.tsx —— React 挂载 + 布局外壳（light-first，Activity Bar 40px + 侧栏 260px；settingsOpen 状态挂载 Settings）。
- src/renderer/components/ChatView.tsx —— 流式聊天视图（store + useChatStreamBridge 消费 IPC 推送事件；done 后补拉聚合工具轨迹）。
- src/renderer/components/ApprovalCard.tsx / PatchPreviewCard.tsx / ExecTraceCard.tsx —— 审批卡 / patch 可视化 / 执行轨迹卡（A2'）。
- src/renderer/components/Sidebar.tsx / ActivityBar.tsx / MessageBubble.tsx / MessageInput.tsx —— 侧栏/活动栏/消息组件。
- src/renderer/components/Settings.tsx —— 设置面板（模型/工作区/扩展/日志/关于 五 tab，全部经 window.dave.* IPC 契约）。

## HTTP（本地静态预览）

- frontend-preview/server.mjs —— 最小静态服务器（:5177），服务前端原型。

## 测试入口

- tests/frontend-preview\.e2e.mjs —— 前端原型 E2E 门禁（18 项 named-risk）。

- tests/chat-stream.e2e.mjs —— 真实会话 E2E 门禁（Electron + mock provider：ask 流式/落库/agent 审批）。

- tests/verify-full.mjs —— 一键全量：build → unit → chat:e2e → preview:e2e（矩阵见 tests/V0\_4\_GATES.md）。

## 已删除（v0.4，勿恢复）

- tests/electron-smoke.mjs / electron-uat.mjs —— 面向旧 renderer UI，已被 chat:e2e + preview:e2e 取代。
