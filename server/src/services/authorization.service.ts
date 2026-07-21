import { UserRole } from '../models/user.model'

export type AuthorizationActor = {
  id: number
  role: UserRole
}

export type FeedbackAuthorizationSubject = {
  assignee_id: number | null
}

export type FeedbackPermissions = {
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

export function isManager(actor: AuthorizationActor) {
  return actor.role === 'manager'
}

export function canWorkFeedback(actor: AuthorizationActor, feedback: FeedbackAuthorizationSubject) {
  return isManager(actor) || feedback.assignee_id === actor.id
}

export function canEditRouting(actor: AuthorizationActor, feedback: FeedbackAuthorizationSubject) {
  return canWorkFeedback(actor, feedback) || feedback.assignee_id === null
}

export function canAssignFeedback(
  actor: AuthorizationActor,
  feedback: FeedbackAuthorizationSubject,
  requestedAssigneeId: number | null
) {
  if (isManager(actor)) return true
  const isClaiming = feedback.assignee_id === null && requestedAssigneeId === actor.id
  const isKeepingOwnAssignment = feedback.assignee_id === actor.id && requestedAssigneeId === actor.id
  return isClaiming || isKeepingOwnAssignment
}

export function feedbackPermissions(
  actor: AuthorizationActor,
  feedback: FeedbackAuthorizationSubject
): FeedbackPermissions {
  const manager = isManager(actor)
  const canWork = canWorkFeedback(actor, feedback)

  return {
    can_edit_routing: canEditRouting(actor, feedback),
    can_change_status: canWork,
    can_request_escalation: canWork,
    can_review_escalation: manager,
    can_mark_duplicate: canWork,
    can_add_note: canWork,
    can_delete: manager,
    can_merge_customer: manager,
    can_edit_message: manager,
  }
}
