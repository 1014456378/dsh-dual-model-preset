# 子代理执行模型（Subagent executor model）

一个 **Host 层**的小插件：给委派出去的执行型子代理一个默认的 `provider / model / reasoningEffort`。
它**不复制、不覆盖任何 Agent preset**，所以上游（DSH 自带的 `standard` 等 preset、`subagent` 工具）以后怎么改，你都能直接继承。

## 为什么这样做

之前「双模」bundle 的写法是把 `standard` preset 整份复制一份，再给 `tool-subagent` 加 `agentOptions`。它能用，但 DSH 升级后新工具/新字段不会自动进来，属于“冻结快照”。

这个插件改用两个官方接缝：

1. `agent/created` 事件：监听器执行完之前，子智能体排队的输入不会开始，所以能在第一个请求前改路由；
2. `agent.model.select({ provider, model, reasoningEffort })`：Agent 自带的持久模型选择 API，选择的完整值从下一个步骤生效。

效果：**preset 用回内置的 `standard`**（或任意 preset），所有被委派出来的本地子智能体默认走配置的执行模型；根会话模型仍由模型菜单决定。

## 配置（`cordis.patch.yml`）

```yaml
- insert:
    - id: subagent-executor-model
      name: '@local/dsh-subagent-executor-model'
      config:
        provider: opencode-go
        model: deepseek-v4.1-flash
        reasoningEffort: high
        # 可选：只对特定 preset 的会话生效；省略 = 所有 preset
        # presets: [standard]
```

## 判定规则

| 情况 | 行为 |
|---|---|
| 子代理创建路由 = 父会话当前选择（即“继承”），且强度也一致 | 改为执行模型 + 强度 |
| 子代理创建路由与父会话不同（`subagent` 调用显式传了 `provider/model`，或 workflow 脚本指定了模型） | **保留**显式选择，不覆盖 |
| 根会话（`origin` 不是 `subagent`） | 不处理 |
| 子代理已经在目标路由上 | 不重复记录选择 |
| 找不到存活的父 Agent（无法确认是否显式指定） | 不处理，保持原样 |

## 覆盖范围

- 只处理**本地 in-process 子智能体**（`subagent`、`subagent_fork`、`workflow`、`ralph` 等都会命中）；ACP / Codex / Claude Code 等外部子代理不是本地 Agent，不受影响。
- `maxDepth`、并发上限、会话级模型选择白名单等 Host 设置照旧生效；本插件只改默认路由，不放开白名单。
- 显式同路由同强度的“覆盖”无法与继承区分，会被当成继承处理（极少数情况）。

## 生效与验证

- 安装后对新创建的子智能体立即生效（不需要重启）；修改配置后重新安装 bundle。
- 验证：子代理会话日志的 `request/header` 里 `config` 应为配置的 `provider / model / reasoningEffort`。
- 与本仓库的 `dual-model-preset` 互不冲突；两者同时安装时，preset 的 `agentOptions` 会让子代理创建路由变成执行模型，本插件按规则跳过（视为显式）。
  想保持“继承上游”，建议只保留本插件，使用内置 `standard` preset。

## 卸载

插件页卸载 `@local/dsh-subagent-executor-model`；子代理恢复为继承父会话模型。
