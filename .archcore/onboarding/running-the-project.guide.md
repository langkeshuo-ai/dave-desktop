---
type: guide
title: Running the project locally
status: accepted
tags: [onboarding]
---

# 本地运行

前置：Node.js（package.json engines）。

- npm run dev —— 启动 electron-vite 开发模式。
- npm run build —— 构建到 out/。
- npm run verify —— 静态门禁：format:check + lint + typecheck + test:coverage + build。
- npm test —— Vitest 全量单测（**477 个**）。
- node scripts/scan-ipc-consistency.mjs —— IPC 契约双向一致性门禁（preload↔main MISSING/DEAD 归零）。
- node tests/verify-full.mjs —— **一键全量门禁（发布候选）**：ipc-consistency → build → unit → chat:e2e → preview:e2e → uat。
- npm run chat:e2e —— 真实会话 E2E（构建后启动 Electron + mock provider，4 场景：ask/落库/agent 审批/重启恢复/设置面板）。
- npm run chat:e2e:real —— 真实 provider 全链路（需 `DAVE_REAL_API_KEY`；无 key 自动 SKIP）。
- npm run preview:ui —— 前端原型静态服务（http://localhost:5177/）。
- npm run preview:e2e —— Playwright 前端原型 E2E 门禁（18 项，需 chromium）。
- node tests/electron-uat.mjs —— 新链 UAT（设置面板/技能增删/持久化，6 场景）。
- npm run package:win —— electron-builder 打包（默认 dist/；`electron-builder.v7.config.ts` → dist-v7；`electron-builder.v8.config.ts` → dist-v8 隔离产物）。

首次跑 preview:e2e 前需安装浏览器：npx playwright install chromium。

详细门禁矩阵见 `tests/V0_4_GATES.md`；全量门禁顺序与账目见 `tests/verify-full.mjs`。