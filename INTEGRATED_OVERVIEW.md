# Dave Desktop 项目整合总览

> **截至 2026-07-31** · 汇总两轮系统化工作(①六维分析与全建议执行 ②世界级/企业级基准提升)的最终状态。
> 详细数据与演进记录见文末文档索引;本文档是项目状态与成果的唯一入口。

---

## 1. 项目快照

| 项       | 值                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------ |
| 定位     | 本地 Agent 桌面客户端(Electron 42 + React 19 + TS 5.8 + Zustand 5 + Tailwind 4,中文 UI)                |
| 版本     | 0.1.0(0.2.0 目标:性能 + 可观测性 + 可分发)                                                             |
| 门禁     | `npm run verify` 全绿:format / eslint / 双 tsconfig typecheck / **164 tests** / coverage / build       |
| 架构     | Electron 三进程(main / preload / renderer)+ `src/shared/` 纯函数共享层(IPC 边界校验全在此,node 可单测) |
| 提交     | 9 个功能/文档 commit(见 §7),工作区干净                                                                 |
| 安全口径 | 生产依赖 audit **0 漏洞**;IPC 白名单 + sender 校验 + 限流 + shell hard-deny + sanitize + 导航同源      |

## 2. 能力矩阵(对齐 atomcode / claude code / codex / hermes 等参考项目)

| 能力域                                 | 参考项目 | dave-desktop                                        | 状态           |
| -------------------------------------- | -------- | --------------------------------------------------- | -------------- |
| Agent 工具循环(shell/写文件/patch/AST) | ✅       | ✅ Codex 工具集 + 分批并发                          | 无差距         |
| 多 provider 流式                       | ✅       | ✅ OpenAI/Anthropic/DeepSeek/自定义 + mock 测试模式 | 无差距         |
| 审批/安全纵深                          | ✅       | ✅ 4 模式 + 白名单/限流/sender/sanitize/导航        | 无差距         |
| 会话管理/导出/搜索/编辑                | ✅       | ✅ 全文搜索、就地编辑再生成、Markdown 导出          | 无差距         |
| 性能                                   | ✅       | ✅ 实测达标(见 §3)                                  | 无差距         |
| **MCP 工具扩展**                       | ✅       | ✅ 基础版(复用官方 SDK,stdio,一律审批,启动自动连接) | 已对齐         |
| **结构化日志/可观测性**                | ✅       | ✅ JSON Lines + Settings 查看器                     | 已对齐         |
| **诊断导出**                           | ✅       | ✅ 一键打包报告                                     | 已对齐         |
| skills / 工具市场                      | ✅       | ❌                                                  | 0.3.0 记录     |
| 多端/手机接入                          | 部分     | ❌                                                  | 桌面应用非必要 |

**语言重构评估(结论:不重构)**:现有栈现代活跃;161 单测与全部功能对等重写回归风险极高;Tauri 对 Node 工具链与 MCP SDK(Node 客户端)适配成本高;无用户可见收益。符合开源优先原则的"确凿理由"豁免条款。

## 3. 实测数据汇总(全部 2026-07-31 真机/实测)

| 指标                    | 实测                                                | 目标                | 结论                             |
| ----------------------- | --------------------------------------------------- | ------------------- | -------------------------------- |
| 单元测试                | **164/164**(153 → 164)                              | >150                | ✅                               |
| 主 renderer bundle      | **745.76KB**                                        | <900KB              | ✅(-39.6% 于基线)                |
| Markdown 按需 chunk     | **608KB**(738 → 608,highlight 20 语言子集)          | 建议 <500KB         | ⚠️ 已降 17.6%,收益递减           |
| 2000 条消息滚动         | **avg 60fps / P95 16.8ms / P99 16.8ms,慢帧 0**      | >50fps / P95<30ms   | ✅ FPS-REAL 关闭                 |
| 冷启动(→ ready-to-show) | **1726ms**                                          | 预算 3s / 目标 1.5s | ✅ 预算内(createWindow 前置重排) |
| E2E(mock 全链路)        | 3 场景:流式/编辑再生成/审批+patch                   | —                   | ✅ 免真实 Key,CI 可跑            |
| 依赖安全                | prod **0 漏洞**;dev 21 high 无安全可升级路径        | —                   | ⚠️ 外部等待上游                  |
| 大文件 patch 内存       | 分批并发(每批 ≤4 文件),峰值从"全部文件"降为"批大小" | —                   | ✅ 语义不变                      |

## 3.5 终审实证(2026-07-31,收尾核验)

| 核验项                         | 结果                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **完整 `npm run verify` 单次** | ✅ **exit 0(环境清理 + 缓存热后前台单次完成)**:format → lint → typecheck → **164 tests + coverage** → build(main 7.65s / preload 873ms / renderer 57.80s) |
| electron-smoke 回归            | ✅ 三场景(流式/编辑再生成/审批+patch)+ 整体 EXIT:0——启动路径改动(MCP 自动连接/日志级别持久化)无回归                                                       |
| 用户验收测试(UAT)              | ✅ `tests/electron-uat.mjs` **21/21 PASS**(设置四 tab/MCP 面板/漏斗/日志/诊断/命令面板/快捷键/新建会话/发消息/编辑/搜索/导出/主题重启保持)                |
| 失败编辑完整性复核             | ✅ 全部失败 edit 均重读精确文本后成功重试;关键函数(LogViewer/McpPanel/open-log-dir/logs-set-level)闭合完整;git 工作区干净、无未跟踪文件                   |
| 单测                           | **164/164**(153 → 164)                                                                                                                                    |

## 4. 两轮工作成果

### 第一轮:六维分析与全建议执行

