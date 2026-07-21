import { db } from '../database/db'
import { FeedbackActivity } from '../models/feedback.model'

export function recordActivity(feedbackId: number, actorId: number | null, action: string, details: unknown) {
  db.prepare(
    'INSERT INTO feedback_activity (feedback_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(feedbackId, actorId, action, JSON.stringify(details), new Date().toISOString())
}

export function listActivity(feedbackId: number): FeedbackActivity[] {
  const rows = db.prepare(
    `SELECT a.*, u.name as actor_name
     FROM feedback_activity a
     LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.feedback_id = ?
     ORDER BY a.created_at DESC`
  ).all(feedbackId) as FeedbackActivity[]

  return rows.map((row) => {
    try {
      return { ...row, details: JSON.parse(String(row.details || '{}')) }
    } catch {
      return { ...row, details: {} }
    }
  })
}
