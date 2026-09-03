# v0.4 技术规范（三候选并行，全部批发交付）

> 生成方式：staff-engineer-mode 专家审查 + archcore 项目约束（project-stack.rule）划线
> 决策前提：一次性交付、验证门禁收口、不留兼容层、ponytail 最小集
> 全部候选均给出 方案A(保守)/方案B(激进)/推荐，推荐理由含第一性原理与契约冲突检查

---

## 0. 总览与决策矩阵

| 候选 | 问题本质 | 方案A | 方案B | 推荐 | 优先级 |
|---|---|---|---|---|---|
| **A 渲染端执行可视化补全** | 已有能力(通道/状态机/patch载体)的 UI 应收账款 | 内联气泡平铺 | 侧边执行轨道 | **A2'（轨道+补丁预览，复用现有 token）** | P0 |
| **B 插件生命周期加固** | 隔离被延期后的契约缺口 | 立即进程隔离 | 生命周期契约补全 | **B2（维持延迟隔离）** | P2，决策先行 |
| **C v0.4 版本门禁整合** | 多轮增量后的收口欠账 | 仅补新 E2E | 全量回归矩阵 | **C2（门禁矩阵+缺件清单）** | P1 |

**总优先级**：A(P0) → C(P1) → B(P2)。理由：A 是用户可见的核心体验欠账且纯增量零风险；C 是交付可信度保障；B 是"防未来问题"，当前 <5 插件下属于推迟项（archcore 约束明文：插件数量超过 5 才启动隔离，不违反现有决策）。

---

## 1. 候选 A：渲染端执行可视化补全（P0）

### 1.1 现状事实（代码证据）

- `chat-stream-patch` 通道已推送 diff；`chat-stream-state` 中 patch 已改为**独立载体不污染正文**（content 保持）
- 渲染端只有 `tool_pending` 单行、`ApprovalCard`，**无 diff 预览组件、无工具执行结果详情、无撤销入口**
- `hljs` 已按需注册 `diff` 语言（MessageBubble 代码块渲染就绪）
- 会话消息中 tool 角色消息已持久化（session.get 可恢复）

### 1.2 方案对比

**方案 A1（内联平铺，保守）**：把 patch diff 直接渲染在流内气泡（复用现有 CodeBlock），工具结果作为 tool 气泡。改动最小（只有 ChatView 加两个分支）。

**方案 A2（侧边执行轨道，激进）**：新增右侧轨道面板，工具/审批/diff 全部从主消息流剥离，独立滚动区（原型 HTML 的"待确认变更托盘"形态）。改动中（新组件 + 布局重构 + 轨道滚动同步）。

**推荐 A2'（轨道+复用 token，收敛版）**：
- 不新建布局框架，把"执行轨迹"收敛为一条**折叠式总结卡**：工具名 → 状态（运行/完成/拒绝）→ 补丁预览（折叠，复用 CodeBlock+hljs diff）→ 撤销令牌（若有）
- 触发点：`done` 落常驻消息后，扫描本轮 `tool` 角色历史消息聚合渲染
- 反对 A1：diff 内联污染正文（与 M5 语义决策矛盾）；反对 A2 全轨：为当前单工具循环做滚动同步属过度工程

### 1.3 核心接口定义（renderer 侧）

```tsx
// 新组件：一次工具执行轨道的总结（挂在消息列表末、会话历史补拉渲染时按消息扫描）
interface ExecTraceCardProps {
  tool: { name: string; args: Record<string, unknown> }
  status: "ok" | "denied" | "failed" | "running"
  patch?: { diff: string; paths: string[] }   // 来自 chat-stream-patch 通道
  output?: string                              // tool 角色消息 content(clamp 后)
  onTogglePatch?: () => void                   // 折叠展开 diff 预览
}
```

### 1.4 数据设计变更

- **无 schema 变更**：patch/diff 已由 `chat-stream-patch` 契约承载；tool 执行结果已入会话消息（role:"tool"）
- 仅新增 renderer 本地聚合逻辑：从 `history` 中取 `role === "tool"` 的末 N 条分组渲染

### 1.5 关键实现逻辑

```ts
// 在 ChatView done 落常驻消息后，消费补丁与状态：
// 1) patch 暂存：bridge 收到 chat-stream-patch → store.dispatch 已保留 content（独立载体）
//                 另派发一条内部"patch 存档"事件（仅 renderer 局部 state，不入状态机）
// 2) 聚合：history 末尾连续 tool 消息 + pendingPatch 组装 ExecTraceCard[]
// 3) diff 预览：复用 CodeBlock（hljs diff 语言已注册），折叠展开由 onTogglePatch 控制
```

