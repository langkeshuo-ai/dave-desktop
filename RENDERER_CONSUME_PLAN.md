# 渲染端消费接线方案（ChatView x ChatStreamStore）

> 目标：把主进程已落地的 7 条流式推送通道（start/chunk/done/error/tools/approval/patch，
> 均经 pushWithGuard 按契约推送）接入渲染端 UI。前置条件：src/renderer 源码树就绪
> （2026-09-01 renderer 已补全；本方案执行结果由 tests/chat-stream.e2e.mjs（4 场景）与
> tests/electron-uat.mjs（6 场景）承接与验证）。
> 关联 HANDOFF 待办：TDD-CONSUME（✅ 已闭环）。

***

## 1. 现状（已落地，不再重复）

- 主进程推送：src/main/chat-loop.ts 经 pushWithGuard 推送 7 类事件；
  时序守卫覆盖 start/chunk/done（非法序列抛错不 send），error/tools/approval/patch 免除守卫。

- preload：src/preload/index.ts 的 chat 对象已暴露
  onChunk / onDone / onError / onApproval / onPatch / onTools（均返回取消订阅函数），
  以及 chat.stream / chat.abort / chat.approve。onStart 已于 2026-09-01 补齐。

- 渲染端模块（已实现且单测全绿，node 环境可测）：

  - src/shared/chat-stream-state.ts：纯函数状态机，6 状态 9 事件。

  - src/shared/chat-stream-store.ts：createChatStreamStore() 订阅式 store（getSnapshot/subscribe/dispatch）。

  - src/renderer/stores/use-chat-stream-store.ts：useChatStreamStore(store) 用 useSyncExternalStore 读快照。

- 时序与内聚约定：

  - 一个会话一个 store 实例；会话切换即丢旧实例。

  - approval\_result 事件由渲染端本地派发（用户点击批准/拒绝时自行 dispatch），
    主进程不推送 approval\_result（守卫已豁免 approval，无此通道）。

  - 断线重连由 onStart 重置流。

***

## 2. 改动清单

### 2.1 preload 补齐 onStart（必做第一步）

文件：src/preload/index.ts，chat 对象内新增，与 onChunk 同构：

```ts
onStart: (callback: (data: ChatStreamStart) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, data: ChatStreamStart) => callback(data)
  ipcRenderer.on("chat-stream-start", handler)
  return () => {
    ipcRenderer.removeListener("chat-stream-start", handler)
  }
},
```

同时把 ChatStreamStart 加入 preload 的 types import（src/shared/types 已定义）。

### 2.2 桥接 hooks（新文件）

src/renderer/hooks/use-chat-stream-bridge.ts：
入参 (store, sessionId)，职责是把 7 条 IPC 事件 dispatch 进 store，并暴露审批/停止动作。

