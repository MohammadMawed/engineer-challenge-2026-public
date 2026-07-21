import { db } from '../database/db'
import { Feedback, FeedbackView } from '../models/feedback.model'

const DUPLICATE_STOP_WORDS = new Set([
  'about', 'after', 'again', 'been', 'before', 'could', 'does', 'from', 'have', 'into',
  'just', 'more', 'some', 'that', 'their', 'there', 'they', 'this', 'very', 'what',
  'when', 'where', 'which', 'with', 'would', 'your',
])

const feedbackViewSelect = `
  SELECT f.*, c.name AS customer_name, c.email AS customer_email, u.name AS assignee_name
  FROM feedback f
  JOIN customers c ON c.id = f.customer_id
  LEFT JOIN users u ON u.id = f.assignee_id`

export function findFeedbackById(id: number): Feedback | undefined {
  return db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as Feedback | undefined
}

export function findFeedbackHistory(customerId: number, limit = 8): FeedbackView[] {
  return db
    .prepare(`${feedbackViewSelect} WHERE f.customer_id = ? ORDER BY f.created_at DESC LIMIT ?`)
    .all(customerId, limit) as FeedbackView[]
}

function duplicateSearchQuery(message: string) {
  const words = message.toLowerCase().match(/[a-z0-9]+/g) || []
  const terms = [...new Set(words)]
    .filter((word) => word.length >= 3 && !DUPLICATE_STOP_WORDS.has(word))
    .slice(0, 12)
  return terms.join(' OR ')
}

export function findDuplicateCandidates(sourceId: number, message: string, limit = 50): FeedbackView[] {
  const search = duplicateSearchQuery(message)
  if (!search) {
    return db
      .prepare(`${feedbackViewSelect} WHERE f.id != ? ORDER BY f.created_at DESC LIMIT ?`)
      .all(sourceId, limit) as FeedbackView[]
  }

  return db
    .prepare(
      `SELECT f.*, c.name AS customer_name, c.email AS customer_email, u.name AS assignee_name
       FROM feedback_search
       JOIN feedback f ON f.id = feedback_search.rowid
       JOIN customers c ON c.id = f.customer_id
       LEFT JOIN users u ON u.id = f.assignee_id
       WHERE feedback_search MATCH ? AND f.id != ?
       ORDER BY bm25(feedback_search)
       LIMIT ?`
    )
    .all(search, sourceId, limit) as FeedbackView[]
}
