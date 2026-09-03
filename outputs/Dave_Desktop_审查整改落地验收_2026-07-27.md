# Dave Desktop 审查整改落地验收（复验版）

- 验收日期：2026-07-27
- 对照报告：`outputs/Dave_Desktop_全面工程审查报告_2026-07-27.md`
- 复验口径：代码实现、针对性测试与质量门禁三者同时成立，才判定关闭；需要 OS/GUI/真机证据的问题不以 Node 单测替代。

## 一、复验结论

本轮已完成五组高优先级整改，并把格式与覆盖率纳入 `npm run verify`。关键可靠性问题已明显收敛，但原报告 38 项并未全部关闭，当前仍不能标记为“全部整改完成”或“高可信发布版”。

### 本轮状态

| 结论                   | 项目                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| 已关闭                 | 密钥明文降级、abort partial 丢失竞态、chat invoke reject 卡死、Patch 预计算/回滚缺失、格式门禁、覆盖率执行缺失 |
| 风险已降低但未完全关闭 | Shell 越界风险、Custom Provider SSRF、Provider 重定向鉴权、开发依赖漏洞                                        |
| 仍未关闭               | Electron GUI/E2E 稳定执行、OS 级 Shell 沙箱、发布链与真机性能验收，以及原报告其余 P2/P3 项                     |

## 二、自动化验收证据

| 检查                   | 结果   | 证据                                                                                 |
| ---------------------- | ------ | ------------------------------------------------------------------------------------ |
| `npm run verify`       | 通过   | format → lint → 双 tsconfig → coverage → build 全链路成功                            |
| 单元测试               | 通过   | Vitest 138/138                                                                       |
| 覆盖率                 | 已建立 | V8 coverage 正常生成；全仓语句 32.74%、分支 71.84%、函数 56.30%                      |
| `npm run format:check` | 通过   | 全部匹配文件符合 Prettier                                                            |
| 生产构建               | 通过   | main、preload、renderer 均成功产出                                                   |
| Windows portable       | 通过   | `dist-final-portable/dave-desktop-win-x64-portable.exe`                              |
| 生产依赖审计           | 通过   | `npm audit --omit=dev`：0 vulnerabilities                                            |
| Electron GUI/E2E       | 未通过 | 已接 Playwright Electron smoke；首次进程握手失败，清理宿主环境后运行挂起，未计为通过 |

已启用 `sandbox: true`；生产 CSP 的 `script-src` 不含 `unsafe-inline`，`connect-src` 仅为 `'self'`，localhost/ws 仅通过 dev Vite 转换注入。构建仍有非阻断警告：`store.ts`/`secure-storage.ts` 动静态导入并存、lucide-react 的 `use client` 被忽略。renderer 主 chunk 约 726.70 kB，Markdown chunk 约 738.09 kB，体积风险仍在。

## 三、P0/P1 复验

### SEC-001 Shell `cwd` 不是沙箱 — 部分关闭

- `src/main/agent.ts` 已改为所有 shell-capable 工具在 `suggest`、`auto`、`full-auto` 下均强制审批。
- `ChatView` 用户文案已同步为“所有 shell 均需确认”。
- 回归测试覆盖普通 `echo` 在 full-auto 下仍需审批。
- 未完成：`execa({ shell: true, cwd })` 仍不是 OS 沙箱，获批命令仍具工作区外文件和网络能力。

**判定：静默 Shell 执行路径已关闭；原始 OS 隔离风险仍需产品级沙箱方案。**

### SEC-002 Custom Provider SSRF — 部分关闭

新增 `src/main/provider-url-policy.ts`，并接入 probe 与正式聊天请求：

- HTTPS-only；拒绝 credentials、query/hash、非 443 端口、localhost。
- 拒绝 IPv4/IPv6 私网、回环、link-local、组播及保留地址。
- 请求前解析 DNS 并拒绝任何非公网结果。
- 手动处理最多 3 次重定向；每跳重新验证。
- 跨 origin 重定向删除 `Authorization`、`Proxy-Authorization` 与 `Cookie`。

未完全关闭：当前基于“连接前 DNS 校验”，没有把已验证地址固定到实际 socket，仍需通过自定义网络栈/undici dispatcher 处理 DNS rebinding 的校验—连接竞态。