```ts
import { useEffect, useCallback } from "react"
import type { ChatStreamStore } from "../../shared/chat-stream-store"

export interface ChatStreamBridge {
  approve: (approved: boolean) => void
  abort: () => void
}

/** 一次性订阅主进程流式事件 → store.dispatch。会话切换/卸载时自动清理。 */
export function useChatStreamBridge(
  store: ChatStreamStore,
  sessionId: string,
): ChatStreamBridge {
  useEffect(() => {
    // window.dave 即 preload 暴露的 API（contextBridge）
    const offs = [
      window.dave.chat.onStart((p) => {
        if (p.sessionId !== sessionId) return
        store.dispatch({ type: "start", sessionId })
      }),
      window.dave.chat.onChunk((p) => {
        if (p.sessionId !== sessionId) return
        store.dispatch({ type: "chunk", content: p.content, sessionId, replace: p.replace })
      }),
      window.dave.chat.onTools((p) => {
        if (p.sessionId !== sessionId) return
        store.dispatch({ type: "tools", sessionId, tools: p.tools })
      }),
      window.dave.chat.onApproval((req) => {
        if (req.sessionId !== sessionId) return
        store.dispatch({ type: "approval", sessionId, tool: req.tool, arguments: req.arguments, mutates: req.mutates, isShell: req.isShell })
      }),
      window.dave.chat.onPatch((p) => {
        if (p.sessionId !== sessionId) return
        store.dispatch({ type: "patch", sessionId, patch: p.patch })
      }),
      window.dave.chat.onError((p) => {
        if (p.sessionId !== sessionId) return
        store.dispatch({ type: "error", error: p.error, sessionId })
      }),
      window.dave.chat.onDone((p) => {
        if (p.sessionId !== sessionId) return
        store.dispatch({ type: "done", sessionId, aborted: p.aborted })
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [store, sessionId])

  const approve = useCallback(
    (approved: boolean) => {
      // 1) 通知主进程（解除 waitApproval，主进程继续执行/拒绝工具）
      void window.dave.chat.approve(sessionId, approved)
      // 2) 本地推进状态机：approval_pending → streaming
      store.dispatch({ type: "approval_result", sessionId, approved })
    },
    [store, sessionId],
  )

  const abort = useCallback(() => {
    void window.dave.chat.abort(sessionId)
    // 主进程回推 done{aborted:true}，渲染端经 onDone 保留 partial
  }, [sessionId])

  return { approve, abort }
}
```

关键点：

- 每个回调先做 sessionId 过滤，杜绝残留事件跨会话污染（复用主进程侧同款防御）。

- 用户点击批准/拒绝时走 approve(boolean)：一端调 IPC 让主进程继续，一端本地推进状态机。

- abort 只调 IPC，等待 onDone(aborted) 让 store 落 done { aborted: true }，partial 文本保留。

### 2.3 ChatView 集成（renderer 就绪后改）

约定组件路径（以实际 renderer 树为准，如 src/renderer/components/chat/ChatView\.tsx）：

```tsx
const store = useMemo(() => createChatStreamStore(), [sessionId])
const state = useChatStreamStore(store)
const bridge = useChatStreamBridge(store, sessionId)
```

状态 → UI 映射（渲染端状态机 6 态）：

| 状态                | UI 行为                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| idle              | 不渲染流内容；发送走 chat.stream(text, sessionId)                                              |
| streaming         | 显示 state.content 累积文本 + 光标；isStreaming → 用于停止按钮/节流                                   |
| tool\_pending     | 工具指示器（state.tools 列表，如"正在调用 read\_file…"）                                            |
| approval\_pending | 审批卡片：tool/arguments/mutates/isShell（mutates 或 isShell 高亮风险），按钮批准/拒绝 → bridge.approve |
| done              | 落最终文本（aborted 时保留 finalContent 部分输出）                                                 |
| error             | 错误文案（state.error code block）                                                         |

补充组件：

- ApprovalCard（新）：展示审批请求，绑定 approve 回调；拒绝同理。参考现有审批 UI（renderer 就绪后合并）。

- MessageBubble 对 streaming 文本复用现有 memo/虚拟滚动管道，不做重复渲染优化。

### 2.4 发送消息

发送按钮/回车 → window\.dave.chat.stream(text, sessionId)（现有 API，主进程会先推 start）。

***

## 3. 状态机对齐与不变量

- 渲染端 store 与主进程守卫共用同一份 chat-stream-state；两者不共享运行时状态，
  各自独立推进——主进程断言"推送时的合法性"，渲染 store 还原"消费时序"。

- 兜底不变量：若主进程曾误发非法序列（守卫抛错不会发），渲染 store 的 dispatch
  静默拒绝（非法转移不通知），UI 不会崩溃，只少一次渲染——安全方向正确。

- 断线重连：chat.stream 再次调用 → 主进程推新 start → 渲染 store reset 重来；
  幂等 key 为会话命名空间（Wave-B 已落地），重放不会串扰。

***

## 4. TDD 验证计划

