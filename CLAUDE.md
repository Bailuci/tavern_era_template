# 酒馆助手前端界面、脚本与 ERA 角色卡编写

@AGENTS.md

## ERA 变量框架（ERA-Heron）集成约定

本模板基于 `StageDog/tavern_helper_template`，并预置了 **ERA-Heron** 制卡所需的工具、类型定义、文档与 AI 技能：

- **ERA 制卡流程技能**：`.agents/skills/era-character-card/SKILL.md`
- **ERA 完整使用文档**：`docs/era/`（`01-快速上手.md` … `06-分步更新.md` 与 `docs/era/示例/`）
- **ERA 前端工具库**：`util/era.ts`（代码中直接 `import { defineEraDataStore, ... } from '@util/era'`）
- **ERA 全局类型定义**：根目录 `exported.era.d.ts`（**注意**：不要移入 `@types/`，因为 `bump_deps.yaml` 会定期清空重建 `@types/`）

## 上游同步说明

- 请勿直接修改 `AGENTS.md`，个人或单卡的补充规范请写在本文件下方，以避免 `sync_template.yaml` 同步上游模板时产生冲突。
- ERA 变量框架本体研发与发版在独立仓库 `ERA-Heron` 中进行，本仓库只保留制卡端工具与文档。
