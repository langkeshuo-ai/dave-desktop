# 贡献指南

感谢参与 Dave Desktop 开发！本指南帮助你快速上手项目规范和工作流。

## 开发环境要求

- **Node.js**: 20.x 或更高
- **npm**: 10.x 或更高
- **操作系统**: Windows 10+ / macOS 12+ / Ubuntu 22.04+
- **编辑器**: 推荐 VS Code + ESLint + Prettier 插件

## 首次设置

```bash
# 1. 克隆仓库
git clone <repo-url>
cd dave客户端开发

# 2. 安装依赖
npm install

# 3. 验证环境（必做）
npm run typecheck  # 应零错误
npm test           # 应全部通过（123 个测试）
npm run lint       # 应零警告

# 4. 启动开发服务器
npm run dev
```

## 代码规范

### TypeScript

- **严格模式**: `strict: true`（tsconfig.json / tsconfig.node.json）
- **禁止 `any`**: 使用 `unknown` + 类型守卫或泛型
- **组件类型**: React 函数组件用 `function Component() {}` 而非箭头函数（与 memo 配合更清晰）
- **导入顺序**: Node 内置 → 第三方 → 项目内（`#/` 别名）→ 类型导入

### ESLint

项目使用 **ESLint 9 flat config**（`eslint.config.js`）：

```bash
# 检查所有文件
npm run lint

# 自动修复（仅安全修复）
npm run lint -- --fix
```

**核心规则**:

- `@typescript-eslint/no-explicit-any`: error
- `react-hooks/rules-of-hooks`: error
- `react-hooks/exhaustive-deps`: warn
- 禁止 `console.log`（main 进程用 `electron-log`，renderer 可用 console）

### Prettier

统一格式化配置（`.prettierrc`）：

```bash
# 格式化全部源码
npm run format

# 检查格式（CI 用）
npm run format -- --check
```

**关键配置**:

- `semi: false` — 无分号
- `printWidth: 100` — 行宽 100
- `trailingComma: "all"` — 尾逗号
- `tabWidth: 2` — 2 空格缩进

### Git Hooks

项目使用 **Husky + lint-staged** 自动化 pre-commit 检查：

```bash
# pre-commit 自动执行（无需手动）：
# 1. Prettier 格式化暂存文件
# 2. ESLint 检查暂存文件
# 3. TypeScript 类型检查
```

**绕过 hooks**（仅紧急情况）:

```bash
git commit --no-verify
```

## 测试

### 运行测试

```bash
# 全部测试（123 个）
npm test

# 监听模式（开发时推荐）
npm test -- --watch

# 覆盖率报告
npm test -- --coverage
```

### 测试文件组织

```
tests/
├── unit.test.ts        # 核心逻辑单元测试
└── fixtures/           # 测试数据
```

### 编写测试原则

1. **纯函数优先**: 将业务逻辑抽到 `src/shared/` 纯函数，便于单测（无需 Electron mock）
2. **用例命名**: `describe("模块名") { test("should 做某事 when 条件", ...) }`
3. **断言清晰**: 使用 `expect(...).toBe(...)` 而非 `expect(...).toBeTruthy()`
4. **覆盖边界**: 空值、超长输入、非法字符、并发竞态

## 提交规范

遵循 **Conventional Commits**:

```
类型(作用域): 简短描述

详细说明（可选）

BREAKING CHANGE: 破坏性变更说明（可选）
```

**类型**:

- `feat`: 新功能
- `fix`: 修复 bug
- `refactor`: 重构（不改变外部行为）
- `perf`: 性能优化
- `test`: 增加/修复测试
- `docs`: 文档更新
- `chore`: 构建/工具变更

**示例**:

```bash
git commit -m "feat(secure-storage): 支持 safeStorage 异步 API"
git commit -m "fix(ipc): validateSender 返回 boolean 而非 void"
git commit -m "refactor(theme): 迁移到 Cursor 风格深色调色板"
```

## 项目结构

```
dave客户端开发/
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── index.ts       # 入口（app 生命周期）
│   │   ├── ipc.ts         # IPC 处理器（白名单校验）
│   │   ├── store.ts       # electron-store 封装
│   │   ├── secure-storage.ts  # safeStorage 封装
│   │   ├── chat-loop.ts   # Agent 工具循环
│   │   └── providers/     # AI provider 适配器
│   ├── preload/           # Preload 脚本
│   │   └── index.ts       # contextBridge 暴露 API
│   ├── renderer/          # React 渲染进程
│   │   ├── App.tsx        # 根组件
│   │   ├── components/    # UI 组件
│   │   ├── styles/        # CSS（globals.css 主题变量）
│   │   └── stores/        # Zustand 状态管理
│   └── shared/            # 跨进程共享逻辑
│       ├── types.ts       # TypeScript 类型定义
│       ├── store-policy.ts    # Store 白名单策略
│       ├── shell-policy.ts    # Shell 命令白名单
│       └── patch.ts       # unified-diff 解析
├── tests/                 # Vitest 测试
├── electron-builder.config.ts  # 打包配置
├── vite.config.ts         # Vite 配置（renderer）
├── eslint.config.js       # ESLint 9 flat config
├── .prettierrc            # Prettier 配置
└── tsconfig.json          # TypeScript 配置
```