### 4.1 状态层（无 React，node 环境可跑，落地顺序第 1）

- 复用 src/shared/event-contract.ts 的 runContractTrail 对桥接派发序列做契约测试：
  以 onChunk/onDone/... 的 payload 输入序列断言 final 状态与 renderTranscript。

- 新增 tests/chat-stream-bridge.test.ts（纯函数版 dispatcher 由 hook 内部导出以便单测）：

  - 归一化各通道 payload → StreamEvent 的映射转为可导出纯函数（buildEventFromChannel）。

  - 覆盖：7 通道映射、sessionId 过滤、approval 本地推进、aborted partial 保留。

### 4.2 React 层（renderer 就绪后，落地顺序第 2）

- 新增 devDeps：@testing-library/react、@testing-library/user-event、jsdom。

- 组件测试 ChatView：mock window\.dave (vi.stubGlobal) 后用 renderer 进程 emit 各通道事件，
  断言 store 快照与 DOM 文本演进；审批卡片交互 → chat.approve 被调 + store 回到 streaming。

- vitest environment 对组件测试文件覆盖为 jsdom（per-file 注释或 vitest 配置 environmentMatchGlobs）。

### 4.3 端到端（落地顺序第 3）

- tests/chat-stream.e2e.mjs 真实会话门禁已全链路（ask 流式/落库/agent 审批/重启恢复/设置面板 4 场景）；
  渲染端 store 累加文本与主进程最终文本对齐已由该门禁断言覆盖。

***

## 5. 验收标准

1. 发送消息 → streaming 逐字累积渲染，无乱序、无重复、无幻觉字符。
2. 工具调用 → tool\_pending 指示；审批 → approval\_pending 卡片；批准后工具执行且流继续。
3. 停止 → done{aborted:true}，partial 文本保留为用户可见的最终消息。
4. 错误 → error 文案展示，不残留半截 streaming。
5. 切换会话 → 旧 store 卸载、监听全部清理；残留事件被 sessionId 过滤，零串扰。
6. 断线重连 → onStart 重置流，幂等 key 不误杀重放。
7. 全量 vitest + typecheck 双跑绿；chat:e2e 真实会话门禁通过（2026-09-03：477 unit + 4 场景 + UAT 6 场景全绿）。

***

## 6. renderer 就绪的前置检查

- src/renderer 源码树存在（入口、组件、i18n）——当前工作区缺失，
  且 tests/unit.test.ts 依赖 src/renderer/i18n/index，补齐后 typecheck/vitest 全量才会真正全绿。

- 确认 ChatView / MessageList / ApprovalCard 实际路径，方案中的路径为约定值。

- preload 补 onStart 可在 renderer 就绪前先行（主进程侧改造，双端 typecheck 可验证）。

***

## 8. 开源优先选型结论（2026-09 调研）

按"先在 GitHub/npm 检索成熟开源方案，优先复用"原则对 2026 组件库生态做调研，结论如下：

| 候选            | 许可  | 维护活跃                     | 与本项目契合度                                        | 决策                    |
| ------------- | --- | ------------------------ | ---------------------------------------------- | --------------------- |
| shadcn/ui     | MIT | 是（CLI 复制进代码库，75k+ stars） | 高：Tailwind4 原生 + 代码完全自有，可无缝套用暖琥珀 token         | 采用（组件源进库零 runtime 依赖） |
| Mantine 7     | MIT | 是                        | 中：120+ 全系统组件，但自带 CSS Modules 主题，与自有 token 系统双轨 | 不采用（风格打架 + 体积）        |
| Radix/Base UI | MIT | 是                        | 中：无样式 primitives，仍需自写样式层                       | 作为 shadcn 底层间接采用      |
| HeroUI        | MIT | 是                        | 中高：Tailwind4 + React Aria 无障碍                  | 备选；本项目组件面窄，shadcn 更轻  |
| 自研全组件         | —   | —                        | —                                              | 拒绝：已有成熟开源，无强定制理由      |

