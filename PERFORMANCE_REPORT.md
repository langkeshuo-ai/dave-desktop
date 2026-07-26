# Dave Desktop 性能优化报告

**版本**: 0.1.0 → 0.2.0-dev  
**优化周期**: Phase 1 完成  
**测试日期**: 2025-01-26

---

## 一、优化目标回顾

| 指标                  | 基线 (0.1.0) | 目标 (0.2.0) | 实际达成       |
| --------------------- | ------------ | ------------ | -------------- |
| 首屏 bundle           | 1.5MB        | <900KB       | **预计 850KB** |
| 非核心组件懒加载      | 否           | 是           | **✅ 完成**    |
| 虚拟滚动压测工具      | 无           | 有           | **✅ 完成**    |
| 2000 消息滚动帧率目标 | 未测试       | >50fps       | **待实测**     |

---

## 二、已完成优化项

### 2.1 Code Splitting（组件懒加载）

**实施方案**:

- 使用 React.lazy + Suspense 动态加载 5 个非核心组件
- 每个组件独立 chunk，按需加载

**优化组件清单**:

| 组件             | 预估大小 | 加载时机             | 优先级 |
| ---------------- | -------- | -------------------- | ------ |
| Settings         | ~300KB   | 用户点击设置按钮     | P0     |
| Welcome          | ~150KB   | 首次启动检测         | P0     |
| ApiKeyWizard     | ~120KB   | 首启或 API Key 缺失  | P0     |
| WorkspacePanel   | ~200KB   | 用户展开工作区面板   | P1     |
| CommandPalette   | ~80KB    | 用户按 Cmd/Ctrl+K    | P1     |
| **总计减少首屏** | ~850KB   | **首屏 bundle 降至** | ~650KB |

**技术细节**:

```tsx
// src/renderer/App.tsx
const Settings = lazy(() => import("./components/Settings"))
const Welcome = lazy(() => import("./components/Welcome"))
// ... 其他懒加载组件

// 使用 Suspense 包裹
<Suspense fallback={<div className="loading-spinner">加载中...</div>}>
  {settingsOpen && <Settings ... />}
</Suspense>
```

**收益验证**:

- ✅ TypeScript 编译通过（零错误）
- ✅ ESLint 检查通过（零警告）
- ✅ 单元测试通过（123/123）
- ⏳ 生产构建待验证（`npm run build`）

---

### 2.2 虚拟滚动性能测试工具

**实施方案**:

- 新增 `src/renderer/lib/fps-monitor.ts`：FPS 实时监控工具
- 新增 `src/renderer/lib/test-utils.ts`：测试消息生成器（支持 2000+ 条混合消息）
- ChatView 集成性能测试按钮（仅 dev 模式）

**功能清单**:

| 工具                        | 功能                                           | 使用方式                     |
| --------------------------- | ---------------------------------------------- | ---------------------------- |
| `FpsMonitor`                | 记录每帧耗时，计算 FPS、P50/P95/P99 延迟       | 开发者控制台查看报告         |
| `generateMixedTestMessages` | 生成 N 条混合消息（user/assistant/patch/code） | 性能测试按钮触发（dev 模式） |
| `messagesToMarkdown`        | 会话导出为 Markdown（含元数据）                | 用户可点击导出按钮           |

**开发者使用流程**:

1. 启动 dev 服务器：`npm run dev`
2. 打开开发者工具（F12）
3. 点击 ChatView 右上角"性能测试"按钮（仪表盘图标）
4. 自动生成 2000 条测试消息 + 启动 FPS 监控
5. 手动滚动消息列表，模拟真实用户操作
6. 再次点击按钮停止，控制台输出性能报告：
   ```
   === Virtual Scroll Performance Report ===
   Total Frames: 1234
   FPS (avg): 58.2
   Frame Time P50: 16.8ms
   Frame Time P95: 24.3ms
   Frame Time P99: 31.2ms
   ```

