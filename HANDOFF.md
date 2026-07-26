# 项目交接文档

## 1. 当前任务背景

**项目目标**: 对 dave 客户端进行全面规范化优化，包括工程规范、代码质量、UI/UX 主题改造（参考 Cursor 风格）

**技术栈**:

- Electron + Vite
- React 18 + TypeScript 5.7
- Tailwind CSS + 自定义 CSS 变量主题系统
- Vitest + ESLint + Prettier

**核心约束**:

- 必须保持功能完整性和测试通过
- 主题系统以 Cursor 的深色美学为目标
- 安全存储使用 Electron safeStorage（DPAPI/Keychain）
- IPC 通信有白名单校验和输入长度限制

---

## 2. 已完成工作

### Phase 1: 修复 typecheck + 仓库卫生 ✅

- **类型错误修复**:
  - `src/main/secure-storage.ts`: AsyncSafeStorage 类型定义，tryAsync 泛型声明
  - `src/main/ipc.ts`: validateSender 返回 boolean
  - `src/renderer/components/MessageList.tsx`: rehypeSanitize 类型兼容（元组 + never 断言）
- **白名单策略抽取**: `src/shared/store-policy.ts` 统一管理 store key 白名单和 session title 校验逻辑
- **测试覆盖**: 新增 `tests/unit.test.ts` 覆盖 shell-policy / store-policy / patch / telemetry
- **验证结果**: `npm run typecheck` 零错误，`npm test` 123 个测试全部通过

### Phase 2: 工程规范化工具链 ✅

- **ESLint 9 flat config**: `eslint.config.js` 使用 @eslint/js + typescript-eslint + react + react-hooks 插件
- **Prettier 集成**: `.prettierrc` + `.prettierignore`，`format` script 格式化全部源码
- **Git hooks**: Husky + lint-staged 配置 pre-commit 自动格式化和类型检查
- **验证结果**: lint 零警告，format 成功，build 成功

### Phase 3: Cursor 风格主题改造 ✅

- **深色优先调色板**: `src/renderer/styles/globals.css` 完全重写 CSS 变量
  - 主色: `--bg: #0f1117` (Cursor 经典深蓝灰背景)
  - 面板层: `--bg-panel: #171a23`, `--bg-sunk: #1e222e`
  - 重点色: `--accent: #5b8cff` (Cursor 签名蓝)
  - 语义色: 绿色成功 / 红色危险 / 黄色警告
- **浅色模式备份**: `html.light` 选择器覆盖为白底 + 蓝色重点
- **移除旧主题**: 删除原 `html.night` 变量残留
- **验证结果**: 格式化通过，typecheck 通过，测试通过，build 成功

---

## 3. 当前状态

### ✅ 已验证正常工作

1. **类型检查**: `tsc --noEmit` 双层（应用 + node）零错误
2. **单元测试**: Vitest 123 个测试全部通过（5.8s）
3. **构建流程**: `npm run build` 成功，生成 out/ 产物（main 71KB + preload 4KB + renderer 1.5MB）
4. **代码质量**: ESLint 零警告，Prettier 格式一致
5. **Git hooks**: pre-commit 自动运行 lint-staged

### ⚠️ 当前已知提示（非阻塞）

- **构建警告**（不影响功能）:
  - `store.ts` / `secure-storage.ts` 动态导入与静态导入混用（Vite 优化提示）
  - lucide-react "use client" 指令被忽略（正常，SSR bundle 不支持）

### 🎨 UI 主题迁移完成

- CSS 变量已全部切换为 Cursor 风格深色调色板
- 所有组件继续通过 `var(--xxx)` 引用，无需修改组件代码
- 用户可通过 `<html class="light">` 切换浅色模式（Settings 组件已有 theme 切换逻辑）

---

## 4. 下一步行动计划

### 🔍 Phase 4: 收尾验证与文档（进行中）

**优先级 1 — 端到端验证** (必做):

1. **运行应用实测主题**:

   ```powershell
   npm run dev
   ```
   - [ ] 验证深色主题视觉效果是否符合 Cursor 风格
   - [ ] 测试浅色模式切换是否正常
   - [ ] 检查所有交互组件（按钮/输入框/卡片/对话框）对比度和可读性

2. **安全存储功能验证**:
   - [ ] 在 Settings 中输入 API Key，验证 safeStorage 加密存储
   - [ ] 重启应用，验证密钥解密读取
   - [ ] Linux 环境测试（如果可用）确认非 basic_text 后端

**优先级 2 — 文档完善** (建议):

- [ ] 更新 README.md：添加开发流程、测试命令、构建说明
- [ ] 补充 CHANGELOG.md：记录本次规范化和主题改造内容
- [ ] 编写 CONTRIBUTING.md：贡献指南（ESLint/Prettier/Husky 使用说明）

**优先级 3 — 性能优化** (可选):

- [ ] 分析 renderer bundle（1.5MB）是否有优化空间（code splitting）
- [ ] MessageList 虚拟滚动性能测试（长会话 1000+ 消息）
- [ ] 考虑 React.lazy + Suspense 动态加载 Settings/Welcome 等非核心组件

