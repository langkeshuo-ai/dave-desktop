# Desktop Merge Plan — zcode-client → dave-desktop 合并执行计划

> 状态：规划中
> 创建日期：2026-08-26
> 基础仓库：dave-desktop（目标）
> 来源仓库：zcode-client（吸收后归档）

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
| 安全架构 | ⚠️ 分散在 ipc.ts | ✅ 独立 ipc-security.mjs | zcode-client（需吸收） |
| 测试覆盖 | ⚠️ 主进程测试少 | ✅ 几乎每文件对应 .test.mjs | zcode-client（需吸收） |
| 功能广度 | ⚠️ 基础功能 | ✅ marketplace/plugins/parity/remote/checkpoints/tool-capability | zcode-client（需吸收） |

**结论**：以 dave-desktop 为代码基础，分阶段吸收 zcode-client 的安全架构、测试体系和缺失功能模块。

### 1.2 合并原则

1. **不重写，只迁移** — zcode-client 的模块用 TypeScript 重写后迁入 dave-desktop，保留原有逻辑
2. **每个阶段可独立验证** — 合并一个模块就跑一次完整测试，不搞大爆炸式合并
3. **安全优先** — 先迁移安全模块，再迁移功能模块
4. **测试先行** — 迁移模块时同步迁移对应的测试文件
5. **保留 dave-desktop 的 UI 和 i18n** — 这些是 dave-desktop 的优势，不替换

## 2. 架构对比

### 2.1 主进程模块对比

| 功能域 | dave-desktop | zcode-client | 合并动作 |
|--------|-------------|-------------|---------|
| **应用入口** | `index.ts` | `index.mjs` | 保留 dave-desktop |
| **IPC 通信** | `ipc.ts`（安全逻辑分散） | `ipc-security.mjs` + `rpc.mjs` | 吸收 ipc-security，重构 ipc.ts |
| **生命周期** | `lifecycle.ts` | `runtime.mjs` | 保留 dave-desktop |
| **会话管理** | `session.ts` + `session-runtime.ts` | `sessions.mjs` + `checkpoints.mjs` | 吸收 checkpoints |
| **Agent 循环** | `agent.ts` + `chat-loop.ts` | `tools.mjs` + `tool-capability.mjs` | 吸收 tool-capability 矩阵 |
| **Provider** | `providers.ts` + `secure-storage.ts` + `provider-url-policy.ts` | `providers.mjs` + `model.mjs` | 保留 dave-desktop（更完善） |
| **MCP** | `mcp-client.ts`（标准SDK） | `mcp.mjs`（自定义） | 保留 dave-desktop |
| **存储** | `store.ts` + `telemetry-store.ts` | `usage.mjs` | 吸收 usage 统计 |
| **更新** | （electron-updater 依赖） | `updater.mjs` + 完整测试 | 吸收 updater 逻辑 |
| **技能/插件** | ❌ 无 | `skills.mjs` + `plugins.mjs` + `marketplace.mjs` | **新增吸收** |
| **远程/浏览器** | ❌ 无 | `remote.mjs` + `browser.mjs`（BrowserHub） | **新增吸收** |
| **功能对齐** | ❌ 无 | `parity.mjs` | **新增吸收** |
| **协议** | ❌ 无 | `protocol.mjs` | **新增吸收** |
| **路径管理** | （内联） | `paths.mjs` | 吸收 paths 统一管理 |
| **错误处理** | `diagnostics.ts` | `app-error.mjs` | 合并 |
| **托盘** | `tray.ts` | （内联在 index） | 保留 dave-desktop |
| **自启动** | `autolaunch.ts` | （内联） | 保留 dave-desktop |
| **日志** | `structured-log.ts` | （内联） | 保留 dave-desktop |
| **ESM 兼容** | `esm-interop.ts` | （原生 ESM） | 保留 dave-desktop |

### 2.2 安全架构对比

**zcode-client 的安全层（需要吸收的核心）：**

```
ipc-security.mjs
├── 来源校验：仅主窗口主 frame / 受信任 file: / 开发 origin 可调用
├── payload 限制：深度限制 / 键数限制 / 字符串长度限制 / 危险键拦截
├── rpc.mjs
│   ├── JSON-RPC 形状校验
│   ├── 批量最多 20 项
│   └── 方法名最多 160 字符
├── browser-security.test.mjs
│   ├── 外链只允许 https:
│   ├── 嵌入式 BrowserHub 打开/导航/弹窗只允许 https:
│   └── 本地路径必须落在受信任根内
├── tools-security.test.mjs
│   ├── Bash/Write/Edit 默认拒绝
│   ├── 每次调用必须展示工具名/工作区/参数
│   └── 拒绝后不得执行工具
└── tool-capability.mjs
    └── 工具能力矩阵（哪些工具在哪些模式下可用）
```