**挑战点**：patch 存档不能新增 StreamEvent（会破坏契约金标准）；用 renderer 局部 `useRef` 收集本轮 patch，随 done 落常驻时一并固化进历史衍生视图即可。

---

## 2. 候选 B：插件生命周期加固（P2，决策先行）

### 2.1 现状事实

- 插件市场扩展已走 IPC 契约（download/install/list 通道已有 schema 与限流）
- 进程隔离被 archcore 约束明文**推迟至插件数 > 5**

### 2.2 方案对比

**方案 B1（立即进程隔离，激进）**：UtilityProcess 承载插件运行时。挑战：与"<5 不隔离"既有决策冲突；引入 IPC 隧道、生命周期守卫、状态清理三大新面；当前唯一插件诉求是市场扩展而非运行时执行。**过工程设计，拒绝。**

**方案 B2（生命周期契约补全，推荐）**：不引入隔离，只补三件缺口：
1. `plugin-remove`/`plugin-upgrade` 契约（当前只有 install/list）——回收闭环（对应 HANDOFF"契约发布/回收闭环需完整实现"债务）
2. 插件异常退避：execute 失败连续 3 次 → 自动禁用（防市场扩展写坏 store 后程序反复崩）
3. 插件配置回滚点：安装前冻结 store 相关 key，安装失败自动回滚

### 2.3 核心接口定义（main 侧 IPC 契约）

```ts
// 契约登记（channelSchemas 追加）
pluginUninstall: z.tuple([z.object({ name: idSchema, marketplace: shortTextSchema.optional() }).strict()])
pluginUpgrade: z.tuple([z.object({ name: idSchema, fromVersion: z.string().max(32).optional() }).strict()])
```

### 2.4 数据设计变更

- 插件 registry 增加 `disabled` 标志与 `fails` 计数（store key 前缀 `plugin:` 现有切片内扩展）
- 无迁移：新增 key 属增量字段

### 2.5 关键实现逻辑

```ts
// 退避逻辑（main 侧 execute 包装）：
//   fails >= 3 → registry.disabled = true; 后续 execute 直接拒绝(429 语义)
//   升级成功后 fails = 0
// 回滚点：install 前 store-policy 冻结 plugin: 前缀快照 → 失败恢复快照 → 审计事件
```

---

## 3. 候选 C：v0.4 版本门禁整合（P1）

### 3.1 待办聚合（缺件清单）

| 类别 | 条目 | 现状 |
|---|---|---|
| 缺件 | 设置页 / 键盘帮助（lazy 组件在清单但 renderer 树重补时未恢复） | 待补 |
| 缺件 | 欢迎/配方屏（v0.4 首启体验） | 待补 |
| 门禁 | electron smoke 仍指向旧 renderer UI（welcome/cmdk/.msg-row） | 过时，应删除或重写（无兼容层原则） |
| 门禁 | 冷启动 / FPS 重新基线 | 性能报告已有，重建基线 |
| 门禁 | UAT（23 条历史）在新链上复跑 | 待跑 |
| 集成 | 会话消息恢复 UI 断言（session.get → ChatView 渲染） | chat:e2e 已覆盖落库；补"重启恢复渲染"场景 |

### 3.2 方案对比

**方案 C1（仅补新 E2E）**：只加 v0.4 场景。漏掉旧 smoke 误导风险。
**方案 C2（门禁矩阵 + 删过时）**：**推荐**。建 `tests/V0_4_GATES.md` 矩阵（unit 462 → E2E(chat/preview) → smoke 重写 → cold-start/FPS 基线 → UAT），并**删除旧 electron-smoke.mjs**（面向旧 UI，无兼容层）。

### 3.3 关键验收矩阵（摘要）

```
unit 462+（含候选 A 新增组件测试）    npm test
frontend-preview E2E 18               npm run preview:e2e
真实会话 E2E 3 断言                   npm run chat:e2e
smoke 重写版（新 renderer 冒烟）       tests/electron-smoke.mjs 重写
cold-start / FPS 基线                  tests/electron-coldstart.mjs 等（重建基线）
23 条 UAT 复跑                        tests/electron-uat.mjs
```

---

## 4. 三层验证策略（沿用既有门禁，零新增工具链）

1. 单测：契约(golden)+状态机+store + 候选 A 新增组件测试
2. 集成：chat:e2e 三断言 + preview:e2e 18 断言
3. 门禁矩阵：C2 定义，全部命令固化在 package.json

**约束审计**：本规范全部推荐项均通过 archcore 约束检查（pushWithGuard 契约、状态所有权、延迟隔离、不留兼容层），无违反项。