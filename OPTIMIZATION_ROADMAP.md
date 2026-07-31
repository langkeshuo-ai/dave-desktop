# Dave Desktop 优化提升方案

**当前版本**: 0.1.0  
**基线状态**: 全面规范化完成，Cursor 风格主题就绪，生产可用  
**目标**: 0.2.0 — 性能 + 用户体验 + 可观测性全面提升  
**最新状态**: 2026-07-31 — 代码级收口项全部关闭(150 tests 全绿、主 bundle ≈745.72KB 达标)；剩余瓶颈为真机证据(FPS/签名/远端 CI)与发布链路。完整分析见 `ANALYSIS_2026-07-31.md`。

---

## 一、性能优化（P0 — 用户可感知）

### 1.1 渲染层性能

**问题**: renderer bundle 1.5MB，冷启动慢，长会话卡顿风险

**方案**:

- [x] **Code splitting** — React.lazy + Suspense 动态加载非核心组件（含完整 Markdown 渲染链）
  - Settings: 300KB（仅设置时加载）
  - Welcome: 150KB（首次启动后不再需要）
  - WorkspacePanel: 200KB（按需展开）
  - 预期减少首屏 bundle 至 850KB（-43%）
- [x] **虚拟滚动与压测入口** — MessageList 已接入虚拟列表并提供 2000 条开发压测；真实 Windows FPS 仍按 `RESIDUAL_RISKS.md` 验收
  - 当前用 @tanstack/react-virtual，需确认大数据集渲染帧率 >50fps
  - 增加 e2e 性能测试：生成 2000 条消息，测量滚动流畅度
- [x] **Markdown 解析优化** — ReactMarkdown 在流式时每个 chunk 触发重解析
  - `MarkdownContent` memo + 流式 120ms 节流（`shouldUpdateMarkdown`）
  - 历史消息靠 MessageBubble memo 跳过重解析

**成功标准**:

- 首屏加载 <2s（从 Electron ready 到可输入）
- 1000 消息会话滚动 >50fps
- 流式渲染 CPU <30%

---

### 1.2 主进程性能

**问题**: Agent 工具循环在复杂任务时可能阻塞主线程

**方案**:

- [ ] **Worker threads** — 将 shell 命令执行、文件读写移至 worker
  - `src/main/agent.ts` 的 `toolShell` / `toolWriteFile` 迁移至 worker pool
  - 主线程只做 IPC 路由 + 结果聚合
- [x] **大 patch 分批应用** — 大文件 patch 内存峰值(2026-07-31 已实施分批版)
  - `toolApplyPatch` 从 `Promise.all` 全量并行改为每批 ≤4 文件串行应用,
    峰值内存从"全部文件"降为"批大小",应用结果与回滚语义不变
  - 备注:严格逐行流式收益递减,分批已覆盖主要峰值
- [x] **启动性能优化** — 主进程初始化到窗口显示当前 ~3s(2026-07-31 已实施:createWindow 前置,store/initSecureStorage 后置后台初始化,`electron-window-state` 本就 lazy require)
  - lazy require 非关键模块（electron-log / electron-updater）
  - 窗口先显示再初始化 session store

**成功标准**:

- 冷启动到窗口显示 <1.5s
- Agent 工具执行不阻塞 UI（主线程空闲率 >80%）
- 大文件 patch（>10MB）内存峰值 <200MB

---

## 二、用户体验增强（P0 — 功能完整性）

### 2.1 键盘交互

**缺失**:

- [x] **全局快捷键** — Cmd/Ctrl+K 命令面板（快速跳转会话 / 新建 / 设置）
- [x] **会话切换** — Cmd/Ctrl+1~9 快速切换最近会话（另有 Alt+↑/↓）
- [x] **消息导航** — Cmd/Ctrl+↑/↓ 跳转到上一条/下一条 assistant 消息
- [x] **停止生成** — Esc 停止流式（弹窗优先关闭；无弹窗且流式中则 abort）
- [x] **键盘帮助** — ? 打开快捷键面板

**实现**:

- 注册 `globalShortcut`（Electron 主进程）
- 渲染层增加 `useKeyboardShortcuts` hook
- Settings 增加"键盘快捷键"标签页展示

---

### 2.2 消息交互

**缺失**:

