export type AgentAssistEscalationLevel = 'none' | 'consider' | 'recommended' | 'required'
export type AgentAssistActionType = 'reply' | 'investigate' | 'route' | 'escalate' | 'follow_up' | 'resolve'
export type AgentAssistUrgency = 'now' | 'today' | 'later'

export type AgentAssistAction = {
  type: AgentAssistActionType
  urgency: AgentAssistUrgency
  title: string
  detail: string
}

export type AgentAssistRecommendation = {
  assessment: string
  escalation: {
    level: AgentAssistEscalationLevel
    reason: string
  }
  actions: AgentAssistAction[]
  human_check: string
}

export type AgentAssistResult = {
  recommendation: AgentAssistRecommendation
  source: 'cache' | 'generated' | 'shared_request'
  model: string
  generated_at: string
}
