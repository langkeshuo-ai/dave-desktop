# Residual Risks & Tech Debt Ledger

> 更新: 2026-09-04
> 结论: 所有代码可收口项已关闭(截至 v0.4)。7 月后增量已收口:流式状态机 + pushWithGuard 推送契约、
> 跨域一致性门禁、插件生命周期加固(upgrade 回滚 + 失败自动禁用退避)、市场契约闭环、
> skills 路径穿越防御(SKILL_NAME_RE 白名单)、i18n 组件硬编码清零、设置面板视图回归、
> 冷启动 631ms(3s 预算内)。
> 发布链:remote 已配置且 master 已推送、CI 全绿、**Release v0.4.0 已公开**(2026-09-04,三平台资产齐备 win/linux/mac,更新通道 latest.yml 贯通 0.4.0)。
> 仍待外部环境:代码签名证书(win CSC / mac CSC_LINK,当前 win/mac 包均为 unsigned)、真实 API Key 全链路 E2E。
> **以 `HANDOFF.md`(2026-09-04)为准;`electron-smoke.mjs` 已删除(旧 UI)、`electron-uat.mjs` 旧版删除后已按新 renderer 重建(现为 verify-full 的 uat 步骤,6 场景),chat:e2e 现为 6 场景。**

## 当前已关闭

| ID               | 根因                                                             | 已实施方案                                                                                                                             | 验证                              |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| VIRTUAL-LIST     | 长会话完整 DOM 渲染                                              | 接入 `@tanstack/react-virtual`，使用 chat anchor/follow 策略                                                                           | production build                  |
| BUNDLE-MARKDOWN  | Markdown 全链静态进入主包                                        | `MarkdownContent` 通过 React lazy 按需加载                                                                                             | bundle 产物检查                   |
| DEV-PERF-IN-PROD | 压测工具静态 import                                              | `import.meta.env.DEV` + 动态 import                                                                                                    | production 主 chunk 无压测实现    |
| FPS-MATH         | 对逐帧 FPS 求算术平均导致高估                                    | 以总帧数/总时长计算，报告 P50/P95/P99 与慢帧                                                                                           | `calculateFpsStats` 单测          |
| PERF-STATE-RACE  | 压测覆盖消息、双击/卸载/切会话竞态                               | 快照恢复、启动锁、mounted/session guard、RAF 清理                                                                                      | lint/typecheck/test               |
| IPC-SENDER       | 部分 IPC 未统一验证来源                                          | 所有 preload 暴露 handler 均执行 `validateSender`                                                                                      | typecheck/test                    |
| NAVIGATION       | 未显式限制 renderer 导航/弹窗                                    | `will-navigate` 同源策略 + `setWindowOpenHandler` deny                                                                                 | 导航策略单测                      |
| MD-XSS           | Markdown HTML/高亮 class 边界                                    | `rehype-sanitize` schema 白名单                                                                                                        | production build                  |
| VITEST-RUNNER    | Vitest 4.1.10 在当前环境 runner 初始化失败，3.2.4 又有已披露漏洞 | 固定到兼容且修复漏洞的 3.2.6                                                                                                           | 144 tests                         |
| IPC-RATE         | 敏感 IPC 无频率上限                                              | `createRateLimiter` 作用于 store-set/chat-stream/apply-patch                                                                           | unit + lint                       |
| MD-STREAM-CPU    | 流式每个 chunk 全量重解析 Markdown                               | memo + 120ms 节流（`shouldUpdateMarkdown`）                                                                                            | unit + production build           |
| KBD-STOP         | 只能点按钮停止流式                                               | Esc 停止；Ctrl+1-9 / Ctrl+N / Ctrl+, 快捷键                                                                                            | electron smoke + 帮助面板         |
| CI-BASELINE      | 无自动化门禁                                                     | `.github/workflows/ci.yml` verify + smoke                                                                                              | workflow 文件入库                 |
| MSG-EDIT         | 无法编辑历史 user 再生成                                         | `session-edit` + `session-replace-messages` + 就地编辑 UI                                                                              | unit + verify + smoke             |
| MSG-SEARCH       | 仅侧栏标题搜索，会话内无法全文定位                               | `message-search` + Ctrl+F 条 + 命中高亮 + Ctrl+↑/↓ 导航                                                                                | unit + verify + smoke             |
| COLD-START-MEAS  | 冷启动重排无实测数据                                             | `tests/electron-coldstart.mjs` 读取 first_window_shown 遥测点                                                                          | 实测 1726ms,3s 预算内(2026-07-31) |
| PATCH-MEMORY     | 大 patch Promise.all 全量并行,所有文件原文+结果同时驻留内存      | `toolApplyPatch` 分批并发(每批 ≤4 文件),应用/回滚语义不变                                                                              | unit + verify                     |
| VISUAL-BASELINE  | 主题样式无回归基线                                               | `tests/electron-screenshot.mjs` 基线 + `electron-visual-diff.mjs`(pixelmatch,diff 比例>1% 报错)                                        | 基线入库 + 对比工具闭环           |
| STRUCTURED-LOG   | 仅文本日志,不可过滤/搜索                                         | `structured-log.ts` JSON Lines 落盘 + Settings 查看器(过滤/级别)                                                                       | unit + verify                     |
| DIAGNOSTICS      | 排障需手工翻日志/系统信息                                        | `diagnostics.ts` 一键导出报告(系统信息+会话元数据+双日志)                                                                              | unit + verify                     |
| MCP-TOOLS        | 无外部工具生态接入                                               | 复用官方 SDK:stdio 客户端 + 工具并入 Agent 循环 + 一律审批;集成测试(mcp-echo-server.mjs 端到端);启动自动连接已配置 servers(2026-07-31) | unit + verify + 集成测试闭环      |

