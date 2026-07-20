# ROLE: Dave Desktop 桌面应用

**一句话**: 戴夫个人 Agent 的跨平台桌面应用，替代原有的 CLI/EXE 客户端方向。

| 项 | 内容 |
|----|------|
| 所在目录 | `C:\Users\C\dave客户端开发` |
| 技术栈 | Electron 42 + React 18 + TypeScript + Tailwind CSS |
| 构建工具 | electron-vite + electron-builder |
| 打包输出 | NSIS (Windows) / DMG (macOS) / AppImage (Linux) |
| 状态 | 首次构建通过，可运行 |
| 淘汰旧物 | `Dave.exe`, `dave.ts`, `index.ts`, `dave-client-windows-x64.zip` 等旧 CLI 产物不再作为主入口 |

## 规则

1. 本目录是独立项目，不依赖 `dave-opencode` monorepo 的副本同步
2. 所有 API Key 和用户数据通过 electron-store 加密本地存储
3. 构建产物（`out/`、`dist/`）禁止 git 提交
4. 优先复用现有成熟方案（Electron 生态），不重复造轮子

## 架构

```
Main Process (Electron)
  ├── Window Management (BrowserWindow)
  ├── System Tray (Tray)
  ├── Local Storage (electron-store, encrypted)
  ├── IPC Handlers (ipcMain)
  └── AI API Client (fetch → OpenAI-compatible API)

Preload (contextBridge)
  └── Secure API exposure

Renderer (React 18)
  ├── ChatView (streaming messages)
  ├── Sidebar (session management)
  ├── Settings (provider/model/key config)
  └── System Tray integration
```