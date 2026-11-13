# 双模 Agent preset（规划 + 执行）

一个 DSH bundle：只声明一个 Agent preset（id `dual-model`），不注册任何 Host 服务或工具代码。

## 作用

- **主会话（规划 / 管理 / 验收）**：使用你在模型菜单里选的模型，和内置 `standard` preset 一样具备全部工具。
- **子代理（执行）**：通过 `subagent`（spawn）或 `subagent_fork`（fork）委派出去的子代理，默认使用
  `opencode-go / deepseek-v4.1-flash`，`reasoningEffort: high`；不再依赖主模型每次手动传参。
- 显式传参仍可覆盖默认值：`subagent` 的 `provider` / `model` / `reasoning_effort` 会覆盖 `agentOptions`（需要会话级模型选择白名单授权该路由）。

## 用法

1. 安装后，在**新任务 / 设置 → 通用 → Agent 预设**里选择「双模（规划 + 执行）」，并把它设为常用默认（可选）。
2. 在该会话的模型菜单里选择规划模型（例如 `mimo-v2.6-pro`、`glm-5.3`）；执行子代理不受它影响。
3. 让 Agent 把执行类工作委派给子代理即可；子代理会话日志里的 `provider/model` 应为 `opencode-go/deepseek-v4.1-flash`。

## 改默认执行模型

编辑本目录的 `cordis.patch.yml`，修改 `tool-subagent` / `tool-subagent-fork` 的 `agentOptions`
（`provider` / `model` / `reasoningEffort`），然后在 DSH 的插件页对 `@local/dsh-dual-model-preset`
重新安装（或卸载后重新安装）。改完需要**新会话**才会用到新的 preset revision。

## 与内置 `standard` preset 的差异

- 复制标准 preset 的插件列表，只增加两处 `agentOptions`。
- `skill-filesystem` 的 `customSkillDirs` 用绝对路径指向 Desktop 安装内的内置 `dsh-doc` 技能；
  应用被移动到其他路径后该目录只是失效，其他技能（用户 `~/.dsh/skills`、项目 `.dsh/skills`、
  Office / ponytail 等 Host 技能）不受影响。
- 其余行（平台判断、plan mode、压缩、委派、web、office、plugin manager 等）逐行照抄。

## 已知限制

- preset 不能指定主会话模型：规划模型仍由模型菜单决定。
- `workflow` 工具的 `agent()` 支持 `provider`/`model`，但不读取本 preset 的 `agentOptions`，也不支持 `reasoning_effort`；需要时请在 workflow 脚本里显式指定模型。
- `subagent_fork` 的 `modelSelection` 保持关闭（与内置一致）：fork 子代理固定用执行模型，不能按次覆盖。
- 修改后必须新开会话；已有会话保留启动时的 preset revision。
