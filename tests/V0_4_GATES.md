# V0.4 版本门禁矩阵

> 创建：2026-09-03 · 依据：ROADMAP_0.4_SPEC.md §3（候选 C：版本门禁整合）
> 铁律：不保留向后兼容。任何面向旧 renderer UI 的门禁一律删除或重写，禁止打补丁兼容。

## 门禁矩阵（实现验证顺序）

| 层级          | 命令                                                             | 覆盖                                                              | 现状                                                       | 判定标准                              |
| ----------- | -------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------- |
| L0 单元       | `npm test`                                                     | 全部 vitest 单测（状态机、推送守卫、跨域一致性、契约、插件退避、市场升级、skills 路径安全等）          | 依据：**477 passed / 0 failed**（2026-09-03）                 | 0 fail；数量写入本文件                    |
| L1 类型       | `npm run typecheck`                                            | 根 + node 双 tsconfig                                             | 依据                                                       | 0 error                           |
| L2 构建       | `npm run build`                                                | main/preload/renderer 三端产物                                      | 依据                                                       | 0 error，`emptyOutDir: true` 生效    |
| L3 真实会话 E2E | `node tests/chat-stream.e2e.mjs`（`npm run chat:e2e` 自带 build）  | Electron+mock provider 真实链路：ask 流式 + 落库 + agent 审批 + 重启恢复渲染 + **设置面板** | 依据：**4 场景全过**（2026-09-03）                                | 全场景通过，零 console 错误 |
| L4 前端原型 E2E | `npm run preview:e2e`                                          | `frontend-preview` 原型 18 项 named-risk（含遮挡回归）                    | 依据                                                       | 18/18 通过                          |
| L5 UAT      | `node tests/electron-uat.mjs`                                  | 新链 6 场景（主界面/设置面板/技能增删/关于/持久化）                              | **已重写**（2026-09-03）：6/6 PASS                            | 全场景 + 零 console 错误 |
| L6 性能基线     | `node tests/electron-coldstart.mjs` / `tests/electron-fps.mjs` | 冷启动 / 帧率                                                        | **已重建**（2026-09-03）：冷启动 631ms；FPS 60fps / P95 16.8ms / P99 16.8ms / slow33=0 | 冷启动 <3000ms；avg>50fps、P95<30ms、P99<50ms |
| L7 IPC 契约一致性 | `node scripts/scan-ipc-consistency.mjs` | preload↔main 双向 M missing/DEAD | **已加入**（2026-09-03）：MISSING 0 / DEAD 0 | 缺口=0，exit 0 |
| L8 一键全量     | `node tests/verify-full.mjs`                                   | ipc-consistency → build → unit → chat:e2e → preview:e2e → uat 串行 | 依据 | 输出 `ALL PASS (clean exit)` |

## v0.4 已执行的整合动作

- `tests/electron-smoke.mjs` **已删除**（2026-09-03）：面向旧 renderer UI（welcome/cmdk/.msg-row），
  已被真实会话门禁 `chat-stream.e2e.mjs` 取代；REFERENCES：ROADMAP_0.4_SPEC §3.1「smoke 重写」+ §3.2 方案 C2。

- `package.json#test:electron` 从「build + node tests/electron-smoke.mjs」改为「npm run chat:e2e」。

- 旧 `tests/electron-uat.mjs` **已删除**（2026-09-03，依赖旧 UI dialog 结构且设置页组件未回归），
  **同日重写为新链 UAT**（6 场景：主界面/设置面板/技能增删/关于/持久化），已接入 verify-full 管线。

- `tests/verify-full.mjs`：`integration(smoke)` → `integration(chat:e2e)`；`uat` 步骤先替换为 `e2e(preview)`，
  设置面板回归后重写 `electron-uat.mjs` 并恢复 `uat` 步骤。

## 待办（v0.4 后续增量）

1. ~~UAT 重写~~ ✅ 已重写（2026-09-03）：`electron-uat.mjs` 新链 6 场景，已接入 verify-full。
2. ~~冷启动 / FPS 基线~~ ✅ 已重建（2026-09-03）：冷启动 631ms；FPS 60fps / P95 16.8ms / P99 16.8ms。
3. ~~会话"重启恢复渲染"场景~~ ✅ 已落地：chat:e2e 场景 3（同 userDataDir 重启 → 历史消息渲染 + 角色断言）。

## 通过记录

| 日期         | 命令                                                            | 结果                        |
| ---------- | ------------------------------------------------------------- | ------------------------- |
| 2026-09-03 | typecheck 双跑 + vitest                                         | **477 passed / 0 failed** |
| 2026-09-03 | verify-full（build → unit → chat:e2e 4 场景 → preview:e2e 18/18 → uat 6 场景） | **ALL PASS (clean exit)** |
| 2026-09-03 | electron-coldstart.mjs                                          | 631ms（预算 3000ms）       |
| 2026-09-03 | electron-fps.mjs（2000 条混合消息）                                  | avg 60fps / P95 16.8ms / P99 16.8ms / slow33 0 |