既有已关闭项（摘要）：store key 白名单、API Key safeStorage、shell hard-deny/elevated 审批、patch 工作区边界、会话运行时清理、流式 abort partial 保留、ErrorBoundary、焦点恢复、键盘帮助、命令面板、消息操作、滚动到底按钮、遥测边界。

## 仍待外部或真实环境验证

| ID               | 级别 | 状态与原因                                                                                                                                                                                                                         | 关闭条件                                                               |
| ---------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| FPS-REAL         | P1   | ✅ **已关闭(2026-09-03 复测)**:`tests/electron-fps.mjs` 真机自动采集,2000 条混合消息滚动 avg 144fps、P95/P99 7ms/7.1ms、>33.3ms 慢帧 0,写入 PERFORMANCE_REPORT.md(2026-07-31 首测 avg 60fps/P95 16.8ms)                            | 已达成(>50fps、P95<30ms、P99<50ms)                                     |
| UAT-E2E          | P1   | 部分缓解(2026-07-31):`DAVE_TEST_MOCK_PROVIDER=1` mock 全链路覆盖流式/编辑再生成/Agent 批准/patch 预览(免真实 Key,CI 可跑);真实 API Key 场景仍缺                                                                                    | 覆盖真实 Key 发消息→流式→编辑→批准;CI 稳定绿                           |
| SIGNING          | P1   | Windows/macOS 发布未签名,取决于证书采购($200/年);electron-builder 已配置从 `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` 读取                                                                                                              | 配置代码签名并验证 SmartScreen/Gatekeeper                              |
| UPDATE-RELEASE   | P1   | ✅ **首次发布已完成(2026-09-04)**:v0.4.0 三平台资产已发布 + latest.yml 贯通;剩余仅签名刷新(见 SIGNING)                                                                                                                             | 签名产物 + staged rollout                                              |
| DEV-AUDIT        | P2   | 全依赖 audit 21 high(2026-07-31 复核):vitest 3.x 最新 3.2.7 仍带 coverage-v8 漏洞,4.x 修复但有 runner 回归(见台账 VITEST-RUNNER);其余链需 breaking 升级,无安全路径                                                                 | 上游发布安全兼容版本后升级；CI 使用可信仓库输入，不处理不可信 glob/tar |
| CI               | P2   | ✅ **已关闭(2026-09-04)**:remote 已关联 langkeshuo-ai/dave-desktop、master 已推送;CI 自 2026-09-03 起连续全绿(run#33748057183 首绿 → 2026-09-04 run#33833152583,verify job + verify-full E2E 矩阵全部通过);git push 凭据经 gh 可行 | PR 上 `npm ci` + verify + electron smoke 稳定(已达)                    |
| OS-SHELL-SANDBOX | P2   | 当前为策略层，不是 OS 隔离                                                                                                                                                                                                         | utilityProcess/Job Object/AppContainer 等系统隔离方案成熟并验证        |
| MAC-LINUX        | P3   | 本轮只有 Windows 环境                                                                                                                                                                                                              | macOS/Linux 真机构建与 smoke                                           |
| SESSION-DB       | P3   | electron-store 当前规模够用                                                                                                                                                                                                        | 数据量或事务需求触发后迁移 SQLite                                      |

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
