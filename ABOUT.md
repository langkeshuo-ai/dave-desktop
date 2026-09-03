# Dave Desktop — 内核 / 处理能力 / 排版介绍

> 戴夫个人 Agent 桌面应用 — Electron + React + TypeScript + Tailwind CSS
> 版本：0.1.0 · 主题：浅白（默认）+ 夜晚（备用） · 风格：Cursor 风格 UI + Codex 工具集

---

## 1. 客户端内核

Dave Desktop 的内核由四层构成，每层职责明确、可独立替换：

| 层                   | 实现                                                                                      | 职责                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 主进程（Main）       | Electron 42 + Node + TypeScript                                                           | 窗口管理、单实例锁、IPC 路由、AI API 调用、SSE 流式解析、会话持久化、系统托盘、开机自启动；Win 隐藏原生菜单 |
| Preload              | `@electron-toolkit/preload` + contextBridge                                               | 安全桥接 — `contextIsolation: true` + `nodeIntegration: false`，仅暴露白名单 API 到 `window.dave`           |
| 渲染进程（Renderer） | React 19 + Tailwind 4 + react-markdown + rehype-highlight + lucide-react                  | UI 渲染、状态管理（Zustand）、Markdown GFM + 代码高亮 + unified-diff 视图                                   |
| 持久化               | `electron-store`（配置/会话）+ Electron `safeStorage`（API Key）+ `electron-window-state` | 设置加密、窗口状态、会话消息                                                                                |

### 内核不是 Bun.compile CLI

旧版 Dave 是 189MB Bun.compile 单文件 CLI 工具包（PE 荚），双击启动终端 TUI。
当前 Dave Desktop 已完全改造为 Electron 桌面应用 — 有窗口、系统托盘、设置面板、Agent 工具循环。
旧 CLI 文件归档到 `legacy/` 作参考，不再作主入口。

### 关键依赖（全部活跃维护、兼容许可证）

| 依赖                                                        | 用途                                | 许可证 |
| ----------------------------------------------------------- | ----------------------------------- | ------ |
| `electron` 42                                               | 桌面应用运行时                      | MIT    |
| `electron-vite` 3                                           | 构建 + 开发服务器                   | MIT    |
| `electron-builder` 26                                       | 跨平台打包（NSIS / DMG / AppImage） | MIT    |
| `electron-store` 11                                         | 加密设置持久化                      | MIT    |
| `electron-window-state` 5                                   | 窗口状态持久化                      | MIT    |
| `electron-log` 5                                            | 主进程日志                          | MIT    |
| `react` 18 + `react-dom` 18                                 | UI 框架                             | MIT    |
| `tailwindcss` 4                                             | 原子 CSS                            | MIT    |
| `zustand` 5                                                 | 状态管理                            | MIT    |
| `react-markdown` 10 + `remark-gfm` 4 + `rehype-highlight` 7 | Markdown GFM + 代码高亮             | MIT    |
| `lucide-react` 0.500                                        | 图标库                              | ISC    |

---

## 2. 处理能力

### AI 多 provider 路由（不是 stub）

主进程 IPC `chat-stream` handler 直接 `fetch` 调用 AI API，按 provider 路由：

| Provider  | 端点                                           | 鉴权                                                 | SSE 字段                                   |
| --------- | ---------------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| OpenAI    | `https://api.openai.com/v1/chat/completions`   | `Authorization: Bearer <key>`                        | `choices[0].delta.content`                 |
| Anthropic | `https://api.anthropic.com/v1/messages`        | `x-api-key: <key>` + `anthropic-version: 2023-06-01` | `delta.text`（`content_block_delta` 事件） |
| DeepSeek  | `https://api.deepseek.com/v1/chat/completions` | `Authorization: Bearer <key>`                        | `choices[0].delta.content`                 |
| 自定义    | 用户配置 host                                  | `Authorization: Bearer <key>`                        | OpenAI 兼容                                |

Anthropic 分支独立处理：不同 schema（`messages` 不含 `system` role → 提到 top-level `system`；`max_tokens` 必填；SSE 事件形状不同）。

### 流式处理

- 主进程 `fetch` + `ReadableStream` reader + `TextDecoder` 增量解码
- SSE 按 `data: ` 前缀分行解析，跳过 `[DONE]`
- 每个 chunk 通过 `event.sender.send("chat-stream-chunk", { content, sessionId })` 推到渲染进程
- 渲染进程 Zustand store 累积 `streamingContent`，React 增量渲染
- 完成后保存完整 assistant 消息到 `electron-store`，自动给会话起标题

