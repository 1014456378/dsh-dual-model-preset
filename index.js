/**
 * Host plugin with two independent parts:
 *
 * 1. Executor routing (`agent/created` + `agent.model.select`): delegated
 *    children get a default model route without copying an agent preset. The
 *    model follows the user's Subagent model-selection setting, and
 *    `reasoningEffort` comes from this plugin's config.
 * 2. Token usage reporting (`subagent_token_usage` tool): sums provider-reported
 *    usage per agent in the current subagent tree from durable session logs.
 *
 * Shipped presets and tools stay untouched, so upstream changes keep flowing in.
 *
 * @module @local/dsh-subagent-executor-model
 */

export const name = 'subagent-executor-model'

/** The tool registry is required for the usage report; event work needs no service. */
export const inject = ['tools']

/** Validate the row config at activation; a bad route must fail loudly. */
function normalize(config) {
  const provider = config?.provider
  const model = config?.model
  if (typeof provider !== 'string' || provider.length === 0) {
    throw new Error('subagent-executor-model: `provider` must be a non-empty string')
  }
  if (typeof model !== 'string' || model.length === 0) {
    throw new Error('subagent-executor-model: `model` must be a non-empty string')
  }
  const reasoningEffort = config?.reasoningEffort
  if (reasoningEffort !== undefined && (typeof reasoningEffort !== 'string' || reasoningEffort.length === 0)) {
    throw new Error('subagent-executor-model: `reasoningEffort` must be a non-empty string when present')
  }
  const presets = config?.presets
  if (presets !== undefined && (!Array.isArray(presets) || presets.some(id => typeof id !== 'string' || id.length === 0))) {
    throw new Error('subagent-executor-model: `presets` must be a non-empty list of preset ids when present')
  }
  return {
    fallback: { provider, model },
    reasoningEffort,
    presets: presets === undefined ? undefined : new Set(presets),
  }
}

/**
 * Read the user's Subagent model-selection setting: the first allowed route
 * wins. An absent, disabled, or empty setting returns undefined so the
 * plugin's own fallback applies. Private-looking accessors are used
 * defensively because the setting lives in another package.
 */
function allowedModelRoute(ctx) {
  try {
    const setting = ctx.get('subagentModelSelection')?.current?.()
    if (setting?.enabled !== true) return undefined
    const routes = setting.allowedModels
    if (!Array.isArray(routes) || routes.length === 0) return undefined
    const route = routes[0]
    if (typeof route?.provider !== 'string' || route.provider.length === 0) return undefined
    if (typeof route?.model !== 'string' || route.model.length === 0) return undefined
    return { provider: route.provider, model: route.model }
  } catch {
    return undefined
  }
}

/** Compare an optional route value without materializing `undefined`. */
function effortOf(options) {
  return options?.reasoningEffort ?? undefined
}

/** Compose the complete selection for one executor child. */
function executorSelection(ctx, { fallback, reasoningEffort }) {
  const route = allowedModelRoute(ctx) ?? fallback
  return reasoningEffort === undefined
    ? { provider: route.provider, model: route.model }
    : { provider: route.provider, model: route.model, reasoningEffort }
}

/**
 * Sum provider-reported usage of one session log. Forked sessions inherit a
 * parent prefix, whose usage belongs to the parent: events before
 * `inheritedEventCount` are skipped.
 */
function sumUsage(events, inheritedEventCount) {
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0, calls: 0 }
  for (const event of events ?? []) {
    if (typeof event?.seq === 'number' && typeof inheritedEventCount === 'number' && event.seq < inheritedEventCount) continue
    if (event?.type !== 'assistant/message') continue
    const reported = event.data?.usage
    if (reported === null || typeof reported !== 'object') continue
    usage.calls += 1
    for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'totalTokens']) {
      const value = reported[key]
      if (typeof value === 'number' && Number.isFinite(value)) usage[key] += value
    }
  }
  return usage
}