**压测消息生成策略**:

- **简单消息 (70%)**：纯文本（100-300 字符）
- **复杂消息 (30%)**：
  - Markdown code block（10 行 TypeScript）
  - Unified diff patch（50 行修改）
  - 长文本（1000+ 字符多段落）

**当前限制**:

- ⚠️ 测试消息生成后需手动注入到 store（当前仅打印到控制台）
- ⚠️ 需要增加 E2E 自动化测试，自动注入消息并测量滚动性能

---

## 三、性能监控基础设施

### 3.1 FPS 监控器（FpsMonitor）

**实现原理**:

```typescript
// 基于 requestAnimationFrame 的帧率监控
class FpsMonitor {
  start() {
    const loop = () => {
      const now = performance.now()
      const delta = now - this.lastFrameTime
      this.frameTimes.push(delta)
      this.lastFrameTime = now
      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  stop() {
    cancelAnimationFrame(this.rafId)
  }

  printReport(title: string) {
    // 计算 P50/P95/P99 百分位延迟
    const sorted = this.frameTimes.slice().sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length * 0.5)]
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    const p99 = sorted[Math.floor(sorted.length * 0.99)]
    console.log(`P50: ${p50.toFixed(1)}ms, P95: ${p95.toFixed(1)}ms, P99: ${p99.toFixed(1)}ms`)
  }
}
```

**关键指标**:

- **FPS (avg)**: 平均帧率，>50fps 流畅，<30fps 卡顿
- **P95 Frame Time**: 95% 帧的延迟，<20ms 理想，>30ms 需优化
- **P99 Frame Time**: 极端情况延迟，<50ms 可接受

---

### 3.2 测试消息生成器

**API 设计**:

```typescript
// 生成混合测试消息（模拟真实会话）
function generateMixedTestMessages(
  count: number,
  options?: {
    simpleRatio?: number // 简单消息比例（默认 0.7）
    complexRatio?: number // 复杂消息比例（默认 0.3）
  },
): ChatMessage[]

// 使用示例
const testMessages = generateMixedTestMessages(2000, {
  simpleRatio: 0.6,
  complexRatio: 0.4, // 40% 复杂消息（更高压力）
})
```

**消息类型分布**:

| 类型                 | 占比 | 示例内容                            |
| -------------------- | ---- | ----------------------------------- |
| User 简单问题        | 30%  | "如何优化 React 性能？"             |
| Assistant 纯文本回复 | 40%  | "可以考虑使用 React.memo..."        |
| Assistant Code Block | 15%  | TypeScript/Python 代码片段（10 行） |
| Assistant Patch      | 15%  | Unified diff（50 行修改）           |

---

## 四、待验证项

### 4.1 生产构建验证

**验证步骤**:

```powershell
# 1. 生产构建
npm run build

# 2. 检查 bundle 大小
ls out/renderer/*.js | Measure-Object -Property Length -Sum

# 3. 验证 chunk 分离
# 预期输出：
# - index-[hash].js (主 bundle, ~650KB)
# - Settings-[hash].js (~300KB)
# - Welcome-[hash].js (~150KB)
# - WorkspacePanel-[hash].js (~200KB)
# - ...

# 4. 启动预览
npm run preview
```

**成功标准**:

- [ ] 主 bundle < 900KB（目标 650KB）
- [ ] 懒加载组件独立 chunk（5 个）
- [ ] 应用启动无白屏（Suspense fallback 正常）

---

### 4.2 真实场景压测

**测试计划**:

| 场景     | 消息数 | 预期 FPS | 测试方法                        |
| -------- | ------ | -------- | ------------------------------- |
| 短会话   | 50     | >60fps   | 手动滚动                        |
| 中等会话 | 500    | >55fps   | 手动滚动 + FPS 监控             |
| 长会话   | 1000   | >50fps   | 性能测试工具 + 自动滚动脚本     |
| 极限压测 | 2000   | >45fps   | 性能测试工具 + 复杂消息占比 40% |

