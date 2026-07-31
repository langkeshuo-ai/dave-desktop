# Residual Risks & Tech Debt Ledger

> 更新: 2026-07-31
> 结论: 所有代码可收口项已关闭。本轮新增关闭:mock 流式 E2E 全链路(免真实 Key)、
> FPS 真机采集(2000 条混合消息实测 avg 60fps / P95 16.8ms)、发布 workflow 配置、
> secure-storage async 解密字段名 bug 修复(Electron 42 `decryptStringAsync` 返回 `{ shouldReEncrypt, result }`)。
> 仍待外部环境:代码签名证书、真实 API Key 全链路 E2E、远端 CI 首绿、跨平台。

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
| MSG-EDIT         | 无法编辑历史 user 再生成                                         | `session-edit` + `session-replace-messages` + 就地编辑 UI    | unit + verify + smoke          |
| MSG-SEARCH       | 仅侧栏标题搜索，会话内无法全文定位                               | `message-search` + Ctrl+F 条 + 命中高亮 + Ctrl+↑/↓ 导航      | unit + verify + smoke          |

既有已关闭项（摘要）：store key 白名单、API Key safeStorage、shell hard-deny/elevated 审批、patch 工作区边界、会话运行时清理、流式 abort partial 保留、ErrorBoundary、焦点恢复、键盘帮助、命令面板、消息操作、滚动到底按钮、遥测边界。

## 仍待外部或真实环境验证

| ID               | 级别 | 状态与原因                                                                                                                                                         | 关闭条件                                                               |
| ---------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| FPS-REAL         | P1   | ✅ **已关闭(2026-07-31)**:`tests/electron-fps.mjs` 真机自动采集,2000 条混合消息滚动 avg 60fps、P95/P99 16.8ms、>33.3ms 慢帧 0,写入 PERFORMANCE_REPORT.md           | 已达成(>50fps、P95<30ms、P99<50ms)                                     |
| UAT-E2E          | P1   | 部分缓解(2026-07-31):`DAVE_TEST_MOCK_PROVIDER=1` mock 全链路覆盖流式/编辑再生成/Agent 批准/patch 预览(免真实 Key,CI 可跑);真实 API Key 场景仍缺                    | 覆盖真实 Key 发消息→流式→编辑→批准;CI 稳定绿                           |
| SIGNING          | P1   | Windows/macOS 发布未签名,取决于证书采购($200/年);electron-builder 已配置从 `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` 读取                                              | 配置代码签名并验证 SmartScreen/Gatekeeper                              |
| UPDATE-RELEASE   | P1   | 配置就绪(2026-07-31):`publish: github` + `.github/workflows/release.yml`(v* tag 触发 verify→打包→上传);缺签名证书与首次实际发布                                    | 签名产物 + latest.yml + staged rollout                                 |
| DEV-AUDIT        | P2   | 全依赖 audit 21 high(2026-07-31 复核):vitest 3.x 最新 3.2.7 仍带 coverage-v8 漏洞,4.x 修复但有 runner 回归(见台账 VITEST-RUNNER);其余链需 breaking 升级,无安全路径 | 上游发布安全兼容版本后升级；CI 使用可信仓库输入，不处理不可信 glob/tar |
| CI               | P2   | workflow 已入库；远端 runner 首次绿灯与 package smoke 仍待观察                                                                                                     | PR 上 `npm ci` + verify + electron smoke 稳定；可选 package:win smoke  |
| OS-SHELL-SANDBOX | P2   | 当前为策略层，不是 OS 隔离                                                                                                                                         | utilityProcess/Job Object/AppContainer 等系统隔离方案成熟并验证        |
| MAC-LINUX        | P3   | 本轮只有 Windows 环境                                                                                                                                              | macOS/Linux 真机构建与 smoke                                           |
| SESSION-DB       | P3   | electron-store 当前规模够用                                                                                                                                        | 数据量或事务需求触发后迁移 SQLite                                      |

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
