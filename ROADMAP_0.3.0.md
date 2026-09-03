# Dave Desktop 0.3.0 规划(初稿)

> **创建**:2026-08-01 · **前序**:0.2.0 可验证验收标准全部达成(完整 verify 单次 exit 0、164 tests、UAT 21/21、smoke、真实 bug 修复×2)
> **方法论**:复用已验证的六维循环——研究(开源优先)→ 差距 → 执行 → 验证 → 落档
> **触发条件**:0.2.0 发布(远端 CI 落地 + 签名 + 真实 Key 验收)后启动

---

## 1. 能力差距与方向优先级

对照参考项目(atomcode / claude code / codex / hermes / cc-haha 等)与 `OPTIMIZATION_ROADMAP.md` §十 差距矩阵:

| 方向                  | 差距                 | 0.2.0 基础                                                                           | 优先级 |
| --------------------- | -------------------- | ------------------------------------------------------------------------------------ | ------ |
| **skills / 工具市场** | ❌(参考项目共性能力) | MCP 工具集成已落地(`mcp__server__tool` + 审批 + 集成测试),工具注册/审批/调用链路完整 | P0     |
| **i18n 国际化**       | ❌(中文 UI 单语)     | 文案集中在组件与 shared 纯函数,无硬编码散落;色彩/布局与文案解耦                      | P1     |
| **跨平台**            | 仅 Windows 验证      | electron-builder 三平台配置就绪(mac dmg/zip、linux AppImage/deb)                     | P1     |

## 2. 开源优先评估

| 方案                                                                          | 评估                                                                                                                                 | 结论                                                                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **i18next**(v26.3.6, MIT, 2026-07-09 更新, 活跃维护 ≥3 次/6 个月 ✓, 文档全 ✓) | 满足复用三标准;React 绑定 `react-i18next` 同生态                                                                                     | ✅ **复用**;待实现时锁定版本并纳入 audit 门禁                                                                       |
| **skills 加载器**                                                             | 通用 skills 协议(claude-code 的 skills、smithy 等)与本项目 agent 工具循环(审批/工作区/patch)深度耦合;自建约 200 行基于 shared 纯函数 | ⚠️ **自建**(符合"确凿技术理由"豁免:通用方案无法复用本项目安全纵深);skills 目录格式参考通用惯例(skill.md + 工具声明) |
| **跨平台构建**                                                                | electron-builder 已配置;无需新依赖                                                                                                   | ✅ 复用现有配置,需真机验证                                                                                          |

## 3. 里程碑与验证标准

### M1:skills 市场(P0,约 1-2 周)

- ✅ **第一步(基础能力)已实施(2026-08-01)**:`src/shared/skills.ts`(SkillDefinition + validateSkill/parseSkills 纯函数)、store `skills` 白名单、`skills-list`/`skills-set` IPC(校验+去重)、Settings「扩展」tab `SkillsPanel`(增删 + 复制内容取用)、单测 2 条(166 全过)
- ✅ **第二步(agent 工具集成)已实施(2026-08-01)**:`skill__<name>` 命名空间 + `skillToolDefs` 注册到 runAgentLoop + runToolCalls 技能分支(无条件审批,技能内容注入工具结果)+ code_review 修复(内容纯函数 + 安全注释)+ 单测 169 全过
- ⏳ **剩余(发布后)**:skills 目录扫描(`skills-loader.ts`)+ UAT 追加"已安装 skills 展示"步骤
- 设计约束:skill 工具一律需审批(技能内容为任意 prompt,潜在注入载体;与 MCP 一致);复用 `runToolCalls` 分支
- **验证标准**:单测 ≥5 条;verify 全绿;UAT 追加"已安装 skills 展示"步骤

### M2:i18n(P1,约 1-2 周,可并行 M1)

- ✅ **第一步(基础设施)已实施(2026-08-01)**:接入 i18next 26.3.6 + react-i18next 17(MIT/活跃);
  `shared/locale.ts`(SUPPORTED_LOCALES zh-CN/en + validateLocale);renderer i18n 基础设施
  (initI18n/changeLocale + zh-CN/en 资源);Settings 界面语言选择(持久化 store locale,重启保持);
  设置标题/选项卡/sectionTitle 迁移至 t();单测 2 条(172 全过)、build 42.68s 正常
- ✅ **第二步(核心组件文案迁移)已实施(2026-08-01)**:Settings 全量(模型/工作区/扩展/MCP/技能/漏斗/日志/诊断/通用按钮)、ChatView/MessageInput(状态栏/搜索/导出/输入提示)、KeyboardHelp(17 条快捷键 descKey 化)迁移至 t(),en 完整翻译;`scripts/scan-hardcoded-zh.mjs` 扫描脚本(报告剩余候选:App.tsx 状态消息/模式标签等);UAT 追加语言切换步骤(en 标题变 Settings 再切回)
- ⏳ **剩余(后续)**:App.tsx 状态消息/模式标签等剩余文案抽取;UAT 全量运行验证
- **验证标准**:语言切换即时生效且持久化(UAT 步骤);全部用户可见文案经 t() 提取(脚本扫描硬编码中文);verify 全绿

### M3:跨平台(P1,需机器)

- 实现:macOS/Linux 真机构建 + smoke + UAT 子集;修复平台差异(路径/换行/safeStorage backend 已处理)
- **验证标准**:三平台 build 成功 + smoke 通过;`MAC-LINUX` 台账项关闭

## 4. 依赖与协同

- M1 与 M2 并行(M1 触达 agent 循环,M2 触达 UI 层,文件面重叠小);
- M3 依赖 M2(UI 文案 i18n 后跨平台截图一致)与外部机器;
- 全部里程碑复用"单测 + verify + smoke + UAT"四层验证链(0.2.0 已建立);
- 每里程碑结束更新台账与 `INTEGRATED_OVERVIEW.md`(保持唯一入口文档准确)。

## 5. 触发条件(外部输入,沿用 0.2.0)

- 0.2.0 正式发布(远端 CI 建仓需 GitHub 写权限、签名证书、真实 Key E2E、发布后漏斗数据——见 `INTEGRATED_OVERVIEW.md` §8);
- 跨平台需 macOS/Linux 机器;
- M2 引入 i18next 前复跑依赖审计(确认不新增高危链)。

---

**版本**:0.1 · **负责人**:待指定 · **下次评审**:0.2.0 发布后