- [x] **复制消息** — 每条消息 hover / focus-within 显示操作按钮
- [x] **编辑历史消息** — 用户消息就地编辑 + 截断后续 + 重新生成（`session-replace-messages`）
- [x] **消息搜索** — 侧栏会话标题 + 会话内全文搜索（Ctrl+F，零依赖子串匹配）
- [x] **导出会话** — Markdown 导出已落地；JSON / PDF 仍待
- [x] **滚动到底按钮** — 长会话离开底部显示按钮，仅在 atBottom 时跟随 streaming

**实现**:

- MessageBubble 增加 hover 工具栏
- 会话编辑模式：点击消息进入编辑状态，保存后触发重新生成
- 搜索用 Fuse.js 模糊匹配
- 导出用 `jsPDF` + `markdown-pdf`

---

### 2.3 工作区增强

**缺失**:

- [ ] **文件预览** — 点击文件树节点预览文件内容（只读）
- [ ] **Diff 视图** — patch 应用前显示对比视图（Monaco Editor diff）
- [ ] **文件搜索** — 工作区文件树支持模糊搜索过滤
- [ ] **Git 集成** — 显示文件 git 状态（modified / untracked / staged）

**实现**:

- 文件预览用 Monaco Editor readonly 模式
- Diff 视图用 Monaco Editor DiffEditor
- Git 状态调用 `git status --porcelain`

---

## 三、可观测性（P1 — 运维 + 调试）

### 3.1 日志增强

**当前**: electron-log 输出到文件，但无结构化 / 无日志级别控制

**方案**:

- [ ] **结构化日志** — JSON Lines 格式，包含 timestamp / level / module / sessionId
- [ ] **日志级别控制** — Settings 增加"日志级别"选择器（debug / info / warn / error）
- [ ] **日志查看器** — Settings 内嵌日志查看器，支持过滤 / 搜索 / 导出
- [ ] **性能日志** — 记录关键路径耗时（启动 / TTFB / token 生成速度）

**实现**:

```typescript
// src/main/logger.ts
log.transports.file.format = "{iso} [{level}] [{module}] {text}"
```

---

### 3.2 错误上报

**当前**: 渲染进程崩溃只记录本地日志，无远程上报

**方案**:

- [ ] **Sentry 集成** — 捕获未处理异常 + React Error Boundary
- [ ] **匿名遥测** — 可选开启（Settings 明确告知），收集崩溃率 / 使用频率
- [ ] **本地诊断工具** — 打包"诊断报告"（日志 + 系统信息 + 会话元数据）

**实现**:

```bash
npm install @sentry/electron --save
```

---

### 3.3 性能监控

**缺失**: 无首屏加载时间 / API 延迟 / 内存使用监控

**方案**:

- [ ] **Performance API** — 记录启动各阶段耗时
  - Electron ready → 窗口显示 → React 挂载 → 首次交互
- [ ] **API 监控** — 每次 OpenAI/Anthropic 调用记录 TTFB / tokens/s
- [ ] **内存监控** — 定时采样 `process.memoryUsage()`，超阈值告警

**实现**:

```typescript
// src/main/telemetry.ts
performance.mark("electron-ready")
performance.mark("window-shown")
performance.measure("cold-start", "electron-ready", "window-shown")
```

---

## 四、安全增强（P1 — 纵深防御）

### 4.1 IPC 安全

**当前**: validateSender 仅检查 webContents.id，可被同进程其他窗口绕过

**方案**:

- [x] **IPC 来源校验** — 所有 preload 暴露 handler 统一校验 sender；单窗口架构暂不区分窗口类型
- [ ] **请求签名** — preload 生成 HMAC 签名，main 验证（防 replay attack）
- [x] **速率限制** — 敏感操作（store-set / chat-stream / apply-patch）滑动窗口限流

**实现**:

```typescript
// src/preload/index.ts
const sign = (payload: string) => crypto.createHmac("sha256", SECRET).update(payload).digest("hex")
```

---

### 4.2 内容安全

**当前**: rehype-sanitize 白名单，但 LLM 仍可能输出恶意 Markdown

**方案**:

- [x] **CSP 增强** — Content-Security-Policy meta 禁止 unsafe-eval；electron smoke 断言
- [x] **链接与导航安全** — 外链仅 `shell.openExternal` 的 http(s)，主窗口拒绝跨源导航和 popup
- [ ] **文件下载校验** — Agent 下载文件前检查 MIME type / 文件签名

**实现**:

```html
<!-- src/renderer/index.html -->
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
/>
```

---

