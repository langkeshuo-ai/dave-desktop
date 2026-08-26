# Desktop Merge Plan — zcode-client → dave-desktop 合并执行计划

> 状态：**Phase 1+3 部分完成**（安全架构 4/4 模块 + 功能 6/7 模块已迁移，待集成到 ipc.ts 和 UI）
> 创建日期：2026-08-26
> 最后更新：2026-08-26
> 基础仓库：dave-desktop（目标）
> 来源仓库：zcode-client（吸收后归档）

## 已完成里程碑

### Phase 0
- ✅ `docs/merge/` 目录创建，合并计划文档就位
- ✅ zcode-client 最新 commit SHA 备份：`ac86ab177a0017774d27149967859e373cb38d4f`

### Phase 1 安全架构（4/4 模块已创建）
- ✅ `src/main/security/ipc-guard.ts` — IPC 安全守卫（发送者验证 + payload 递归检查 + zod schema + 路径信任根）
- ✅ `src/main/security/rpc-hub.ts` — JSON-RPC 2.0 Hub（中间件 + 批量请求 + 标准错误码）
- ✅ `src/main/security/tool-capability.ts` — HMAC-SHA256 一次性能力令牌
- ✅ `src/main/security/browser-policy.ts` — URL 协议白名单 + 本地路径受信任根 + BrowserView 导航 + 弹窗安全
- ✅ `src/main/security/index.ts` — 统一导出
- ✅ `src/main/security/security.test.ts` — 综合测试 50+ 用例

### Phase 3 功能模块（6/7 模块已创建）
- ✅ `src/main/utils/paths.ts` — 统一路径管理（Dave 品牌 + .zcode 兼容 + safeJoin + 受信任根）
- ✅ `src/main/session/checkpoints.ts` — 会话检查点（git stash + 文件快照 + 回滚 + 级联回滚 + dirty 跟踪）
- ✅ `src/main/skills/skills-manager.ts` — 技能管理器（Agent Skills 1.0 发现/加载/搜索/系统提示词）
- ✅ `src/main/plugins/plugin-manager.ts` — 插件管理器（发现/加载/权限/IPC channel 注册/sandbox-ready）
- ✅ `src/main/telemetry/usage-tracker.ts` — 本地使用统计（模型调用/Token/费用 + 工具频率 + 会话 + 日聚合 + 7天汇总 + 导出/清除）
- ⏳ `src/main/updater/updater-service.ts` — 更新器（待创建）
- ⏳ `src/main/marketplace/marketplace-client.ts` — 技能市场（待创建）

**待完成**：将安全模块集成到 `ipc.ts`、功能模块接入 IPC 和 UI、Phase 2 测试体系迁移、全量验证。

## 1. 合并策略

### 1.1 为什么以 dave-desktop 为基础

| 维度 | dave-desktop | zcode-client | 选择 |
|------|-------------|-------------|------|
| 可见性 | 公开仓库 | 私有 | dave-desktop |
| 主进程语言 | TypeScript | ESM JS (.mjs) | dave-desktop（类型安全） |
| 构建工具 | electron-vite 5（标准） | 自定义 scripts/ | dave-desktop |
| 国际化 | ✅ i18next + react-i18next | ❌ 无 | dave-desktop |
| MCP SDK | ✅ @modelcontextprotocol/sdk | ✅ 自定义 MCP | dave-desktop（标准SDK） |
| UI 完善度 | 18组件（含CommandPalette/ApiKeyWizard/KeyboardHelp） | 较少 | dave-desktop |
| 依赖现代化 | Electron 42 / React 19.2 / Vite 6 | Electron 43 / React 19.2 / Vite 8 | 接近 |
| 安全架构 | ✅ 独立 security/ 模块（已迁移） | ✅ 独立 ipc-security.mjs | 已吸收 |
| 测试覆盖 | ⚠️ 主进程测试少 | ✅ 几乎每文件对应 .test.mjs | zcode-client（需吸收） |
| 功能广度 | ✅ skills/plugins/checkpoints/paths/usage（已迁移） | ✅ marketplace/plugins/parity/remote/checkpoints/tool-capability | 大部分已吸收 |