### SEC-003 密钥明文降级 — 已关闭

- API Key 使用 `safe-storage:v1:` 版本 envelope。
- safeStorage 不可用或加密失败时拒绝保存，不再明文降级。
- 旧明文、未知 envelope、损坏 hex、解密失败或抛错统一返回 null 并记录诊断。
- Linux `basic_text` 后端被拒绝。
- 单测覆盖安全存储不可用、旧明文拒绝与加解密路径。

兼容性说明：旧明文 Key 不自动迁移，用户需要重新录入；这是安全优先的显式策略。

### REL-001 abort partial 竞态 — 已关闭

- 主进程通过 `partialBySession` 跟踪已经实际发送的内容。
- Provider SSE 和本地 synthetic stream 均更新 partial；本地流中止时抛 `AbortError`，不再静默 break 后保存完整未发送文本。
- abort catch 在发送 done 前把 partial 持久化为 assistant 消息。
- renderer 不再本地 `addMessage(partial)`，只清临时态并从主进程会话重载，形成单一事实源。
- 正常完成和错误路径清理 partial map，避免跨轮污染。

### REL-002 chat invoke reject — 已关闭

`src/renderer/App.tsx` 已为 `window.dave.chat.stream()` 增加 reject 处理：恢复 streaming 状态、清除临时文本、显示错误并重载已由主进程预先保存的用户消息。

### REL-003 Patch 非事务 — 已关闭（进程内尽力事务）

- 所有目标先完成路径校验、原文读取与 patch 计算，预计算失败时零写入。
- 拒绝同一 patch 重复修改同一绝对路径。
- 提交阶段在写入前登记文件，覆盖 `writeFile` 部分写入后抛错的场景。
- 失败时逆序恢复旧文件、删除本轮新文件；回滚不完整会列出具体路径和错误。
- 新增多文件预计算失败零写入与成功提交测试。

限制：这是应用进程内的补偿事务，不具备文件系统崩溃一致性；若需断电级保证，应升级为同目录临时文件、fsync 与原子 rename 协议。

### QA-002 / QA-003 — 已关闭基础缺口

- `verify` 已包含 `format:check` 与 `test:coverage`。
- `@vitest/coverage-v8` 已可用，coverage 可重复生成。
- 当前覆盖率偏低，后续应设置逐步提升的阈值；本轮关闭的是“完全无覆盖率执行/格式门禁”，不是“覆盖充分”。

## 四、仍需继续整改

1. **SEC-001**：引入真实 Shell 进程/文件系统/网络沙箱，或将 Shell 能力降级为严格 argv allowlist。
2. **SEC-002**：固定已校验 DNS 结果到实际连接，彻底消除 DNS rebinding 窗口。
3. **SEC-004 / SEC-007**：评估 `sandbox: true`，移除生产 CSP 中不必要的 `unsafe-inline` 与开发源。
4. **QA-001**：建立 Electron GUI/E2E，覆盖真实 IPC、SSE 中止、审批、会话切换、打包启动。
5. **覆盖率质量**：当前全仓语句 32.88%，需要分层阈值和 renderer 测试；coverage 报告还出现同名文件重复条目，应检查 sourcemap/transform 配置。
6. **性能**：主 renderer 与 Markdown chunk 仍超过 700 kB；需继续拆分和真机冷启动/长会话 FPS 验收。
7. **依赖链**：生产依赖为 0 漏洞，但开发/打包依赖风险仍需单独复核，不能用强制降级换取 audit 归零。
8. **发布工程**：代码签名、更新源、安装/回滚闭环仍需外部环境验证。
9. **其余 P2/P3**：App 拆分、Settings 取消语义、备用 Key 输入可见性、自启最终状态、版本硬编码、文档漂移等仍需按原报告继续处理。

## 五、工作区与发布判定

当前工作区包含大量未提交修改和新增文件，尚未形成可追溯的独立整改提交。质量门禁通过证明当前目录可编译、可测试，不代表具备发布追溯性。

**最终判定：本轮关键整改验收通过，但全面整改验收仍不通过。**

可以标记为：**“高优先级安全与可靠性整改已落地一批，完整 38 项整改仍在进行中。”**