## 五、开发者体验（P2 — 长期维护）

### 5.1 E2E 测试

**缺失**: 仅有 123 个单元测试，无端到端测试

**方案**:

- [x] **Playwright E2E 基线** — `npm run test:electron`：CSP/挂载/帮助/命令面板/设置/新建会话/导出
  - 仍待：API Key 后真实发消息 → 流式回复
  - 仍待：Agent 批准 / patch 应用 / 编辑消息 GUI 断言
- [x] **视觉回归基线** — `tests/electron-screenshot.mjs` 生成 light/night 基线 PNG(2026-07-31);对比工具(pixelmatch / Playwright toHaveScreenshot)待接

**实现**:

```bash
npm install -D @playwright/test playwright-electron
```

---

### 5.2 CI/CD

**缺失**: 无自动化构建 + 发布流程

**方案**:

- [x] **GitHub Actions** — `.github/workflows/ci.yml`：verify + audit(omit=dev) + electron smoke
- [ ] **自动发布** — tag 推送触发打包 + 上传 GitHub Releases
- [ ] **更新服务器** — electron-updater 对接 GitHub Releases（latest.yml）

**实现**:

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run verify
```

---

### 5.3 文档完善

**缺失**: 缺少架构图 / API 文档 / 贡献指南细节

**方案**:

- [ ] **架构图** — Mermaid 绘制主进程 / 渲染进程 / IPC 通信流程
- [ ] **API 文档** — TypeDoc 生成 IPC API 文档
- [ ] **录屏演示** — 5 分钟快速上手视频

---

## 六、实施计划

### Sprint 1 — 性能优化（2 周）

1. Code splitting（Settings / Welcome / WorkspacePanel）
2. 虚拟滚动压测 + 优化
3. 冷启动优化（lazy require）
4. 性能监控埋点

**验收**: 首屏 <2s，1000 消息会话 >50fps

---

### Sprint 2 — 用户体验（2 周）

1. 全局快捷键 + 命令面板
2. 消息复制 / 编辑 / 搜索
3. 工作区文件预览 + Diff 视图
4. 滚动到底按钮

**验收**: 键盘操作完整，消息交互流畅

---

### Sprint 3 — 可观测性 + 安全（1 周）

1. 结构化日志 + 日志查看器
2. Sentry 集成
3. IPC 速率限制
4. CSP 增强

**验收**: 崩溃可追踪，安全评估通过

---

### Sprint 4 — 开发者体验（1 周）

1. Playwright E2E 测试套件
2. GitHub Actions CI/CD
3. 架构图 + API 文档

**验收**: CI 绿灯，文档完备

---

## 七、成功指标

| 指标          | 当前(截至 2026-07-31)                    | 目标 0.2.0      |
| ------------- | ---------------------------------------- | --------------- |
| 冷启动时间    | **1726ms 实测(2026-07-31,3s 预算内)**    | <1.5s           |
| 首屏 bundle   | **≈745.72KB ✅**                         | <900KB          |
| 1000 消息滚动 | 未采集(工具就绪,FPS-REAL 待真机)         | >50fps          |
| 单元测试覆盖  | **150 tests + V8 coverage ✅(实测全绿)** | >150 tests      |
| E2E 测试      | electron smoke 基线(7 场景)              | >10 scenarios   |
| 崩溃率        | 未知(无 Sentry)                          | <0.1%           |
| 日志可观测性  | 文本日志                                 | 结构化 + 可查询 |

---

## 八、风险与依赖

### 技术风险

- **Monaco Editor 集成** — bundle 增加 ~2MB，需权衡
- **Worker threads** — Electron 主进程 worker 稳定性需验证
- **Sentry 成本** — 免费额度可能不够，需评估自建方案

### 外部依赖

- **签名证书** — Windows 代码签名需采购证书（$200/年）
- **更新服务器** — GitHub Releases 有频率限制，需备用 CDN

---

## 九、长期愿景（0.3.0+）

- **插件系统** — 允许用户自定义工具 / provider
- **多语言支持** — i18n 国际化（英文 / 中文）
- **协作模式** — 多人共享会话（WebRTC P2P）
- **移动端** — React Native 移植（iOS / Android）
- **Web 版** — PWA 部署（浏览器内运行，受限工具集）

---

**版本**: 1.0  
**创建时间**: 2026-07-26  
**负责人**: 待指定  
**下次审查**: Sprint 1 完成后