**自动化测试脚本**（待实现）:

```typescript
// tests/e2e/scroll-performance.spec.ts
test("2000 消息滚动性能", async ({ page }) => {
  // 1. 注入 2000 条测试消息
  await page.evaluate(() => {
    const messages = generateMixedTestMessages(2000)
    window.__injectTestMessages(messages)
  })

  // 2. 启动 FPS 监控
  await page.evaluate(() => window.__startFpsMonitor())

  // 3. 自动滚动（模拟用户行为）
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, 5000)
    await page.waitForTimeout(500)
  }

  // 4. 获取性能报告
  const report = await page.evaluate(() => window.__getFpsReport())
  expect(report.avgFps).toBeGreaterThan(50)
  expect(report.p95FrameTime).toBeLessThan(30)
})
```

---

## 五、已知问题与风险

### 5.1 当前限制

| 问题                     | 影响       | 缓解方案                  |
| ------------------------ | ---------- | ------------------------- |
| 测试消息手动注入         | 开发体验差 | 优先实现自动注入到 store  |
| 无 E2E 自动化压测        | 回归风险   | 下一阶段引入 Playwright   |
| Suspense fallback 无样式 | 用户体验   | 增加 loading spinner 样式 |

### 5.2 后续优化方向

**P0（必须优化）**:

- [ ] 实现测试消息自动注入到 store（通过 dev 工具面板）
- [ ] 增加 Suspense fallback 样式（居中 spinner + 模糊背景）
- [ ] 验证生产构建 bundle 大小（执行 `npm run build`）

**P1（建议优化）**:

- [ ] Playwright E2E 滚动性能测试
- [ ] MessageList memo 优化（避免流式时重渲染历史消息）
- [ ] ReactMarkdown 解析缓存（相同内容跳过重解析）

**P2（长期优化）**:

- [ ] Worker threads 执行 Agent 工具（避免阻塞主线程）
- [ ] 流式 diff 应用（降低大文件 patch 内存峰值）
- [ ] 冷启动优化（lazy require 非关键模块）

---

## 六、下一步行动

### Sprint 1 完成度：80%

**已完成**:

- ✅ Code splitting 实现（5 个组件懒加载）
- ✅ FPS 监控工具（FpsMonitor）
- ✅ 测试消息生成器（2000 条混合消息）
- ✅ Dev 模式性能测试按钮

**待完成（本周）**:

1. **生产构建验证**（30 分钟）

   ```powershell
   npm run build
   # 检查 out/renderer/*.js 大小
   ```

2. **测试消息自动注入**（2 小时）

   - 修改 ChatView 性能测试逻辑，直接调用 `useStore.getState().setMessages(testMessages)`
   - 验证 2000 条消息正常渲染

3. **Suspense fallback 样式**（30 分钟）
   - 增加全局 `.loading-spinner` 样式（居中 + 动画）

**下周计划（Sprint 2）**:

- 键盘交互增强（Cmd+K 命令面板、Esc 停止生成）
- 消息复制/编辑/搜索
- 工作区文件预览

---

## 七、参考文档

- [OPTIMIZATION_ROADMAP.md](./OPTIMIZATION_ROADMAP.md) — 完整优化计划
- [src/renderer/lib/fps-monitor.ts](./src/renderer/lib/fps-monitor.ts) — FPS 监控实现
- [src/renderer/lib/test-utils.ts](./src/renderer/lib/test-utils.ts) — 测试工具集
- [React.lazy 文档](https://react.dev/reference/react/lazy) — 官方懒加载指南
- [@tanstack/react-virtual](https://tanstack.com/virtual/latest) — 虚拟滚动库

---

**文档版本**: 1.0  
**最后更新**: 2025-01-26  
**负责人**: 待指定  
**下次审查**: Sprint 1 完成后（本周五）
