# Residual Risks & Tech Debt Ledger

> 更新: 2026-07-29
> 结论: 代码可收口项继续推进（IPC 限流、流式 Markdown 节流、快捷键、CI、E2E smoke 扩展）；真实 FPS、签名发布和跨平台仍需外部环境。

## 当前已关闭

| ID               | 根因                                                             | 已实施方案                                                   | 验证                           |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------ |
| VIRTUAL-LIST     | 长会话完整 DOM 渲染                                              | 接入 `@tanstack/react-virtual`，使用 chat anchor/follow 策略 | production build               |
| BUNDLE-MARKDOWN  | Markdown 全链静态进入主包                                        | `MarkdownContent` 通过 React lazy 按需加载                   | bundle 产物检查                |
| DEV-PERF-IN-PROD | 压测工具静态 import                                              | `import.meta.env.DEV` + 动态 import                          | production 主 chunk 无压测实现 |
| FPS-MATH         | 对逐帧 FPS 求算术平均导致高估                                    | 以总帧数/总时长计算，报告 P50/P95/P99 与慢帧                 | `calculateFpsStats` 单测       |
| PERF-STATE-RACE  | 压测覆盖消息、双击/卸载/切会话竞态                               | 快照恢复、启动锁、mounted/session guard、RAF 清理            | lint/typecheck/test            |
| IPC-SENDER       | 部分 IPC 未统一验证来源                                          | 所有 preload 暴露 handler 均执行 `validateSender`            | typecheck/test                 |
| NAVIGATION       | 未显式限制 renderer 导航/弹窗                                    | `will-navigate` 同源策略 + `setWindowOpenHandler` deny       | 导航策略单测                   |
| MD-XSS           | Markdown HTML/高亮 class 边界                                    | `rehype-sanitize` schema 白名单                              | production build               |
| VITEST-RUNNER    | Vitest 4.1.10 在当前环境 runner 初始化失败，3.2.4 又有已披露漏洞 | 固定到兼容且修复漏洞的 3.2.6                                 | 144 tests                      |
| IPC-RATE         | 敏感 IPC 无频率上限                                              | `createRateLimiter` 作用于 store-set/chat-stream/apply-patch | unit + lint                    |
| MD-STREAM-CPU    | 流式每个 chunk 全量重解析 Markdown                               | memo + 120ms 节流（`shouldUpdateMarkdown`）                  | unit + production build        |
| KBD-STOP         | 只能点按钮停止流式                                               | Esc 停止；Ctrl+1-9 / Ctrl+N / Ctrl+, 快捷键                  | electron smoke + 帮助面板      |
| CI-BASELINE      | 无自动化门禁                                                     | `.github/workflows/ci.yml` verify + smoke                    | workflow 文件入库              |

既有已关闭项（摘要）：store key 白名单、API Key safeStorage、shell hard-deny/elevated 审批、patch 工作区边界、会话运行时清理、流式 abort partial 保留、ErrorBoundary、焦点恢复、键盘帮助、命令面板、消息操作、滚动到底按钮、遥测边界。

## 仍待外部或真实环境验证

| ID               | 级别 | 状态与原因                                                                                      | 关闭条件                                                               |
| ---------------- | ---- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| FPS-REAL         | P1   | 2000 条混合消息的 Electron 真窗口滚动指标尚未采集；不能用 jsdom/Node 伪造                       | 在目标 Windows 机器记录 avg、P50/P95/P99、>16.7/>33.3/>50ms、卡顿率    |
| UAT-E2E          | P1   | 已有 Playwright Electron smoke（窗口/CSP/挂载/快捷键帮助）；完整业务 UAT 仍缺                   | 覆盖首启、设置、会话、停止/再生成、性能入口；CI 稳定绿                 |
| SIGNING          | P1   | Windows/macOS 发布未签名，取决于证书采购                                                        | 配置代码签名并验证 SmartScreen/Gatekeeper                              |
| UPDATE-RELEASE   | P1   | updater 已接线但缺签名与 GitHub Releases 发布策略                                               | 签名产物 + latest.yml + staged rollout                                 |
| DEV-AUDIT        | P2   | 全依赖 audit 为 19 high + 1 moderate，均在 lint/打包开发链；npm 建议会危险降级 electron-builder | 上游发布安全兼容版本后升级；CI 使用可信仓库输入，不处理不可信 glob/tar |
| CI               | P2   | workflow 已入库；远端 runner 首次绿灯与 package smoke 仍待观察                                  | PR 上 `npm ci` + verify + electron smoke 稳定；可选 package:win smoke  |
| OS-SHELL-SANDBOX | P2   | 当前为策略层，不是 OS 隔离                                                                      | utilityProcess/Job Object/AppContainer 等系统隔离方案成熟并验证        |
| MAC-LINUX        | P3   | 本轮只有 Windows 环境                                                                           | macOS/Linux 真机构建与 smoke                                           |
| SESSION-DB       | P3   | electron-store 当前规模够用                                                                     | 数据量或事务需求触发后迁移 SQLite                                      |

## 依赖审计口径

- `npm audit --omit=dev`: **0 漏洞**。
- `npm audit`: **20 项**（19 high、1 moderate），集中于 `electron-builder`、`eslint` 及其 `glob/minimatch/brace-expansion/tar` 传递链。
- 不执行 `npm audit fix --force`：当前建议包含将 `electron-builder@26` 反向降级至 `22.14.13`，会扩大兼容性和维护风险。

## 发布门禁

```bash
npm run verify
npm audit --omit=dev
npm run package:win
```

此外必须完成 `tests/SELF_CHECK.md` 的目标 Windows 真机 UAT；未获得真实 FPS 与签名发布证据时，不得宣称这些风险已关闭。