---

## 5. 踩坑记录（重要）

### ❌ 不要重复的操作

1. **类型断言陷阱**:
   - `rehypeSanitize` 工厂函数签名与 `unified.Plugin` 不严格兼容（缺少 file/next 参数）
   - **正确做法**: 用元组 `[rehypeSanitize as never, schema as never]` 而非直接传函数
   - **错误做法**: 强制 `as Plugin` 会导致运行时参数不匹配

2. **safeStorage 初始化时机**:
   - 必须在 `app.whenReady()` **之后**调用 `initSecureStorage()`
   - **错误做法**: 在 main 顶层直接调用会导致 Electron API 未就绪崩溃
   - **正确位置**: `src/main/index.ts` 的 `app.whenReady()` 回调内

3. **CSS 变量命名一致性**:
   - 所有组件已通过 `var(--accent)` / `var(--bg-panel)` 等引用变量
   - **不要**在组件内硬编码颜色值（如 `#0f1117`），必须用变量保持主题切换能力

4. **ESLint 9 flat config 注意事项**:
   - `eslintrc` 已废弃，必须用 `eslint.config.js`
   - 插件导入方式变更: `import tseslint from 'typescript-eslint'` 而非 `@typescript-eslint/eslint-plugin`
   - `files` / `ignores` 字段必须在每个配置对象内明确声明

### ⚠️ 特殊配置和隐藏依赖

1. **Electron builder 配置**:
   - `electron-builder.config.ts` 使用 NSIS 打包器
   - `extraMetadata` 覆盖 package.json 的 main 字段（out/main/index.js）
   - 构建时 `electron-vite build` 必须先于 `electron-builder`

2. **Vitest 环境**:
   - `vitest.config.ts` 使用 `node` 环境（非 jsdom），因为测试的是 main 进程逻辑
   - `happy-dom` 在 devDependencies 但未启用（历史遗留）

3. **安全白名单策略**:
   - `src/shared/store-policy.ts`: 所有 store key 必须在 `ALLOWED_STORE_KEYS` 数组内
   - `src/shared/shell-policy.ts`: 允许的 shell 命令前缀白名单
   - **修改白名单时**必须同步更新对应的单元测试

---

## 6. 新对话启动指南

### 🚀 第一步：快速健康检查

```powershell
# 1. 验证依赖完整
npm install

# 2. 验证类型检查
npm run typecheck

# 3. 验证测试通过
npm test

# 4. 验证构建成功
npm run build

# 5. 启动开发服务器
npm run dev
```

**预期结果**: 全部命令成功，应用窗口打开显示深色 Cursor 风格主题。

### 🔍 继续工作前必读

1. **不要重新调查**:
   - 类型错误已全部修复（secure-storage / ipc / MessageList）
   - 工程工具链已完整配置（ESLint 9 + Prettier + Husky）
   - 主题系统已迁移到 Cursor 风格（globals.css 完全重写）

2. **核心文件位置**:
   - 主题变量: `src/renderer/styles/globals.css`（:root 和 html.light）
   - 安全存储: `src/main/secure-storage.ts` + `src/main/store.ts` 的 getSecure/setSecure
   - IPC 白名单: `src/main/ipc.ts` 的 validateSender + `src/shared/store-policy.ts`
   - 测试套件: `tests/unit.test.ts`（123 个测试）

3. **待办优先级**:
   - **高优**: Phase 4 端到端验证（运行 `npm run dev` 实测主题效果）
   - **中优**: 文档完善（README / CHANGELOG / CONTRIBUTING）
   - **低优**: 性能优化（bundle 分析 / 虚拟滚动压测）

### 📋 关键命令速查

```powershell
npm run dev          # 开发模式（热重载）
npm run build        # 生产构建
npm run typecheck    # TypeScript 类型检查
npm test             # Vitest 单元测试
npm run lint         # ESLint 检查
npm run format       # Prettier 格式化
```

---

## 附录：关键决策记录

1. **为什么选择 Cursor 风格主题？**
   - 用户明确要求"主题前端参考 cursor"
   - Cursor 的深色调色板（#0f1117 / #5b8cff）在开发工具中有良好视觉舒适度
   - 保持深色优先，浅色模式作为可选项

2. **为什么使用 safeStorage 而非自定义加密？**
   - Electron safeStorage 调用 OS 级密钥管理（DPAPI / Keychain / libsecret）
   - 安全性高于自定义 XOR-KDF 方案
   - 代码已处理 Linux basic_text 降级场景（拒绝存储并警告）

3. **为什么抽取 store-policy / shell-policy 到 shared？**
   - 白名单逻辑需要单元测试覆盖（Node 环境直接测试，无需 Electron mock）
   - 与 IPC 层解耦，main 层只做 adapter，业务逻辑在 shared 纯函数
   - 未来可能扩展到 preload 层校验（defense in depth）

---

**文档版本**: 2026-07-26  
**最后更新**: Phase 3 完成，Phase 4 进行中  
**下次启动建议**: 直接执行"第一步：快速健康检查"验证环境，然后运行 `npm run dev` 实测主题效果