**结论**：组件层复用 shadcn/ui（渲染端就绪后 `npx shadcn init` + 按需 add button/input/dialog/select/tooltip/badge 等，全部复制进仓库）；其余能力复用项目既有依赖：@tanstack/react-virtual（虚拟列表）、react-markdown+rehype-sanitize（Markdown）、lucide-react（图标）、i18next（多语言）、zustand（状态）、diff（补丁 diff 行）。零新增 runtime 依赖，只新增 devDeps：@testing-library/react、jsdom。

## 9. 成功与验证标准（Success & Validation Criteria）

三层测试门禁（分层理由：unit/contract 快且确定性高，E2E 覆盖跨边界真实行为，均防回归）：

| 层                    | 载体                     | 数量       | 命令                    |
| -------------------- | ---------------------- | -------- | --------------------- |
| Unit（状态机/契约/守卫）      | vitest                 | 277      | npm test              |
| E2E（前端原型交互门禁）        | playwright chromium    | 18       | npm run preview:e2e   |
| Electron smoke（真实链路） | electron（renderer 就绪后） | mock 全链路 | npm run test:electron |

E2E 门禁 check matrix（每个检查对应一个具名风险与失败响应，见 tests/frontend-preview\.e2e.mjs 头注释）：

| 检查           | 保护的风险              | 失败响应                                       |
| ------------ | ------------------ | ------------------------------------------ |
| R1 外壳渲染      | 布局壳缺失              | 检查 .activity/.sidebar/.main 与 #input 是否被误删 |
| R2/R2b 流式回放  | 回放脚本未运行 / 流式 UI 未接 | 打开 devtools console 查 JS 异常                |
| R3 审批步骤可见    | 写文件审批开关未呈现         | 确认 .action.writed 依赖的状态机分支存在               |
| R4a/R4b 审批可点 | 令牌被输入区遮挡（历史 bug）   | 重查 .tray z-index/bottom 与 placeOverlay 逻辑  |
| R5a/R5b 补丁预览 | diff 弹层不可用         | 检查 openDiff/close 事件绑定                     |
| R6a/R6b 撤销令牌 | 回滚语义丢失             | 确认 token.undo 与 action.denied 联动           |
| R7a/R7b 输入发送 | composer 发送/回复链路断裂 | 检查 send()/secondRound 事件链                  |
| R8 模式切换      | mode pill 不可交互     | 检查 modePill 事件委托                           |
| R9/R9b 新对话空态 | 会话重置失败             | 检查 newChat 清空逻辑与空态注入                       |
| R10 会话搜索     | 列表过滤失效             | 检查sessSearch input 过滤                      |
| R11 运行状态指示   | 忙碌指示不可见            | 检查 setRunning 与 sbFlow 切换                  |
| R12 无控制台错误   | 运行时 JS 异常          | 修 console.error 对应处                        |

**验收 Gate**：npm run preview:e2e 必须 18/18 通过；npm test 全绿；typecheck 零错。当前实测：E2E 18/18、unit 277 通过。

## 10. 落地顺序（主进程侧可先做）

1. preload 补 onStart + ChatStreamStart import —— 已落地（src/preload/index.ts，与 onChunk 同构）。
2. 导出纯函数事件映射 buildEventFromChannel —— 已落地（src/shared/chat-stream-events.ts + 9 单测；渲染端 hook 与主进程 mapEvent 共用，消除双写漂移）。
3. 桥接 hook —— 已落地（src/renderer/hooks/use-chat-stream-bridge.ts：7 通道订阅 + sessionId 过滤 + buildEventFromChannel 复用 + approve/abort；typecheck 零错）。renderer 源码就绪后：ChatView 以 useMemo 建 store → useChatStreamStore 读状态 → useChatStreamBridge 接线 → ApprovalCard → smoke 断言。

