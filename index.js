/**
 * Host plugin: give delegated execution subagents a default model route.
 *
 * DSH exposes no preset-independent "child model" setting, and copying a
 * preset to add one drifts from upstream. This plugin instead uses two
 * supported seams: the `agent/created` event (listeners finish before queued
 * input starts) and `agent.model.select()`, which records the Session's model
 * choice for its next step. Shipped presets and tools stay untouched.
 *
 * A child whose creation route still equals its parent's current selection is
 * treated as "inherited" and receives the configured executor route. A child
 * started with an explicit route (a `subagent` call passing provider/model, or
 * a workflow script naming one) keeps that route.
 *
 * @module @local/dsh-subagent-executor-model
 */

export const name = 'subagent-executor-model'

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
  const route = reasoningEffort === undefined
    ? { provider, model }
    : { provider, model, reasoningEffort }
  return { route, presets: presets === undefined ? undefined : new Set(presets) }
}

/** Compare an optional route value without materializing `undefined`. */
function effortOf(options) {
  return options?.reasoningEffort ?? undefined
}

export function apply(ctx, config) {
  const { route, presets } = normalize(config)

  ctx.on('agent/created', ({ agent }) => {
    try {
      const header = agent.session.header
      // Only delegated children; the root Session keeps the planner model.
      if (header.origin !== 'subagent') return
      if (presets !== undefined && (header.agentPreset === undefined || !presets.has(header.agentPreset))) return
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