**dave-desktop 当前安全状态：**
- `ipc.ts` 中有基础的 contextBridge 暴露
- `provider-url-policy.ts` 有 Provider URL 策略
- `secure-storage.ts` 有 safeStorage 加密
- ❌ 缺少独立的 IPC 来源校验
- ❌ 缺少 payload 深度/大小限制
- ❌ 缺少工具安全测试套件
- ❌ 缺少 BrowserHub 安全策略

## 3. 分阶段执行计划

### Phase 0：准备工作（0.5天）

- [ ] 在 dave-desktop 创建 `docs/merge/` 目录，存放合并跟踪文档
- [ ] 确认 dave-desktop 的 CI 流水线状态（typecheck/lint/test/build 全绿）
- [ ] 为合并创建专门分支 `merge/zcode-client`
- [ ] 备份 zcode-client 最新 commit SHA，确保可回溯

### Phase 1：安全架构迁移（最高优先级，2-3天）

**目标**：将 zcode-client 的独立安全层迁移到 dave-desktop。

#### 1.1 迁移 `ipc-security` 模块

- [ ] 用 TypeScript 重写 `ipc-security.mjs` → `src/main/security/ipc-guard.ts`
  - 来源校验：`isTrustedSender(event)` 函数
  - payload 校验：`validatePayload(payload)` 函数（深度/键数/字符串长度/危险键）
  - 危险键列表：`__proto__`, `constructor`, `prototype`, `pollute` 等
- [ ] 迁移 `ipc-security.test.mjs` → `src/main/security/ipc-guard.test.ts`
- [ ] 重构 `src/main/ipc.ts`，所有 IPC handler 入口调用 `ipcGuard.verify(event, payload)`
- [ ] 迁移 `rpc-security.test.mjs` → `src/main/security/rpc-guard.test.ts`
- [ ] 新增 `src/main/security/rpc-guard.ts`（JSON-RPC 形状校验）

#### 1.2 迁移工具安全

- [ ] 用 TypeScript 重写 `tool-capability.mjs` → `src/main/security/tool-capability.ts`
  - 工具能力矩阵：模式 × 工具 → 权限
  - 四种批准模式：suggest / auto / full-auto / always-ask
- [ ] 迁移 `tools-security.test.mjs` → `src/main/security/tool-capability.test.ts`
- [ ] 迁移 `tools-functional.test.mjs` → `src/main/agent/tools-functional.test.ts`
- [ ] 重构 `src/main/agent.ts`，工具执行前检查 `toolCapability.check(mode, toolName)`

#### 1.3 迁移浏览器安全

- [ ] 新增 `src/main/security/browser-policy.ts`
  - 外链协议白名单：仅 `https:`（开发模式允许 `http:`）
  - 本地路径受信任根：ZCode 数据目录 / 客户端数据目录 / 应用目录
  - BrowserHub 打开/导航/弹窗策略
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
  - 聚合：typecheck + lint + test + coverage + build + smoke
- [ ] 参考 zcode-client 的 `scripts/nightly-verify.mjs`，创建夜间验证脚本
- [ ] 参考 zcode-client 的 `scripts/release-evidence.mjs`，创建发布证据收集脚本
  - SBOM 生成（CycloneDX）
  - 许可证审计
  - 密钥扫描（gitleaks）
  - 制品哈希

#### 2.3 Phase 2 验证

- [ ] 测试覆盖率从当前水平提升（目标：主进程覆盖率 >60%）
- [ ] `npm run verify` 一键全量验证通过
- [ ] CI 流水线集成 verify-all

### Phase 3：功能模块迁移（3-5天）

**目标**：迁移 zcode-client 中 dave-desktop 缺失的功能模块。

#### 3.1 技能系统（Skills）

- [ ] 用 TypeScript 重写 `skills.mjs` → `src/main/skills/skills-manager.ts`
  - 技能发现：标准路径 `~/.agents/skills/` + 项目级 `.agents/skills/`
  - 技能加载：SKILL.md 解析 + 元数据提取
  - 技能搜索：BM25 相关性排序
  - 技能自动加载：高置信度匹配自动注入