**结论**：以 dave-desktop 为代码基础，分阶段吸收 zcode-client 的安全架构、测试体系和缺失功能模块。

### 1.2 合并原则

1. **不重写，只迁移** — zcode-client 的模块用 TypeScript 重写后迁入 dave-desktop，保留原有逻辑
2. **每个阶段可独立验证** — 合并一个模块就跑一次完整测试，不搞大爆炸式合并
3. **安全优先** — 先迁移安全模块，再迁移功能模块
4. **测试先行** — 迁移模块时同步迁移对应的测试文件
5. **保留 dave-desktop 的 UI 和 i18n** — 这些是 dave-desktop 的优势，不替换

## 2. 架构对比

### 2.1 主进程模块对比

| 功能域 | dave-desktop | zcode-client | 合并动作 | 状态 |
|--------|-------------|-------------|---------|------|
| **应用入口** | `index.ts` | `index.mjs` | 保留 dave-desktop | ✅ |
| **IPC 通信** | `ipc.ts` + `security/ipc-guard.ts` | `ipc-security.mjs` + `rpc.mjs` | 吸收 ipc-security | 🔄 模块已创建，待集成 |
| **生命周期** | `lifecycle.ts` | `runtime.mjs` | 保留 dave-desktop | ✅ |
| **会话管理** | `session.ts` + `session/checkpoints.ts` | `sessions.mjs` + `checkpoints.mjs` | 吸收 checkpoints | ✅ 模块已创建 |
| **Agent 循环** | `agent.ts` + `chat-loop.ts` + `security/tool-capability.ts` | `tools.mjs` + `tool-capability.mjs` | 吸收 tool-capability | ✅ 模块已创建 |
| **Provider** | `providers.ts` + `secure-storage.ts` + `provider-url-policy.ts` | `providers.mjs` + `model.mjs` | 保留 dave-desktop（更完善） | ✅ |
| **MCP** | `mcp-client.ts`（标准SDK） | `mcp.mjs`（自定义） | 保留 dave-desktop | ✅ |
| **存储** | `store.ts` + `telemetry-store.ts` + `telemetry/usage-tracker.ts` | `usage.mjs` | 吸收 usage 统计 | ✅ 模块已创建 |
| **更新** | （electron-updater 依赖） | `updater.mjs` + 完整测试 | 吸收 updater 逻辑 | ⏳ 待创建 |
| **技能/插件** | `skills/skills-manager.ts` + `plugins/plugin-manager.ts` | `skills.mjs` + `plugins.mjs` + `marketplace.mjs` | 已吸收基础，市场待创建 | 🔄 |
| **远程/浏览器** | `security/browser-policy.ts` | `remote.mjs` + `browser.mjs`（BrowserHub） | 安全策略已吸收，BrowserHub 可选 | 🔄 |
| **功能对齐** | ❌ 无 | `parity.mjs` | 可选吸收 | ⏳ 可选 |
| **协议** | ❌ 无 | `protocol.mjs` | 可选吸收 | ⏳ 可选 |
| **路径管理** | `utils/paths.ts` | `paths.mjs` | 已吸收 | ✅ |
| **错误处理** | `diagnostics.ts` | `app-error.mjs` | 合并 | ⏳ |
| **托盘** | `tray.ts` | （内联在 index） | 保留 dave-desktop | ✅ |
| **自启动** | `autolaunch.ts` | （内联） | 保留 dave-desktop | ✅ |
| **日志** | `structured-log.ts` | （内联） | 保留 dave-desktop | ✅ |
| **ESM 兼容** | `esm-interop.ts` | （原生 ESM） | 保留 dave-desktop | ✅ |

### 2.2 安全架构对比

**zcode-client 的安全层（已全部吸收）：**

