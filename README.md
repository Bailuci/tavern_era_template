# tavern_era_template

基于 [StageDog/tavern_helper_template](https://github.com/StageDog/tavern_helper_template) 定制的 **ERA 角色卡 / 酒馆助手前端与脚本制卡母版**，内置 [ERA-Heron](https://github.com/Bailuci/ERA-Heron)（基于 ERA 变量框架二次开发，作者白鹭辞（Bailuci））制卡工具、类型定义、文档与 AI 技能。

## 自动更新链（二级模板同步）

```text
StageDog/tavern_helper_template
        │  sync_template.yaml (自动 PR)
        ▼
Bailuci/tavern_era_template（本母版）
        │  sync_template.yaml (自动 PR)
        ▼
派生的各角色卡 / 工具仓库
```

- **本母版仓库**：自动接收 `StageDog/tavern_helper_template` 的上游更新，并通过 `.github/.templatesyncignore.upstream` 保护内置的 ERA 工具、文档与技能不被覆盖。
- **从本母版 `Use this template` 创建的角色卡仓库**：自动接收本母版更新（同时包含青空莉上游模板 + 你更新的 ERA 工具/文档），并保护各自的 `src/`、`资料/`、`tavern_sync.yaml`、`README.md`。

## 内置 ERA 制卡资源

- `util/era.ts`：前端状态栏/脚本用的 ERA 数据 Store 工具（`@util/era`）
- `exported.era.d.ts`：ERA 全局类型声明（置于根目录以躲开 `bump_deps.yaml` 对 `@types/` 的定期重建）
- `.agents/skills/era-character-card/`：供 AI 助手读取的 ERA 制卡流程技能
- `docs/era/`：ERA-Heron 文档（01~07 与示例）
- `初始模板/ERA角色卡/`：开箱即用的 ERA 角色卡骨架（世界书规则与意图说明、ERA 正则、变量结构脚本、状态栏），复制到 `src/` 即可，用法见其中的 `使用说明.md`

## 常用命令

```bash
pnpm install   # 安装依赖
pnpm watch     # 开发热重载（配合酒馆助手实时监听 + tavern_sync）
pnpm build     # 全量生产构建
pnpm dump      # 生成 schema.json
pnpm sync      # 手动运行 tavern_sync
```

> Node 需要 22.18 及以上（`webpack.config.ts` 是 ESM TypeScript，靠 Node 自带的类型擦除加载）。如果只能用 22.6~22.17，先设置环境变量 `NODE_OPTIONS=--experimental-strip-types` 再运行 `pnpm build` / `pnpm watch`。