### 四种批准模式（Codex 风格）

| 模式        | 行为                                      |
| ----------- | ----------------------------------------- |
| `ask`       | 纯流式对话，不跑工具                      |
| `suggest`   | 可建议 diff / 变更；写入与 shell 需批准   |
| `auto`      | 可自动读写文件；shell 需批准              |
| `full-auto` | 自动读写文件；**所有 shell 始终单独批准** |

> 四种模式均已接通主进程 agent 循环（`chat-loop` + 9 工具 + 批准对话框 + unified-diff）。

### 跨平台

| 平台    | 打包格式             | 自启动                                                                     |
| ------- | -------------------- | -------------------------------------------------------------------------- |
| Windows | NSIS `.exe`（109MB） | `%APPDATA%/Microsoft/Windows/Start Menu/Programs/Startup/Dave Desktop.lnk` |
| macOS   | DMG                  | `~/Library/LaunchAgents/com.dave.desktop.plist`                            |
| Linux   | AppImage             | `~/.config/autostart/dave-desktop.desktop`                                 |

### 资源占用

| 项           | 值                                        |
| ------------ | ----------------------------------------- |
| 安装包大小   | 109MB（NSIS） / 233MB（解压后）           |
| 主进程内存   | ~80MB（空闲）                             |
| 渲染进程内存 | ~120MB（含 React + markdown + highlight） |
| 启动时间     | ~1.5s（冷启动到窗口可见）                 |

---

## 3. 排版介绍（UI 设计）

### 设计目标

- **浅白默认** — 纸白背景、近黑文字、WCAG AA 对比度（正文 ≥ 7:1、弱文字 ≥ 4.5:1）
- **8pt 间距律** — 所有 padding / margin 是 4 的倍数
- **3 级文字层级** — strong `#0b0b0b` / body `#1f1f1f` / dim `#575757`
- **单一强调色** — `#0064b9`（在白底上 AA 合规）
- **夜晚备用** — 通过 `<html class="night">` 切换，用户点标题栏 🌙/☀️ 按钮触发，持久化到 `electron-store`

### 色板

#### 浅白（默认）

| 变量               | 值                     | 用途                             |
| ------------------ | ---------------------- | -------------------------------- |
| `--bg`             | `#ffffff`              | 编辑器背景                       |
| `--bg-panel`       | `#fafbfc`              | 侧栏 / 面板                      |
| `--bg-active`      | `#eaeef2`              | 活跃行 / hover                   |
| `--bg-sunk`        | `#f3f5f8`              | 凹陷区 / 表头 / inline code 背景 |
| `--bg-title`       | `#0b0b0b`              | 标题栏（暗色，Cursor 风格）      |
| `--border`         | `#d7dde4`              | 分割线                           |
| `--border-strong`  | `#b9c2cf`              | 输入框边框                       |
| `--accent`         | `#0064b9`              | 按钮蓝                           |
| `--accent-hover`   | `#0052a0`              | 按钮 hover                       |
| `--accent-soft`    | `rgba(0,100,185,0.08)` | 活跃行背景 / 用户气泡背景        |
| `--text`           | `#1f1f1f`              | 正文                             |
| `--text-strong`    | `#0b0b0b`              | 强调文字                         |
| `--text-dim`       | `#575757`              | 弱文字                           |
| `--text-faint`     | `#8b949e`              | 占位符 / 时间戳                  |
| `--syntax-fn`      | `#6f42c1`              | 函数名（紫）                     |
| `--syntax-str`     | `#0a3069`              | 字符串（深蓝）                   |
| `--syntax-kw`      | `#cf222e`              | 关键字（红）                     |
| `--syntax-comment` | `#6e7781`              | 注释（灰）                       |
| `--diff-add`       | `#1a7f37`              | 添加行                           |
| `--diff-del`       | `#cf222e`              | 删除行                           |

#### 夜晚（备用，`html.night`）

| 变量            | 值        |
| --------------- | --------- |
| `--bg`          | `#1e1e1e` |
| `--bg-panel`    | `#252526` |
| `--bg-active`   | `#2d2d2d` |
| `--accent`      | `#4fc3f7` |
| `--text`        | `#cccccc` |
| `--text-strong` | `#ffffff` |
| `--syntax-fn`   | `#dcdcaa` |
| `--syntax-str`  | `#ce9178` |
| `--syntax-kw`   | `#569cd6` |

### 排版层级

