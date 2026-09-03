***

type: rule
title: Project stack
status: accepted
tags: \[stack, conventions]
---------------------------

# 技术栈

Electron 42 桌面应用，electron-vite 5 构建，TypeScript 5.8 严格模式，React 19。

- 渲染层：React 19 + Tailwind CSS 4 + Zustand 5 + i18next（中文优先，可切英文）。

- 进程模型：主进程 / preload / renderer 三进程；contextBridge 暴露 window\.dave。

- 模块划分：src/main（主进程）、src/preload、src/renderer、src/shared（纯函数，node 可单测）。

- 测试：Vitest 3（node 环境）+ Playwright（前端原型 E2E 门禁）。

- 主题：light-first，暖琥珀品牌色 #D97706/#F59E0B；活动栏 40px + 会话侧栏 260px。

## 不可违反的约束

- 主进程 IPC 推送一律走 pushWithGuard（schema + 限流 + 时序守卫），禁止裸 webContents.send。

- 流式聊天事件必须经 chat-stream-state 状态机（start/chunk/done 受守卫；tools/approval/patch/error 豁免守卫）。

- 状态所有权显式分片：渲染 Zustand 管会话域、主进程 session-runtime 管生命周期域、chat-loop 管编排域。

- 幂等 key 是会话命名空间化的，禁止改回全局去重。

- 不留向后兼容层；过时实现直接删除。

