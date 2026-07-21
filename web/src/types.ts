export type FeedbackItem = {
  id: number
  customer_id: number
  customer_name: string
  customer_email: string
  channel: string
  message: string
  status: 'open' | 'resolved'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  priority_source: 'ai' | 'human' | null
  priority_reason: string | null
  category: 'praise' | 'bug' | 'billing' | 'outage' | 'feature_request' | 'question' | 'other'
  tags: string[]
  duplicate_of_id: number | null
  escalation_status: 'none' | 'pending' | 'approved' | 'rejected'
  escalation_reason: string | null
  assignee_id: number | null
  assignee_name: string | null
  due_at: string | null
  created_at: string
  permissions: {
    can_edit_routing: boolean
    can_change_status: boolean
    can_request_escalation: boolean
    can_review_escalation: boolean
    can_mark_duplicate: boolean
    can_add_note: boolean
    can_delete: boolean
    can_merge_customer: boolean
    can_edit_message: boolean
  }
}

export type FeedbackActivity = {
  id: number
  feedback_id: number
  actor_id: number | null
  actor_name: string | null
  action: string
  details: Record<string, unknown> | string
  created_at: string
}

export type User = {
  id: number
  email: string
  name: string
  role: 'agent' | 'manager'
  password?: string
}

export type InternalNote = {
  id: number
  feedback_id: number
  author_id: number
  author_name: string
  author_email: string
  body: string
  is_private: 0 | 1
  created_at: string
}

export type CustomerProfile = {
  id: number
  name: string
  email: string
  plan: string
  health_score: number
  history: FeedbackItem[]
}

export type Metrics = {
  open: number
  resolved: number
  urgent: number
  overdue: number
}

export type AgentAssistAction = {
  type: 'reply' | 'investigate' | 'route' | 'escalate' | 'follow_up' | 'resolve'
  urgency: 'now' | 'today' | 'later'
  title: string
  detail: string
}

export type AgentAssistResult = {
  recommendation: {
    assessment: string
    escalation: {
      level: 'none' | 'consider' | 'recommended' | 'required'
      reason: string
    }
    actions: AgentAssistAction[]
    human_check: string
  }
  source: 'cache' | 'generated' | 'shared_request'
  model: string
  generated_at: string
}