## 常见任务

### 添加新的 AI Provider

1. 在 `src/main/providers/` 创建新适配器（参考 `openai.ts`）
2. 实现 `streamChat()` 方法（SSE / fetch stream）
3. 在 `src/main/providers.ts` 注册新 provider
4. 更新 `src/renderer/components/Settings.tsx` UI
5. 添加连接测试逻辑到 `probeProviderConnection()`

### 添加新的 Agent 工具

1. 在 `src/main/agent.ts` 添加工具函数（`tool*`）
2. 在 `BUILTIN_TOOLS` 数组注册工具定义（OpenAI function calling schema）
3. 在 `executeToolCall()` 添加分支逻辑
4. 更新 `src/shared/shell-policy.ts` 如果涉及 shell 命令
5. 添加单元测试到 `tests/unit.test.ts`

### 修改主题变量

1. 编辑 `src/renderer/styles/globals.css`
2. 修改 `:root`（深色）或 `html.light`（浅色）CSS 变量
3. 保持变量名不变（如 `--accent`），只改颜色值
4. 运行 `npm run dev` 实时预览

### 添加新的 IPC 通道

1. 在 `src/main/ipc.ts` 添加 `ipcMain.handle()` 处理器
2. 添加 `validateSender(event)` 校验
3. 在 `src/preload/index.ts` 暴露到 `window.api.*`
4. 在 `src/shared/types.ts` 添加类型定义
5. 在 `src/renderer/` 调用 `window.api.*`

## 调试技巧

### 主进程调试

```bash
# 启动开发模式
npm run dev

# 查看日志文件
# Windows: %USERPROFILE%\AppData\Roaming\dave-desktop\logs\main.log
# macOS: ~/Library/Logs/dave-desktop/main.log
# Linux: ~/.config/dave-desktop/logs/main.log
```

### 渲染进程调试

- **DevTools**: 开发模式自动打开，或按 `Ctrl+Shift+I` / `Cmd+Option+I`
- **React DevTools**: 已集成（electron-devtools-installer）
- **Network**: 查看 AI provider 请求（SSE stream）

### 类型检查

```bash
# 双层检查（应用 + node）
npm run typecheck

# 仅应用层
npx tsc --noEmit -p tsconfig.json

# 仅 node 层
npx tsc --noEmit -p tsconfig.node.json
```

## 性能优化建议

1. **MessageList 虚拟滚动**: 使用 `@tanstack/react-virtual` 优化长会话（已实现）
2. **React.memo**: 历史消息避免重渲染（已实现 MessageBubble memo）
3. **Code splitting**: 考虑 React.lazy + Suspense 动态加载 Settings / Welcome
4. **Bundle 分析**: `npm run build` 后检查 out/ 目录，renderer bundle 当前 1.5MB

## 安全注意事项

### IPC 白名单

- **所有 store 操作**必须检查 `isAllowedStoreKey(key)`（`src/shared/store-policy.ts`）
- **所有 IPC handler**必须调用 `validateSender(event)`（生产构建强制）
- **用户输入长度**必须限制（`STORE_VALUE_MAX`、`SESSION_TITLE_MAX`）

### Shell 命令

- **仅允许白名单命令**（`src/shared/shell-policy.ts`）
- **禁止任意 shell**（即使 full-auto 模式）
- **参数必须校验**（路径遍历、命令注入）

### Markdown 渲染

- **rehype-sanitize 白名单**已配置（`MessageList.tsx`）
- **禁止 rehype-raw**（会引入 XSS 风险）
- **className 必须保留**（hljs 高亮需要）

## 发布流程

1. **版本号**: 更新 `package.json` 的 `version` 字段
2. **Changelog**: 更新 `CHANGELOG.md`（遵循 Keep a Changelog 格式）
3. **构建测试**: `npm run build && npm test`
4. **打包**: `npm run package:win` / `package:mac` / `package:linux`
5. **验证**: 安装生产包，手动测试核心功能
6. **标签**: `git tag v1.0.0 && git push --tags`

## 获取帮助

- **Issue**: 提交 bug 报告或功能请求（附带复现步骤 + 日志）
- **Discussion**: 设计讨论或技术选型
- **日志**: 附带 `main.log`（移除敏感信息如 API Key）

## 许可证

MIT License — 详见 LICENSE 文件