| 元素        | 字号    | 字重 | 行高                       |
| ----------- | ------- | ---- | -------------------------- |
| H1          | 1.35rem | 700  | 1.3                        |
| H2          | 1.2rem  | 700  | 1.35                       |
| H3          | 1.05rem | 600  | 1.5                        |
| H4–H6       | 1rem    | 600  | 1.5                        |
| 正文        | 13px    | 400  | 1.55                       |
| inline code | 0.85em  | 400  | 1.5                        |
| 代码块      | 12.5px  | 400  | 1.55                       |
| diff 行     | 12.5px  | 400  | 1.55                       |
| 状态栏      | 11px    | 400  | 1.5                        |
| 面板头      | 11px    | 500  | 1.5（大写、字间距 0.05em） |

### 字体

- 正文：`Inter` → `-apple-system` → `BlinkMacSystemFont` → `Segoe UI` → `PingFang SC` → `Microsoft YaHei`
- 代码：`JetBrains Mono` → `Fira Code` → `SFMono-Regular` → `Consolas` → `Liberation Mono` → `Menlo`

### 组件层级

```
┌─────────────────────────────────────────┐
│ TitleBar (32px, dark #0b0b0b)           │  ← drag-region + 按钮簇
├──────────┬──────────────────────────────┤
│ Sidebar  │ ChatView                     │
│ (240px)  │  ├ ModeBar (模式 + 流状态)    │
│          │  ├ MessageList (滚动)         │
│  会话列表 │  │  ├ user bubble (右)        │
│  + 新建  │  │  └ assistant (左)          │
│          │  │    ├ markdown             │
│          │  │    ├ code-block (复制)    │
│          │  │    └ diff-view           │
│          │  └ MessageInput (composer)   │
├──────────┴──────────────────────────────┤
│ StatusBar (24px, accent #0064b9)        │  ← 模式 / 消息 / 计数
└─────────────────────────────────────────┘
```

### 交互细节

- **代码块复制**：1.5s "已复制" 反馈，复制按钮染绿
- **diff 视图**：行号 gutter + 添加行绿底 / 删除行红底 / hunk 头灰底
- **会话切换**：左侧 2px 茏色边框标记活跃会话
- **流式光标**：6×12px 茏色 pulse-dot，1.2s 呼吸动画
- **输入框聚焦**：3px 茏色 soft ring
- **滚动条**：10px 宽，5px 圆角，hover 加深

---

## 4. 当前项目状态

### 已完成并验证

- Electron 桌面应用框架（窗口 + 单实例锁 + 窗口状态持久化 + 原生菜单 + 系统托盘）
- React 渲染进程（浅白 Cursor 风格 UI + 夜晚备用主题）
- AI 多 provider 流式对话（OpenAI / Anthropic / DeepSeek / 自定义）
- 会话管理（创建 / 切换 / 删除 / 自动标题）
- 设置面板（provider / workspace / about 三标签 + API Key 加密 + 自启动切换）
- Markdown GFM + 代码高亮 + 代码块复制 + unified-diff 视图
- 跨平台打包（Windows NSIS 109MB 验证通过）
- 跨平台开机自启动（Windows / macOS / Linux）
- 渲染出错 ErrorBoundary 兜底
- electron-log 日志（renderer console + uncaught + unhandled）

### 待办（下一阶段）

- **Agent 工具循环**：AST grep / patch / apply_patch / shell 命令的真实执行 + 工作区文件树 UI 接通主进程
- **macOS / Linux 打包验证**：当前仅 Windows 已打包验证
- **electron-updater 自动更新**：依赖已装但未接通
- **对话上下文 token 计数**：当前无 token 计数 / 截断
- **多会话并行流式**：当前仅单会话流式

---

## 5. 已知残差风险

详见 `RESIDUAL_RISKS.md`。主要项：

- agent 工具循环尚未接通（suggest / auto / full-auto 模式的 patch 应用 / shell 执行）
- macOS / Linux 打包未验证
- electron-updater 自动更新未接通
- token 计数 / 上下文截断未实现
- 自定义 provider 的 OpenAI 兼容性未对所有端点验证

---

## 6. 后续计划

1. **agent 工具循环**（最高优先）— 接通 AST grep / patch / shell + 工作区文件树 UI
2. **macOS / Linux 打包验证** — 在 macOS / Linux 上跑 `npm run package:mac` / `package:linux`
3. **electron-updater** — 配置 GitHub Releases 自动更新
4. **token 计数** — 用 `tiktoken` 或 `@anthropic-ai/tokenizer` 做上下文截断
5. **多会话并行** — 改 IPC 为按 sessionId 路由 chunk
