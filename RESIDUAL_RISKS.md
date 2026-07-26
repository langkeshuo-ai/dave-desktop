# Residual Risks & Tech Debt Ledger

> 更新: 2026-07-21  
> 结论: **可改代码项已全部收口**；仅外部/硬件/采购项 DEFERRED。

## 目标 / 非目标（终态）

```
目标: Cursor/Codex 级本地 Agent 可用闭环 — 信任/生产力/UI/工程门禁
非目标: 代码签名证书、MCP 全量、OS 级 shell 沙箱、mac/linux 真机打包
```

## 开源优先决策

| 能力          | 方案                                        | 决策                                            |
| ------------- | ------------------------------------------- | ----------------------------------------------- |
| 桌面壳/打包   | Electron + electron-vite + electron-builder | **复用**                                        |
| 连接探测      | 原生 fetch                                  | **自研** 薄胶水                                 |
| Diff          | npm `diff`                                  | **复用**                                        |
| shell 策略    | 规则表 + elevated                           | **自研**（无成熟薄库）                          |
| token 主进程  | js-tiktoken                                 | **复用**                                        |
| token UI      | rough 估算                                  | **自研**（避免 6MB 进 renderer）                |
| 自动更新      | electron-updater                            | **依赖已装 · 接线 DEFERRED**（需签名+Releases） |
| 虚拟列表      | @tanstack/react-virtual                     | **已安装** ^3.14.7（待接入）                    |
| Markdown 渲染 | react-markdown + rehype-highlight           | **复用**                                        |
| Markdown 安全 | rehype-sanitize                             | **复用**（v6,需元组断言）                       |

## 已关闭（可改代码）

ESM-STORE-CTOR · WIN-MENU · SIDEBAR-BOT · SETTINGS-SIZE · SESSION-RESTORE · AUTOTITLE · SHORTCUTS · PROVIDER-PROBE · EMPTY-GATE · DIFF-APPLY · SESSION-SEARCH · FULLAUTO-SHELL · ARTIFACT-NAMES · AT-PATH · TOKEN-STATUS · SESSION-EXPORT · CUSTOM-KEY · EXPLORER-ASK · APPROVAL-KEYS · PACKAGE-AUTHOR · DOCS-SYNC · SHELL-C-FLAGS · APPROVAL-TIMEOUT · AGENT-LOOP-CAP · LISTENER-LEAK · RENDERER-CRASH-RELOAD · MD-XSS · MSG-ACTIONS · SCROLL-BOTTOM · PALETTE-CMDFK · SIDEBAR-KEYBOARD · KEYBOARD-HELP · ERROR-BOUNDER · FILTER-TESTS · COPY-CLEANUP · FOCUS-RESTORE · SESSION-RACE · STATUS-DECL · ONBOARDING-FUNNEL · TELEMETRY-DEDUP · LAZY-LOAD · TTFB-INSTRUMENTATION · FIRST-WINDOW-METRIC · IPC-KEY-WHITELIST · TITLE-LEN · MSG-MEMO · TOKEN-MEMO · A11Y-STATUS-ALERT · SCROLL-THRESHOLD · CSP-STRICT · STORE-KEYS-FILTER

## DEFERRED（有正当理由）

| ID                  | 原因                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| SIGN*               | 商业证书采购                                                            |
| UPDATE*             | 需签名 + GitHub Releases 托管策略                                       |
| OS-PACK             | 无 mac/linux 构建机                                                     |
| MCP                 | 产品范围外                                                              |
| SHELL-OS-SANDBOX    | 需 utilityProcess + OS 隔离                                             |
| SESSION-DB          | 当前分 key store 够用                                                   |
| CSP-CUSTOM-HOST     | API 在 main 进程 fetch，renderer CSP 不影响；仅若未来 renderer 直连再扩 |
| VIRTUAL-LIST        | 当前 1k 消息以下无可见卡顿，达阈值时再引入                              |
| EDITOR-AUTOCOMPLETE | 暂未评估用户需求；textarea + @-path 已覆盖主流程                        |

## 验证

```
npm run verify   # typecheck + test + build
npm run package:win
# smoke: Dave Desktop 窗口 · log 无 ElectronStore ctor
```
