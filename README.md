# 子代理执行模型（Subagent executor model）

一个 **Host 层**的小插件：给委派出去的执行型子代理指定模型路由与推理强度。
它**不复制、不覆盖任何 Agent preset**，所以上游（DSH 自带的 `standard` 等 preset、`subagent` 工具）以后怎么改，你都能直接继承。

## 模型来源：跟随「子智能体设置」

执行模型**跟随你在插件页里配的子智能体模型选择**：

- 打开 **插件 → 子智能体 → 模型选择**，启用并勾选路由（当前是 `opencode-go / deepseek-v4.1-flash`）；
- 插件在每次创建子代理时读取该设置，**取列表里的第一条路由**作为执行模型；
- 该设置关闭或列表为空时，回退到本插件配置里的 `provider` / `model`（见下）；
- 推理强度（`reasoningEffort`）**不**来自那个设置，由本插件配置手动指定。

## 为什么这样做

之前「双模」bundle 的写法是把 `standard` preset 整份复制一份，再给 `tool-subagent` 加 `agentOptions`。它能用，但 DSH 升级后新工具/新字段不会自动进来，属于“冻结快照”。

这个插件改用两个官方接缝：

1. `agent/created` 事件：监听器执行完之前，子智能体排队的输入不会开始，所以能在第一个请求前改路由；
2. `agent.model.select({ provider, model, reasoningEffort })`：Agent 自带的持久模型选择 API，选择的完整值从下一个步骤生效。

效果：**preset 用内置的 `standard`**（或任意 preset），被委派出来的本地子智能体默认走执行模型；根会话模型仍由模型菜单决定。

## 手动配置推理强度

在 [cordis.patch.yml](./cordis.patch.yml) 里改这一行，然后在插件页重装/更新本 bundle：

```yaml
      config:
        provider: opencode-go       # 仅当「子智能体 → 模型选择」关闭/为空时使用的回退路由
        model: deepseek-v4.1-flash
        reasoningEffort: max        # ← 手动指定：low / high / max；删掉该行则用模型默认
```

当前执行模型 `deepseek-v4.1-flash` 支持 `low`、`high`、`max`（默认未声明，不传由网关决定）。

> DSH 不会为插件自动生成配置表单；「推理强度」目前就是上面的配置文件里手动改。
> 如果要把它做成插件页里的图形设置，需要额外写一个客户端 UI 插件（可以后续加）。

## 判定规则

| 情况 | 行为 |
|---|---|
| 子代理创建路由与父会话当前选择一致（即“继承”） | 改为执行模型 + 配置的推理强度 |
| 调用时显式传了 `provider/model`（`subagent` 调用或 workflow 脚本） | **保留**显式选择，不覆盖 |
| 根会话（`origin` 不是 `subagent`） | 不处理 |
| 子代理已经在目标路由 + 强度上 | 不重复记录选择 |
| 找不到存活的父 Agent（无法确认是否显式指定） | 不处理，保持原样 |

## 覆盖范围

- 只处理**本地 in-process 子智能体**（`subagent`、`subagent_fork`、`workflow`、`ralph` 等都会命中）；ACP / Codex / Claude Code 等外部子代理不是本地 Agent，不受影响。
- `maxDepth`、并发上限、会话级模型选择白名单等 Host 设置照旧生效；本插件只改执行侧默认路由，不放开白名单。
- 显式同路由同强度的“覆盖”无法与继承区分，会被当成继承处理（极少数情况）。

## 生效与验证

- 安装/更新后对新创建的子智能体立即生效（实测无需重启）；修改配置后重新安装 bundle。
- 验证：子代理会话日志的 `request/header.config` 应等于「子智能体设置的路由 + 配置的推理强度」。
- 与旧的 preset 复制方案互不冲突，但不要同时保留；本插件已取代它。

## 卸载

插件页卸载 `@local/dsh-subagent-executor-model`；子代理恢复为继承父会话模型。
