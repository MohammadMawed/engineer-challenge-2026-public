import { db } from '../database/db'
import type { AgentAssistRecommendation } from '../models/agent-assist.model'

type AgentAssistCacheRow = {
  recommendation: string
  model: string
  created_at: string
}

export type CachedAgentAssist = {
  recommendation: unknown
  model: string
  generatedAt: string
}

export function findCachedAgentAssist(cacheKey: string): CachedAgentAssist | undefined {
  const row = db
    .prepare('SELECT recommendation, model, created_at FROM agent_assist_cache WHERE cache_key = ?')
    .get(cacheKey) as AgentAssistCacheRow | undefined

  if (!row) return undefined

  try {
    return {
      recommendation: JSON.parse(row.recommendation),
      model: row.model,
      generatedAt: row.created_at,
    }
  } catch {
    return undefined
  }
}

export function saveAgentAssist(
  cacheKey: string,
  feedbackId: number,
  recommendation: AgentAssistRecommendation,
  model: string,
  generatedAt: string
) {
  db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO agent_assist_cache
       (cache_key, feedback_id, recommendation, model, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(cacheKey, feedbackId, JSON.stringify(recommendation), model, generatedAt)

    db.prepare("DELETE FROM agent_assist_cache WHERE datetime(created_at) < datetime('now', '-30 days')").run()
  })()
}