- [ ] 迁移 `skills.test.mjs` → `src/main/skills/skills-manager.test.ts`
- [ ] Renderer 端新增技能管理 UI（Settings → Skills 标签页）
  - 技能列表、启用/禁用、搜索、分类筛选

#### 3.2 插件系统（Plugins）

- [ ] 用 TypeScript 重写 `plugins.mjs` → `src/main/plugins/plugin-manager.ts`
  - 插件发现/加载/卸载
  - 插件权限沙箱
  - 插件生命周期管理
- [ ] 迁移 `plugins.test.mjs` → `src/main/plugins/plugin-manager.test.ts`

#### 3.3 技能市场（Marketplace）

- [ ] 用 TypeScript 重写 `marketplace.mjs` → `src/main/marketplace/marketplace-client.ts`
  - 远程技能目录获取
  - 技能安装/卸载/更新
  - 技能评分/评论
- [ ] 迁移 `marketplace.test.mjs` → `src/main/marketplace/marketplace-client.test.ts`
- [ ] Renderer 端新增 Marketplace UI 面板

#### 3.4 检查点（Checkpoints）

- [ ] 用 TypeScript 重写 `checkpoints.mjs` → `src/main/session/checkpoints.ts`
  - 会话状态自动快照
  - 检查点回滚
  - 检查点对比
- [ ] 迁移 `checkpoints.test.mjs` → `src/main/session/checkpoints.test.ts`
- [ ] Renderer 端新增检查点 UI（会话时间线）

#### 3.5 路径统一管理（Paths）

- [ ] 用 TypeScript 重写 `paths.mjs` → `src/main/utils/paths.ts`
  - 统一管理所有数据目录路径
  - 跨平台路径适配（Win/macOS/Linux）
  - 受信任根路径定义
- [ ] 迁移 `paths.test.mjs` → `src/main/utils/paths.test.ts`
- [ ] 重构现有代码，将硬编码路径替换为 `paths.xxx`

#### 3.6 更新器（Updater）

- [ ] 用 TypeScript 重写 `updater.mjs` → `src/main/updater/updater-service.ts`
  - 更新检查/下载/安装
  - 更新源配置（HTTPS 固定源）
  - 制品哈希校验
  - 回滚支持
- [ ] 迁移 `updater.test.mjs` → `src/main/updater/updater-service.test.ts`

#### 3.7 使用统计（Usage）

- [ ] 用 TypeScript 重写 `usage.mjs` → `src/main/telemetry/usage-tracker.ts`
  - 本地使用统计（不上传）
  - 模型调用次数/Token 消耗/工具使用频率
  - 统计导出
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
  - 远程会话连接
  - SSH 隧道支持
  - 远程文件访问
- [ ] 迁移 `remote.test.mjs` → `src/main/remote/remote-service.test.ts`

#### 4.2 BrowserHub

- [ ] 用 TypeScript 重写 `browser.mjs` → `src/main/browser/browser-hub.ts`
  - 嵌入式浏览器
  - 安全导航策略
  - 页面截图/内容提取
- [ ] 迁移 `browser-hub.test.mjs` → `src/main/browser/browser-hub.test.ts`

#### 4.3 功能对齐（Parity）

- [ ] 用 TypeScript 重写 `parity.mjs` → `src/main/parity/parity-checker.ts`
  - 与官方 ZCode 功能对齐检查
  - 缺失功能报告
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

| Phase | 内容 | 预估工时 | 优先级 |
|-------|------|---------|--------|
| Phase 0 | 准备工作 | 0.5天 | P0 |
| Phase 1 | 安全架构迁移 | 2-3天 | P0 |
| Phase 2 | 测试体系迁移 | 1-2天 | P1 |
| Phase 3 | 功能模块迁移 | 3-5天 | P1 |
| Phase 4 | 远程与浏览器（可选） | 2-3天 | P2 |
| Phase 5 | 收尾与发布 | 1-2天 | P1 |
| **合计** | | **10-17天** | |

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
| Phase 0 | ⏳ 待开始 | | |
| Phase 1 | ⏳ 待开始 | | |
| Phase 2 | ⏳ 待开始 | | |
| Phase 3 | ⏳ 待开始 | | |
| Phase 4 | ⏳ 待开始 | | 可选 |
| Phase 5 | ⏳ 待开始 | | |
