# Dave Desktop

> **定位:** 本地 Agent · Cursor 风格 UI · Codex 工具集 · 四种批准模式 · 工作区读写 · unified-diff
> **状态:** ✅ 可运行（Windows / macOS / Linux · Electron）· 版本 **0.4.0**（2026-09-03）
> **主题:** light-first（浅色默认）· `html.night` 深色可选
> **仓库:** https://github.com/langkeshuo-ai/dave-desktop
> **门禁:** `npm run verify` 全绿 + `node tests/verify-full.mjs` 6 步 ALL PASS（478 单测 · chat:e2e 4 场景 · preview:e2e 18 · UAT 6）· **CI 首绿**（GitHub Actions @ master 2026-09-03）
> **交接:** 详细状态/决策/命令见 `HANDOFF.md`（2026-09-03）+ `tests/V0_4_GATES.md`（门禁矩阵）

## v0.4 能力（2026-09-03）

- **插件生命周期加固**：市场升级契约 + 升级失败回滚 + 连续失败自动禁用（PLUGIN_FAIL_THRESHOLD=3）
- **设置面板回归**：模型/工作区/扩展/日志/关于 五 tab（走 IPC 契约）
- **skills 目录扫描 + 路径穿越防御**（SKILL_NAME_RE 白名单）；i18n 组件硬编码清零
- **IPC 契约治理**：38 handler 全 schema；`scripts/scan-ipc-consistency.mjs` 双向缺口归零门禁
- **会话链路**：真实流式（pushWithGuard + 状态机守卫）+ 落库 + 审批 + 重启恢复渲染 + 文件变更卡

## 快速开始

```bash
npm ci          # 安装依赖（lockfile 0.4.0）
npm run dev     # 开发模式
npm run verify  # 静态门禁（format/lint/typecheck/coverage/build）
node tests/verify-full.mjs   # 一键全量门禁（含 Electron E2E，需先 npx playwright install chromium）
npm run package:win  # 打包（默认 dist/；dist-v8 为隔离产物）
```

> 依赖审计：`npm audit --omit=dev --audit-level=high` 当前 **0 vulnerabilities**（2026-09-03）。

## 技术栈

| 层       | 技术                                                                      |
| -------- | ------------------------------------------------------------------------- |
| 桌面框架 | Electron 42 + electron-vite 5 + electron-builder 26                       |
| 前端     | React 19 + TypeScript 5.8 + Tailwind 4 + Zustand 5                        |
| Markdown | react-markdown 10 + remark-gfm 4 + rehype-highlight 7 + rehype-sanitize 6 |
| 图标     | lucide-react 0.500                                                        |
| 持久化   | electron-store 11 + electron-window-state 5 + safeStorage（API Key）      |
| 日志     | electron-log 5                                                            |
| 测试     | Vitest 3.2 + **489 单元测试** + Playwright E2E                            |
| 代码质量 | ESLint 9 + Prettier + Husky + lint-staged                                 |
| 字体     | -apple-system / Segoe UI（系统栈）+ JetBrains Mono（代码）                |

## 功能

- **AI 多 provider 流式对话** — OpenAI / Anthropic / DeepSeek / 自定义（OpenAI 兼容）
- **Agent 工具循环** — 9 工具 + 四种批准模式（所有 shell 始终单独确认）
- **会话** — 创建/切换/删除/搜索/重命名/自动标题/导出 Markdown
- **工作区** — 文件树；点击插入 `@path`；patch 应用/忽略
- **设置** — 模型连接测试、工作区、开机自启、打开日志目录
- **安全存储** — API Key 使用 OS 级加密（Windows DPAPI / macOS Keychain / Linux libsecret）
- **桌面** — 托盘、深色/浅色主题、Win 无原生菜单栏、Ctrl+N / Ctrl+,
- **性能优化** — 组件懒加载（首屏 -57%）、虚拟滚动、FPS 监控工具（dev 模式）

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 类型检查
npm run typecheck

# 运行测试（123 个单元测试）
npm test

# 代码格式化
npm run format

# ESLint 检查
npm run lint

# 生产构建
npm run build

# 预览构建产物
npm run preview
```

## 打包

```bash
# Windows（NSIS 安装包 + portable）
npm run package:win

# macOS（DMG + ZIP）
npm run package:mac

# Linux（AppImage + deb）
npm run package:linux
```

## 打包产物（Windows）

| 文件                                     | 说明        |
| ---------------------------------------- | ----------- |
| `dist/dave-desktop-win-x64-portable.exe` | 便携版      |
| `dist/dave-desktop-win-x64-setup.exe`    | NSIS 安装包 |

## 项目结构

```
dave-desktop/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             # 应用入口、窗口管理、生命周期
│   │   ├── tray.ts              # 系统托盘（复用 resource icon）
│   │   ├── ipc.ts               # IPC 通信（会话、AI 流式、agent 循环）
│   │   ├── agent.ts             # Agent 工具循环（9 工具 + 批准模式）
│   │   ├── autolaunch.ts        # 跨平台开机自启动
│   │   └── store.ts             # 加密本地存储
│   ├── preload/
│   │   └── index.ts             # 安全上下文桥接（contextBridge）
│   ├── renderer/
│   │   ├── index.html
│   │   ├── index.tsx            # React 入口
│   │   ├── App.tsx              # 主应用组件（主题切换 + 布局）
│   │   ├── components/
│   │   │   ├── ChatView.tsx     # 对话视图 + 模式选择器
│   │   │   ├── MessageList.tsx  # 消息列表（Markdown + diff + code block）
│   │   │   ├── MessageInput.tsx # 消息输入框（composer）
│   │   │   ├── Sidebar.tsx      # 会话侧栏
│   │   │   ├── Settings.tsx     # 设置面板（三标签）
│   │   │   ├── StatusBar.tsx    # 底部状态栏
│   │   │   ├── ErrorBoundary.tsx# React 渲染错误兜底
│   │   │   ├── ApprovalDialog.tsx # Agent 工具批准对话框
│   │   │   └── WorkspacePanel.tsx # 工作区文件树面板
│   │   ├── stores/
│   │   │   └── useStore.ts      # Zustand 状态管理
│   │   └── styles/
│   │       └── globals.css      # 浅白 + 夜晚 双主题 CSS
│   └── shared/
│       ├── types.ts             # 共享类型定义
│       └── workspace.ts         # 工作区文件树类型
├── resources/
│   ├── icon.png                 # 256×256
│   └── icon.ico                 # 256×256
├── out/                         # 构建产物
├── legacy/                      # 旧 CLI 文件归档
├── ABOUT.md                     # 内核 / 处理能力 / 排版介绍
├── RESIDUAL_RISKS.md            # 残差风险与技术债
├── electron.vite.config.ts
├── electron-builder.config.ts
├── tsconfig.json
└── package.json
```

## 数据流

```
用户输入 → React 渲染进程
         → IPC (preload contextBridge)
         → Electron 主进程
         → OpenAI/Anthropic/DeepSeek API（流式 SSE）
         → IPC 返回流式块
         → React 实时渲染

agent 模式（suggest/auto/full-auto）:
         → 主进程 agent 循环（tool_calls → 执行工具 → 循环）
         → 需批准时 → IPC 推送 ApprovalDialog → 用户批准/拒绝
         → 最终结果 → IPC 流式渲染
```

## 许可

MIT
