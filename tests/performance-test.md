# 虚拟滚动性能压测方案

## 目标

验证 MessageList 在 1000+ 消息会话的滚动性能，确保 >50fps 流畅度

## 测试场景

### 场景 1: 静态大数据集滚动

**步骤**:

1. 构造 2000 条模拟消息（user/assistant 交替）
2. 注入到当前会话的 messages 数组
3. 滚动到顶部 → 滚动到底部（全程测量帧率）
4. 记录最低帧率、平均帧率、卡顿帧数（<30fps）

**实施方式**:

```typescript
// 在 ChatView 添加测试按钮（仅 dev 模式）
const generateTestMessages = (count: number) => {
  const msgs = []
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content:
        i % 2 === 0
          ? `Test user message ${i}`
          : `Test assistant response ${i}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
    })
  }
  return msgs
}
```

### 场景 2: 流式渲染性能

**步骤**:

1. 在已有 1000 条消息的会话中
2. 触发新的流式响应（模拟每 50ms 追加一块文本）
3. 测量流式期间的渲染帧率
4. 验证 MessageBubble 的 React.memo 是否有效（历史消息不应重渲染）

**实施方式**:

```typescript
// 使用 React DevTools Profiler 记录组件渲染次数
// 预期：只有最后一条 MessageBubble 应在每个 chunk 时重渲染
```

### 场景 3: Markdown 复杂内容

**步骤**:

1. 构造 500 条包含复杂 Markdown 的消息（代码块 + 表格 + 列表）
2. 滚动测量帧率
3. 对比纯文本消息的性能差异

**示例消息**:

```markdown
# Test Heading

\`\`\`typescript
function example() {
return 'complex code block'
}
\`\`\`

| Column 1 | Column 2 |
| -------- | -------- |
| Data 1   | Data 2   |

- List item 1
- List item 2
```

## 性能指标

### 及格线

- 平均帧率: >50fps
- 最低帧率: >30fps
- 卡顿帧占比: <5%

### 优秀线

- 平均帧率: >55fps
- 最低帧率: >40fps
- 卡顿帧占比: <2%

## 测量工具

### Chrome DevTools Performance

1. 打开 DevTools → Performance 标签
2. 点击 Record
3. 执行滚动操作
4. 停止录制
5. 查看 Main 线程火焰图，重点关注:
   - Rendering: 渲染耗时
   - Scripting: JS 执行耗时
   - Painting: 绘制耗时

### React DevTools Profiler

1. 打开 React DevTools → Profiler
2. 点击 Record
3. 触发流式渲染或滚动
4. 查看组件重渲染次数和耗时
5. 验证 memo 优化是否生效

### 自定义 FPS 监控

```typescript
// src/renderer/lib/fps-monitor.ts
export class FpsMonitor {
  private frames: number[] = []
  private rafId: number | null = null

  start() {
    let lastTime = performance.now()
    const tick = () => {
      const now = performance.now()
      const delta = now - lastTime
      const fps = 1000 / delta
      this.frames.push(fps)
      lastTime = now
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId)
  }

  getStats() {
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length
    const min = Math.min(...this.frames)
    const stutters = this.frames.filter((f) => f < 30).length
    return { avg, min, stutters, total: this.frames.length }
  }
}
```

## 优化方向（如果不达标）

### 1. ReactMarkdown 解析优化

**问题**: 每次 streamingContent 更新都触发完整 Markdown 解析

**方案**:

- 增加内容 hash 校验，相同内容跳过解析
- 考虑 `react-markdown-preview`（预编译方案）
- 或自行实现增量解析（只解析新增部分）

### 2. 虚拟滚动配置调优

**当前**: `@tanstack/react-virtual` 默认配置

**可调参数**:

```typescript
const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 100, // 当前估算值，可能不准
  overscan: 5, // 可减少预渲染数量
})
```

**优化方向**:

- 减少 `overscan`（当前可能默认 5，可降至 3）
- 更精确的 `estimateSize`（按消息类型区分）

### 3. Markdown 组件 memo 优化

**当前**: MessageBubble 已用 memo，但 ReactMarkdown 内部未 memo

**方案**:

```typescript
const MemoizedMarkdown = memo(ReactMarkdown)
```

### 4. 代码高亮懒加载

**当前**: rehype-highlight 在首次渲染时加载全部语言包

**方案**:

- 按需加载语言包（仅高亮当前可见代码块的语言）
- 或使用 `lowlight`（体积更小）

## 验收标准

**Phase 1 完成条件**:

1. ✅ Code splitting 实施完成（Settings/Welcome/WorkspacePanel 懒加载）
2. ✅ Dev server 正常启动，应用功能无回归
3. ✅ 构建产物验证：renderer bundle <900KB
4. ✅ 虚拟滚动压测通过（2000 消息 >50fps）

**当前进度**:

- [x] Code splitting 实施（App.tsx 已改为 lazy）
- [ ] 构建产物大小验证
- [ ] 虚拟滚动压测脚本编写
- [ ] 性能测试执行 + 结果记录
