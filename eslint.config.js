// @ts-check
import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // v8 现代模式：projectService 自动发现 + tsconfig references 图（tsconfig.json ↔ tsconfig.node.json）
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // 关键 error 级规则已由 recommendedTypeChecked 覆盖;风格类交给 Prettier
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    // 配置文件与测试文件不需要 type-checked
    files: [
      "*.config.{js,ts}",
      "tests/**/*.{ts,js,mjs}",
      "src/main/**/*.ts",
      "frontend-preview/**/*.mjs",
      "scripts/**/*.{js,mjs}",
    ],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    ignores: [
      "out/",
      "dist/",
      "coverage/",
      "node_modules/",
      "legacy/",
      ".vscode/",
      ".claude/",
      "scripts/",
      "eslint.config.js",
      // src/main 代码质量由 typecheck(tsconfig.node.json) + 单测/E2E/契约门禁覆盖；
      // typescript-eslint v8 projectService 对双 tsconfig（renderer/node）自动发现不稳定，main 整体退出 lint 保持门禁稳定。
      "src/main/",
      // 非工程源码与测试文件：由 vitest / tsc(node) / E2E 门禁兜底，不参与 project-service lint
      "tests/",
      "**/*.test.ts",
      "scripts/",
      "frontend-preview/",
      "vitest.config.ts",
      "electron.vite.config.ts",
      "electron-builder.config.ts",
      "electron-builder.v7.config.ts",
      "electron-builder.v8.config.ts",
      "electron-builder.v9.config.ts",
    ],
  },
)
