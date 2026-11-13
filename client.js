/**
 * Browser half: a compact token-usage chip in the Session header, placed right
 * after the subagent count (`conversation.session.header.actions`, order 15).
 *
 * It sums the durable `tokenUsage` projection (provider-reported, cumulative
 * per session log) of every local child Session in the current Session's
 * `subagentCatalog`. Child projections are refreshed on a short interval so the
 * chip follows running subagents; the tooltip carries the bucket breakdown.
 *
 * The Host half keeps its own job (executor routing + the model-facing
 * `subagent_token_usage` tool); this file only renders.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-subagent-executor-model',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Compact token count: 812, 12.4k, 1.3M. */
    function formatTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
      const size = Math.abs(value)
      if (size < 1000) return String(Math.round(value))
      if (size < 1000000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}k`
      return `${(value / 1000000).toFixed(1)}M`
    }

    /** Thousands separators for the tooltip. */
    function exact(value) {
      return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    return {
      inject: ['slots', 'sessions'],
      apply(ctx) {
        const chipStyle = {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          height: '24px',
          padding: '0 8px',
          borderRadius: '6px',
          fontSize: '12px',
          lineHeight: '24px',
          opacity: 0.75,
          whiteSpace: 'nowrap',
          cursor: 'default',
          userSelect: 'none',
        }

        /** Header action: total token usage of this Session's local subagents. */
        function SubagentTokenUsage(props) {
          const useProjection = props?.useProjection
          const useSessions = props?.useSessions
          // The slot framework binds both standard hooks; without them render nothing.
          if (typeof useProjection !== 'function' || typeof useSessions !== 'function') return null

          const catalog = useProjection('subagentCatalog')
          const children = Array.isArray(catalog)
            ? catalog.filter(entry => entry !== null && typeof entry === 'object' && entry.mode !== 'external')
            : []
          const ids = children.map(entry => entry.id).filter(id => typeof id === 'string')
          const idsKey = ids.join(',')

          const projections = useSessions(state => state?.projectionsBySession)

          React.useEffect(() => {
            if (ids.length === 0) return undefined
            const refresh = () => {
              for (const id of ids) {
                try {
                  void ctx.sessions.refreshProjections(id)?.catch?.(() => {})
                } catch {
                  // A child that cannot be refreshed simply keeps its last known value.
                }
              }
            }
            refresh()
            const timer = setInterval(refresh, 5000)
            return () => clearInterval(timer)
            // eslint-disable-next-line react-hooks/exhaustive-deps
          }, [idsKey])

          if (ids.length === 0) return null

          let input = 0
          let cacheRead = 0
          let cacheWrite = 0
          let output = 0
          let loaded = 0
          try {
            for (const id of ids) {
              const snapshot = projections?.[id]
              const usage = snapshot?.values?.tokenUsage
              if (usage === null || typeof usage !== 'object') continue
              loaded += 1
              input += Number(usage.uncachedInputTokens) || 0
              cacheRead += Number(usage.cacheReadTokens) || 0
              cacheWrite += Number(usage.cacheWriteTokens) || 0
              output += Number(usage.outputTokens) || 0
            }
          } catch {
            return null
          }
          const total = input + cacheRead + cacheWrite + output
          const label = loaded === 0 ? 'Σ …' : `Σ ${formatTokens(total)}`
          const title = [
            `子智能体 token 用量（已统计 ${loaded}/${ids.length} 个本地子代理）`,
            `未缓存输入 ${exact(input)} · 缓存读 ${exact(cacheRead)} · 缓存写 ${exact(cacheWrite)} · 输出 ${exact(output)}`,
            `合计 ${exact(total)} token`,
            '数据来自各子会话日志的 provider 上报累计用量；外部子代理不在本地，未计入。',
          ].join('\n')

          return h('span', { style: chipStyle, title, 'data-subagent-token-usage': `${total}` }, label)
        }

        ctx.slots.inject(
          'conversation.session.header.actions',
          () => ctx.slots.register({
            name: 'conversation.session.header.actions',
            id: 'subagent-token-usage',
            // Between the subagent count (10) and background tasks (20).
            order: 15,
          }, SubagentTokenUsage),
        )
      },
    }
  },
})
