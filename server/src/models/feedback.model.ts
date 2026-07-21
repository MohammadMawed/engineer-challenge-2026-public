export type Priority = 'low' | 'normal' | 'high' | 'urgent'
export type PrioritySource = 'ai' | 'human' | null
export type FeedbackStatus = 'open' | 'resolved'
export type FeedbackCategory = 'praise' | 'bug' | 'billing' | 'outage' | 'feature_request' | 'question' | 'other'
export type EscalationStatus = 'none' | 'pending' | 'approved' | 'rejected'

export type Feedback = {
  id: number
  customer_id: number
  channel: string
  message: string
  status: FeedbackStatus
  priority: Priority
  priority_source: PrioritySource
  priority_reason: string | null
  category: FeedbackCategory
  tags: string
  duplicate_of_id: number | null
  escalation_status: EscalationStatus
  escalation_reason: string | null
  assignee_id: number | null
  due_at: string | null
  created_at: string
}

export type FeedbackActivity = {
  id: number
  feedback_id: number
  actor_id: number | null
  actor_name: string | null
  action: string
  details: Record<string, unknown>
  created_at: string
}

export type FeedbackView = Feedback & {
  customer_name: string
  customer_email: string
  assignee_name: string | null
}