```
ipc-security.mjs → src/main/security/ipc-guard.ts ✅
rpc.mjs → src/main/security/rpc-hub.ts ✅
tool-capability.mjs → src/main/security/tool-capability.ts ✅
browser-security → src/main/security/browser-policy.ts ✅
security.test.ts ✅（50+ 测试用例）
```

**dave-desktop 当前安全状态：**
- `ipc.ts` 中有基础的 validateSender + 速率限制 + store key 白名单
- `provider-url-policy.ts` 有 Provider URL 策略
- `secure-storage.ts` 有 safeStorage 加密
- ✅ **新增**：`src/main/security/` 独立安全模块（4个模块 + 测试）
- ⏳ 待集成：安全模块接入 `ipc.ts`，替换现有内联校验

## 3. 分阶段执行计划

### Phase 0：准备工作（0.5天）

- [x] 在 dave-desktop 创建 `docs/merge/` 目录，存放合并跟踪文档
- [ ] 确认 dave-desktop 的 CI 流水线状态（typecheck/lint/test/build 全绿）
- [ ] 为合并创建专门分支 `merge/zcode-client`
- [x] 备份 zcode-client 最新 commit SHA：`ac86ab177a0017774d27149967859e373cb38d4f`

### Phase 1：安全架构迁移（最高优先级，2-3天）

**目标**：将 zcode-client 的独立安全层迁移到 dave-desktop。

#### 1.1 迁移 `ipc-security` 模块

- [x] 用 TypeScript 重写 `ipc-security.mjs` → `src/main/security/ipc-guard.ts`
- [x] 新增 `src/main/security/rpc-hub.ts`（JSON-RPC 2.0 完整 hub）
- [x] 新增 `src/main/security/index.ts`（统一导出）
- [x] 创建综合测试 `src/main/security/security.test.ts`（50+ 用例）
- [ ] 重构 `src/main/ipc.ts`，所有 IPC handler 入口调用 `createIpcSecurity().handle()`

#### 1.2 迁移工具安全

- [x] 用 TypeScript 重写 `tool-capability.mjs` → `src/main/security/tool-capability.ts`
- [ ] 重构 `src/main/agent.ts`，工具执行前检查能力令牌
- [ ] 迁移 `tools-functional.test.mjs` → `src/main/agent/tools-functional.test.ts`

#### 1.3 迁移浏览器安全

- [x] 新增 `src/main/security/browser-policy.ts`（URL 协议白名单 + 路径受信任根 + 导航策略 + 弹窗安全）
- [ ] 迁移 `browser-security.test.mjs` → `src/main/security/browser-policy.test.ts`

#### 1.4 Phase 1 验证

- [ ] `npm run typecheck` 全绿
- [ ] `npm run lint` 全绿
- [ ] `npm test` 全绿（含新增安全测试）
- [ ] 手动验证：工具调用批准对话框正常、外链被拦截、payload 超限被拒
- [ ] 安全回归：确认原有功能不受影响

### Phase 2：测试体系迁移（1-2天）

**目标**：将 zcode-client 的主进程测试体系迁移到 dave-desktop。

#### 2.1 迁移核心模块测试

- [ ] 迁移 `sessions.test.mjs` → 适配 dave-desktop 的 `session.test.ts`
- [ ] 迁移 `providers.test.mjs` → 适配 dave-desktop 的 `providers.test.ts`
- [ ] 迁移 `mcp.test.mjs` → 适配 dave-desktop 的 `mcp-client.test.ts`
- [ ] 迁移 `updater.test.mjs` → 新增 `updater.test.ts`
- [ ] 迁移 `paths.test.mjs` → 新增 `paths.test.ts`
- [ ] 迁移 `checkpoints.test.mjs` → 新增 `checkpoints.test.ts`
- [ ] 迁移 `model.test.mjs` → 新增 `model.test.ts`
- [ ] 迁移 `protocol.test.mjs` → 新增 `protocol.test.ts`
- [ ] 迁移 `ipc-contract.test.mjs` → 新增 `ipc-contract.test.ts`