- **六维分析**(ANALYSIS_2026-07-31.md):按最新值增强 / 优化点识别 / 核心洞察 / 拓扑分形 / 树结构 / 下一步建议。
- **9 项执行全部落地**:分析落盘、R3 冷启动重排(createWindow 前置 + store 后置)、R4 Markdown 子集化(-17.6%)、R2 mock 流式全链路 E2E(免 Key)、R6 漏斗看板补 7 日回访、R5 发布链路(签名配置 + release workflow)、依赖审计复核、FPS 真机采集(60fps)、verify + 台账收尾。

### 第二轮:世界级/企业级基准提升(开源优先 + 差距闭合)

- **开源优先研究**:@modelcontextprotocol/sdk v1.30.0(MIT、活跃、文档全)——三项复用标准达标,选定复用;日志/诊断评估后自行实现(避免引入新依赖)。
- **差距闭合三项**:① MCP 工具集成(工具以 `mcp__server__tool` 并入 Agent 循环,一律审批,Settings「扩展」tab);② 结构化日志(JSON Lines + 查看器);③ 一键诊断导出。
- **过程中修复的真实 bug**:Electron 42 `safeStorage.decryptStringAsync` 返回 `{ shouldReEncrypt, result }`,原取 `plainText` 永远 undefined → API Key 写入后可读不出(生产必踩)。已修并记录 gotcha。

## 5. 风险与技术债状态

### 已关闭(20+ 项,核心节选)

代码可收口项全部关闭:IPC 白名单/sender/限流、shell hard-deny、sanitize、导航、mock E2E、消息编辑/搜索、FPS-REAL(实测达标)、冷启动实测(1726ms)、大 patch 分批、视觉回归基线、结构化日志、诊断导出、MCP 集成、secure-storage 字段名修复、备份清理、流式 abort partial 保留等。详见 RESIDUAL_RISKS.md。

### 剩余:全部为外部依赖(代码侧已无可推进)

| 项                      | 触发条件                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 代码签名证书            | 采购($200/年)→ GitHub Secrets `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` → 打 v0.2.0 tag                                                         |
| 真实 API Key 全链路 E2E | 配置真实 Key 跑通发消息→流式→编辑→批准(mock 已覆盖同链路)                                                                                     |
| 远端 CI 首绿            | 本地无 git remote;GitHub MCP 创建仓库尝试失败(fetch failed,服务不可达,2026-07-31):需服务恢复后建仓 + `git remote add` + push(workflow 已入库) |
| 漏斗真实数据            | 发布后 7 日回访窗口(FunnelView 已含留存指标)                                                                                                  |
| 跨平台                  | macOS/Linux 真机构建与 smoke                                                                                                                  |

## 6. 关键架构决策与 gotcha(摘要)

- **纯函数共享层是质量杠杆**:校验逻辑全放 `src/shared/`(shell-policy / store-policy / rate-limit / message-search / mcp / structured-log 类型),main 只做 adapter,node 环境零 mock 单测。
- **测试隔离三开关**:`DAVE_TEST_USER_DATA`(数据隔离)、`DAVE_TEST_MOCK_PROVIDER=1`(mock 全链路)、env 注入测试脚本;生产路径零污染。
- **MCP 工具一律审批**:视为 mutates,任何模式需批准;SDK `CallToolResult.content` TS 推断为 `{}`,需显式标注类型。
- **secure-storage async 字段名**:`decryptStringAsync` 返回 `result` 字段;encrypt/decrypt 必须同一 API 路径(async 或 sync)。
- **既有规约**:IPC handler 幂等 guard、IME 保护、`useMounted`/`useFocusRestore` 复用、双 tsconfig 必跑 `npm run verify`、ESM/CJS interop 经 `resolveDefaultExport`。

## 7. 提交历史

```
d93256e feat: mcp auto-connect on startup and persisted log level
f16c71b chore: ignore visual diff runtime artifacts
8a8c82b feat: mcp integration tests, visual diff tool and log level control
d8c6a02 docs: integrated project overview
3c587d3 feat: structured logging, diagnostics export and MCP tool integration
85c670a feat: batched patch apply, cold-start measurement and visual baselines
704ab28 docs: analysis report, roadmap and risk ledger updates
ec5e508 feat: mock E2E streaming, cold-start reorder, markdown highlight subset
```

(全部经预提交钩子 prettier + eslint + 双 tsconfig typecheck)

## 8. 剩余行动路径(按性价比排序)

1. **配置 git remote 后 push**(分钟级)→ 解锁远端 CI 验证(workflow 已就绪)
2. **采购证书 + 配置 Secrets + 打 v0.2.0 tag** → 解锁签名分发 + 自动更新
3. **真实 Key 跑通 E2E** → 补上 mock 之外的最后一公里
4. **发布后 7 日** → 读 FunnelView 出漏斗基线,数据驱动 onboarding 迭代
5. **跨平台**(有机器后)→ 构建 + smoke

## 9. 文档索引

| 文档                      | 内容                                              |
| ------------------------- | ------------------------------------------------- |
| `ANALYSIS_2026-07-31.md`  | 六维分析(最新值/优化点/洞察/拓扑分形/树结构/建议) |
| `OPTIMIZATION_ROADMAP.md` | 0.2.0 路线图 + 差距矩阵 + 重构评估(§十)           |
| `RESIDUAL_RISKS.md`       | 风险/技术债台账(已关闭 20+ 项 + 外部依赖)         |
| `PERFORMANCE_REPORT.md`   | 性能实测(bundle/FPS 60fps/冷启动 1726ms)          |
| `HANDOFF.md`              | 交接文档(本轮增量 + 下游依赖)                     |
| `AGENTS.md`               | Agent 指南 + 全部 gotcha(secure-storage/MCP 等)   |
