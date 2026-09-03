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
- npm run verify —— 门禁：format:check + lint + typecheck + test:coverage + build。
- npm test —— Vitest 全量单测（277 个）。
- npm run preview:ui —— 前端原型静态服务（http://localhost:5177/）。
- npm run preview:e2e —— Playwright 前端原型 E2E 门禁（18 项，需 chromium）。
- npm test:electron —— 构建后跑 electron-smoke（mock 全链路）。
- npm run package:win —— electron-builder 打包（dist / dist-v7）。

首次跑 preview:e2e 前需安装浏览器：npx playwright install chromium。