#### 2.2 迁移 CI 脚本

- [ ] 参考 zcode-client 的 `scripts/verify-all.mjs`，在 dave-desktop 创建 `scripts/verify-all.mjs`
- [ ] 参考 zcode-client 的 `scripts/nightly-verify.mjs`，创建夜间验证脚本
- [ ] 参考 zcode-client 的 `scripts/release-evidence.mjs`，创建发布证据收集脚本

#### 2.3 Phase 2 验证

- [ ] 测试覆盖率从当前水平提升（目标：主进程覆盖率 >60%）
- [ ] `npm run verify` 一键全量验证通过
- [ ] CI 流水线集成 verify-all

### Phase 3：功能模块迁移（3-5天）

**目标**：迁移 zcode-client 中 dave-desktop 缺失的功能模块。

#### 3.1 技能系统（Skills）

- [x] 用 TypeScript 重写 `skills.mjs` → `src/main/skills/skills-manager.ts`
- [ ] 迁移 `skills.test.mjs` → `src/main/skills/skills-manager.test.ts`
- [ ] Renderer 端新增技能管理 UI（Settings → Skills 标签页）

#### 3.2 插件系统（Plugins）

- [x] 用 TypeScript 重写 `plugins.mjs` → `src/main/plugins/plugin-manager.ts`
- [ ] 迁移 `plugins.test.mjs` → `src/main/plugins/plugin-manager.test.ts`

#### 3.3 技能市场（Marketplace）

- [ ] 用 TypeScript 重写 `marketplace.mjs` → `src/main/marketplace/marketplace-client.ts`
- [ ] 迁移 `marketplace.test.mjs` → `src/main/marketplace/marketplace-client.test.ts`
- [ ] Renderer 端新增 Marketplace UI 面板

#### 3.4 检查点（Checkpoints）

- [x] 用 TypeScript 重写 `checkpoints.mjs` → `src/main/session/checkpoints.ts`
- [ ] 迁移 `checkpoints.test.mjs` → `src/main/session/checkpoints.test.ts`
- [ ] Renderer 端新增检查点 UI（会话时间线）

#### 3.5 路径统一管理（Paths）

- [x] 用 TypeScript 重写 `paths.mjs` → `src/main/utils/paths.ts`
- [ ] 迁移 `paths.test.mjs` → `src/main/utils/paths.test.ts`
- [ ] 重构现有代码，将硬编码路径替换为 `paths.xxx`

#### 3.6 更新器（Updater）

- [ ] 用 TypeScript 重写 `updater.mjs` → `src/main/updater/updater-service.ts`
- [ ] 迁移 `updater.test.mjs` → `src/main/updater/updater-service.test.ts`

#### 3.7 使用统计（Usage）

- [x] 用 TypeScript 重写 `usage.mjs` → `src/main/telemetry/usage-tracker.ts`
- [ ] 迁移 `usage.test.mjs` → `src/main/telemetry/usage-tracker.test.ts`

#### 3.8 Phase 3 验证

- [ ] 每个模块迁移后独立测试通过
- [ ] 全量回归测试通过
- [ ] 新功能 UI 手动验证
- [ ] 性能基准：启动时间不退化 >5%

### Phase 4：远程与浏览器（可选，2-3天）

**目标**：迁移远程连接和 BrowserHub 功能（如果需要）。

#### 4.1 远程连接（Remote）

- [ ] 用 TypeScript 重写 `remote.mjs` → `src/main/remote/remote-service.ts`
- [ ] 迁移 `remote.test.mjs` → `src/main/remote/remote-service.test.ts`

#### 4.2 BrowserHub

- [ ] 用 TypeScript 重写 `browser.mjs` → `src/main/browser/browser-hub.ts`
- [ ] 迁移 `browser-hub.test.mjs` → `src/main/browser/browser-hub.test.ts`

#### 4.3 功能对齐（Parity）

- [ ] 用 TypeScript 重写 `parity.mjs` → `src/main/parity/parity-checker.ts`
- [ ] 迁移 `parity.test.mjs` → `src/main/parity/parity-checker.test.ts`