/** Format one count with thousands separators. */
function count(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** One usage report row. */
function usageLine(name, usage, suffix = '') {
  return `| ${name} | ${count(usage.calls)} | ${count(usage.inputTokens)} | ${count(usage.cacheReadTokens)} | ${count(usage.outputTokens)} | ${count(usage.totalTokens)} |${suffix}`
}

/** Register the usage-report tool. Root agents only: children do not need it. */
function registerUsageTool(ctx) {
  const definition = {
    name: 'subagent_token_usage',
    description:
      'Report provider-reported token usage for every agent in the current subagent tree (the lead and all descendants). '
      + 'Each row sums that session log\'s assistant-message usage: input, cache-read input, output, and total tokens, plus model calls. '
      + 'Forked children exclude the parent prefix they inherit. External (out-of-process) children have no local session and are listed without counts.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('subagent_token_usage requires a calling agent')
      const query = ctx.get('sessionQuery')
      if (query === undefined) throw new Error('subagent_token_usage requires the session history service')
      const subagents = ctx.get('subagents')

      let root = agent
      try {
        root = subagents?.rootOf?.(agent) ?? agent
      } catch {
        // A caller without a managed tree reports its own session only.
      }
      const rootId = root.session.header.id
      const rows = [{ name: 'lead', id: rootId, depth: 0, external: false }]
      const notes = []
      if (subagents !== undefined) {
        let descendants
        try {
          descendants = await subagents.listDescendants(rootId, exec.signal)
        } catch (error) {
          descendants = undefined
          notes.push(`- 子会话发现失败：${error instanceof Error ? error.message : String(error)}`)
        }
        for (const row of descendants ?? []) {
          if (row?.kind === 'diagnostic') {
            rows.push({ name: String(row.id).slice(0, 8), id: row.id, depth: 1, external: true, note: row.reason })
            continue
          }
          rows.push({
            name: row?.path ?? String(row?.id ?? '').slice(0, 8),
            id: row?.id,
            depth: typeof row?.depth === 'number' ? row.depth : 1,
            external: false,
          })
        }
      }

      const lines = [
        '| Agent | 模型调用 | 输入 | 缓存读 | 输出 | 总计 |',
        '| --- | ---: | ---: | ---: | ---: | ---: |',
      ]
      const total = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0, calls: 0 }
      let counted = 0
      for (const row of rows) {
        const label = `${'  '.repeat(row.depth)}${row.name}`
        if (row.id === undefined) {
          lines.push(`| ${label} | - | - | - | - | - |`)
          continue
        }
        let usage
        try {
          const snapshot = await query.readSession(row.id)
          usage = sumUsage(snapshot.events, snapshot.inheritedEventCount)
        } catch (error) {
          lines.push(`| ${label} | 无本地会话（外部子代理） |  |  |  |  |`)
          continue
        }
        counted += 1
        for (const key of Object.keys(total)) total[key] += usage[key]
        lines.push(usageLine(label, usage))
      }
      if (counted > 1) {
        lines.push('| --- | ---: | ---: | ---: | ---: | ---: |')
        lines.push(usageLine('**合计**', total))
      }
      lines.push('')
      lines.push('说明：用量来自各会话日志的 `assistant/message.usage`；fork 子会话继承的父前缀不计入；会话标题等内部请求不计入。')
      for (const note of notes) lines.push(note)
      return lines.join('\n')
    },
  }
  ctx.effect(() => ctx.tools.register(definition, {
    // Only the tree root needs this report; children keep their tool list small.
    when: ({ agent }) => agent === undefined || agent.session.header.origin !== 'subagent',
  }))
}

export function apply(ctx, config) {
  const normalized = normalize(config)
  registerUsageTool(ctx)

  ctx.on('agent/created', ({ agent }) => {
    try {
      const header = agent.session.header
      // Only delegated children; the root Session keeps the planner model.
      if (header.origin !== 'subagent') return
      if (normalized.presets !== undefined
        && (header.agentPreset === undefined || !normalized.presets.has(header.agentPreset))) return
      const parentId = header.parentSession
      if (parentId === undefined) return

      const parent = ctx.get('agents')?.get?.(parentId)
      const parentSelection = parent?.model?.current?.()
      // A missing live parent means inheritance cannot be verified; leave the child alone.
      if (parentSelection === undefined || parentSelection.provider === undefined || parentSelection.model === undefined) return

      const initial = agent.options ?? {}
      const inheritedRoute = initial.provider === parentSelection.provider
        && initial.model === parentSelection.model
      const inheritedEffort = effortOf(initial) === effortOf(parentSelection)
      // An explicit per-child selection differs from the parent; keep it.
      if (!inheritedRoute || !inheritedEffort) return

      const route = executorSelection(ctx, normalized)
      // Already on the executor route: do not add a redundant selection record.
      if (initial.provider === route.provider
        && initial.model === route.model
        && effortOf(initial) === route.reasoningEffort) return

      agent.model.select(route)
    } catch (error) {
      // A failing default must never block creation of the delegated child.
      ctx.logger?.warn?.(`subagent-executor-model: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