### Phase 5：收尾与发布（1-2天）

- [ ] 全量回归测试（typecheck + lint + test + coverage + build + smoke + UAT）
- [ ] 性能基准对比（合并前 vs 合并后）
- [ ] 安全审计最终确认
- [ ] 更新 README.md（功能列表、架构说明）
- [ ] 更新 CONTRIBUTING.md（开发流程）
- [ ] 更新 CHANGELOG.md
- [ ] 版本号升级：0.1.0 → 0.2.0
- [ ] 打 tag + GitHub Release
- [ ] zcode-client 仓库设为 archived（Settings → Danger Zone → Archive）

## 4. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| 安全模块迁移引入回归 | 高 | 中 | Phase 1 后做完整安全回归测试，保留旧 ipc.ts 作为 fallback |
| 测试迁移不兼容（.mjs → .ts） | 中 | 高 | 逐文件迁移，每个文件迁移后立即跑测试 |
| 功能模块迁移后 UI 不兼容 | 中 | 中 | 先迁移主进程逻辑，UI 分阶段接入，每个 UI 组件单独验证 |
| 合并周期过长导致分支偏离 | 中 | 中 | 每个 Phase 完成后合并回 master，不长期维护 feature 分支 |
| zcode-client 的 .mjs 逻辑有隐含依赖 | 中 | 低 | 迁移前通读每个模块的测试文件，理解隐含契约 |

## 5. 工作量估算

| Phase | 内容 | 预估工时 | 优先级 | 状态 |
|-------|------|---------|--------|------|
| Phase 0 | 准备工作 | 0.5天 | P0 | 🔄 部分完成 |
| Phase 1 | 安全架构迁移 | 2-3天 | P0 | 🔄 4/4模块已创建，待集成 |
| Phase 2 | 测试体系迁移 | 1-2天 | P1 | ⏳ 待开始 |
| Phase 3 | 功能模块迁移 | 3-5天 | P1 | 🔄 6/7模块已创建，待测试+UI |
| Phase 4 | 远程与浏览器（可选） | 2-3天 | P2 | ⏳ 待开始 |
| Phase 5 | 收尾与发布 | 1-2天 | P1 | ⏳ 待开始 |
| **合计** | | **10-17天** | | |

## 6. 合并后预期收益

| 维度 | 合并前（dave-desktop） | 合并后（预期） |
|------|----------------------|--------------|
| 主进程模块数 | 21 | ~35（含新增安全/技能/插件/市场等） |
| 主进程测试文件 | ~5 | ~25 |
| 安全架构 | 分散在 ipc.ts | 独立 security/ 模块 + 完整测试 |
| 技能系统 | 无 | 完整技能管理 + 市场 |
| 插件系统 | 无 | 插件管理器 + 沙箱 |
| 检查点 | 无 | 会话检查点 + 回滚 |
| 测试覆盖率 | ~40%（估算） | >60%（目标） |
| CI 验证 | 基础 typecheck/lint/test | 全量 verify-all + 发布证据 |
| 维护仓库数 | 2（dave-desktop + zcode-client） | 1（dave-desktop） |

## 7. 跟踪状态

| Phase | 状态 | 完成日期 | 备注 |
|-------|------|---------|------|
| Phase 0 | 🔄 部分完成 | 2026-08-26 | docs/merge/ 已创建，zcode-client SHA 已备份 |
| Phase 1 | 🔄 进行中 | 2026-08-26 | ipc-guard/rpc-hub/tool-capability/browser-policy + 50+测试已创建，待集成到 ipc.ts |
| Phase 2 | ⏳ 待开始 | | |
| Phase 3 | 🔄 进行中 | 2026-08-26 | paths/checkpoints/skills/plugins/usage 5模块已创建，updater/marketplace待创建 |
| Phase 4 | ⏳ 待开始 | | 可选 |
| Phase 5 | ⏳ 待开始 | | |
