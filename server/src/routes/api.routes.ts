import { Request, Response } from 'express'
import { createHash } from 'crypto'
import { once } from 'events'
import { db } from '../database/db'
import { authenticate, requireManager } from '../middleware/authenticate'
import { assignPriorities, getPriorityModel, PriorityDecision, summarizeText } from '../services/llm.service'
import { createApp } from '../config/app'
import { authRouter } from './auth.routes'
import { findUserById, listUsers } from '../data/users.data'
import { listActivity, recordActivity } from '../data/activity.data'
import { findDuplicateCandidates, findFeedbackById, findFeedbackHistory } from '../data/feedback.data'
import { suggestAgentActions } from '../services/agent-assist.service'
import {
  AuthorizationActor,
  canAssignFeedback,
  canWorkFeedback,
  feedbackPermissions,
  isManager,
} from '../services/authorization.service'

export const app = createApp()
app.use(authRouter)

const PAGE_SIZE = 10
const PRIORITY_POLICY_VERSION = 'support-priority-v1'

function serializeFeedback(row: any, viewer: AuthorizationActor) {
  const customer: any = 'customer_name' in row && 'customer_email' in row
    ? { name: row.customer_name, email: row.customer_email }
    : db.prepare('SELECT name, email FROM customers WHERE id = ?').get(row.customer_id)
  const assigneeName = 'assignee_name' in row
    ? row.assignee_name
    : row.assignee_id ? findUserById(row.assignee_id)?.name || null : null

  return {
    id: row.id,
    customer_id: row.customer_id,
    customer_name: customer.name,
    customer_email: customer.email,
    channel: row.channel,
    message: row.message,
    status: row.status,
    priority: row.priority,
    priority_source: row.priority_source,
    priority_reason: row.priority_reason,
    category: row.category || 'other',
    tags: JSON.parse(row.tags || '[]'),
    duplicate_of_id: row.duplicate_of_id,
    escalation_status: row.escalation_status || 'none',
    escalation_reason: row.escalation_reason,
    assignee_id: row.assignee_id,
    assignee_name: assigneeName,
    due_at: row.due_at,
    created_at: row.created_at,
    permissions: feedbackPermissions(viewer, row),
  }
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replace(/"/g, '""')}"`
}

function priorityCacheKey(row: { message: string; channel: string }) {
  return createHash('sha256')
    .update(`${PRIORITY_POLICY_VERSION}\n${getPriorityModel()}\n${row.channel}\n${row.message.trim()}`)
    .digest('hex')
}

async function classifyFetchedFeedback(
  rows: Array<{ id: number; message: string; channel: string; customer_plan: string; priority_source: string | null }>
) {
  const candidates = rows.filter((row) => !row.priority_source)
  if (candidates.length === 0) return

  const groups = new Map<string, typeof candidates>()
  for (const candidate of candidates) {
    const key = priorityCacheKey(candidate)
    groups.set(key, [...(groups.get(key) || []), candidate])
  }

  const cached = db.prepare('SELECT priority, reason FROM priority_cache WHERE cache_key = ?')
  const cacheHits = new Map<string, Omit<PriorityDecision, 'id'>>()
  const missing = [] as Array<(typeof candidates)[number]>

  for (const [key, group] of groups) {
    const entry: any = cached.get(key)
    if (entry) {
      cacheHits.set(key, entry)
    } else {
      missing.push(group[0])
    }
  }

  const decisions = await assignPriorities(
    missing.map((row) => ({
      id: row.id,
      message: row.message,
      channel: row.channel,
      customerPlan: row.customer_plan,
    }))
  )
  const decisionsById = new Map(decisions.map((decision) => [decision.id, decision]))
  const now = new Date().toISOString()
  const persistCache = db.prepare(
    'INSERT OR REPLACE INTO priority_cache (cache_key, priority, reason, created_at) VALUES (?, ?, ?, ?)'
  )
  const persistPriority = db.prepare(
    `UPDATE feedback
     SET priority = ?, priority_source = 'ai', priority_reason = ?, priority_updated_at = ?
     WHERE id = ? AND priority_source IS NULL`
  )
  let persisted = 0

  const persist = db.transaction(() => {
    for (const [key, group] of groups) {
      const decision = cacheHits.get(key) || decisionsById.get(group[0].id)
      if (!decision) continue

      if (!cacheHits.has(key)) {
        persistCache.run(key, decision.priority, decision.reason.slice(0, 140), now)
      }
      for (const row of group) {
        persisted += persistPriority.run(decision.priority, decision.reason.slice(0, 140), now, row.id).changes
      }
    }
  })
  persist()

  console.info(
    JSON.stringify({
      event: 'priority_triage',
      candidates: candidates.length,
      cache_hits: cacheHits.size,
      model_items: missing.length,
      persisted,
    })
  )
}

app.get('/feedback', authenticate, async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || 'all'
    const search = ((req.query.q as string) || '').trim()
    const requestedPage = parseInt((req.query.page as string) || '1', 10)
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const offset = (page - 1) * PAGE_SIZE

    const filters: string[] = []
    const params: string[] = []
    if (status !== 'all') {
      if (!['open', 'resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status filter' })
      filters.push('f.status = ?')
      params.push(status)
    }
    if (search) {
      filters.push('(f.message LIKE ? OR c.name LIKE ? OR c.email LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

    const fetchRows = () =>
      db
        .prepare(
           `SELECT f.*, c.plan as customer_plan, c.name as customer_name,
                   c.email as customer_email, u.name as assignee_name
            FROM feedback f
            JOIN customers c ON c.id = f.customer_id
            LEFT JOIN users u ON u.id = f.assignee_id
            ${where}
           ORDER BY f.created_at DESC
           LIMIT ${PAGE_SIZE} OFFSET ${offset}`
        )
        .all(...params) as any[]

    const rows = fetchRows()
    try {
      await classifyFetchedFeedback(rows)
    } catch (err) {
      console.error('Fetch-time priority triage failed', err)
    }

    const viewer = (req as any).user
    const items = fetchRows().map((row) => serializeFeedback(row, viewer))

    const total: any = db.prepare(
      `SELECT COUNT(*) as count FROM feedback f JOIN customers c ON c.id = f.customer_id ${where}`
    ).get(...params)
    res.json({ items, total: total.count, page })
  } catch (err) {
    console.error('Feedback list failed', err)
    res.status(500).json({ error: 'Something went wrong' })
  }
})

app.get('/users', authenticate, (req: Request, res: Response) => {
  const users = listUsers()
  res.json({ users })
})

app.get('/metrics', authenticate, (req: Request, res: Response) => {
  const fromDate = new Date((req.query.from as string) || '1970-01-01T00:00:00.000Z')
  const toDate = new Date((req.query.to as string) || new Date().toISOString())
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return res.status(400).json({ error: 'Provide a valid metrics date range' })
  }

  const from = fromDate.toISOString()
  const to = toDate.toISOString()
  const now = new Date().toISOString()
  const metrics = db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
       SUM(CASE WHEN status = 'open' AND priority = 'urgent' THEN 1 ELSE 0 END) AS urgent,
       SUM(CASE WHEN status = 'open' AND due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END) AS overdue
     FROM feedback
     WHERE created_at >= ? AND created_at <= ?`
  ).get(now, from, to) as { open: number | null; resolved: number | null; urgent: number | null; overdue: number | null }

  res.json({
    open: metrics.open || 0,
    resolved: metrics.resolved || 0,
    urgent: metrics.urgent || 0,
    overdue: metrics.overdue || 0,
  })
})

app.get('/export.csv', authenticate, async (req: Request, res: Response) => {
  const user = (req as any).user

  const status = (req.query.status as string) || 'all'
  const search = ((req.query.q as string) || '').trim()
  const filters: string[] = []
  const filterParams: string[] = []
  if (status !== 'all') {
    if (!['open', 'resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status filter' })
    filters.push('f.status = ?')
    filterParams.push(status)
  }
  if (search) {
    filters.push('(f.message LIKE ? OR c.name LIKE ? OR c.email LIKE ?)')
    filterParams.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

  const header = [
    'id',
    'customer',
    'email',
    'plan',
    'channel',
    'priority',
    'status',
    'assignee',
    'due_at',
    'message',
    'internal_notes',
  ]
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="pulse-feedback-export.csv"')
  res.write(`${header.join(',')}\n`)

  const rows = db
    .prepare(
      `SELECT f.*, c.name as customer_name, c.email as customer_email, c.plan, u.name as assignee_name,
        (SELECT GROUP_CONCAT(n.body, ' | ')
         FROM feedback_notes n
         WHERE n.feedback_id = f.id
           AND (n.is_private = 0 OR n.author_id = ? OR ? = 'manager')) as internal_notes
       FROM feedback f
       JOIN customers c ON c.id = f.customer_id
       LEFT JOIN users u ON u.id = f.assignee_id
       ${where}
       ORDER BY f.created_at DESC`
    )
    .iterate(user.id, user.role, ...filterParams) as IterableIterator<any>

  try {
    for (const row of rows) {
      if (res.destroyed) break
      const line = [
        row.id,
        row.customer_name,
        row.customer_email,
        row.plan,
        row.channel,
        row.priority,
        row.status,
        row.assignee_name,
        row.due_at,
        row.message,
        row.internal_notes,
      ]
        .map(csvCell)
        .join(',')

      if (!res.write(`${line}\n`)) await once(res, 'drain')
    }
    if (!res.destroyed) res.end()
  } catch (err) {
    console.error('CSV export failed', err)
    if (!res.headersSent) return res.status(500).json({ error: 'Export failed' })
    res.destroy()
  }
})

app.get('/customers/:id', authenticate, (req: Request, res: Response) => {
  const customer: any = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id)
  if (!customer) {
    return res.status(404).json({ error: 'Not found' })
  }

  const history = findFeedbackHistory(Number(req.params.id), 8)

  res.json({
    ...customer,
    history: history.map((row) => serializeFeedback(row, (req as any).user)),
  })
})

app.post('/customers/:id/merge', authenticate, requireManager, (req: Request, res: Response) => {
  const sourceId = Number(req.params.id)
  const targetId = Number(req.body.target_customer_id)
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || sourceId === targetId) {
    return res.status(400).json({ error: 'Valid, different source and target customers are required' })
  }
  const source: any = db.prepare('SELECT * FROM customers WHERE id = ?').get(sourceId)
  const target: any = db.prepare('SELECT * FROM customers WHERE id = ?').get(targetId)
  if (!source || !target) return res.status(404).json({ error: 'Customer not found' })

  const feedbackIds = db.prepare('SELECT id FROM feedback WHERE customer_id = ?').all(sourceId) as Array<{ id: number }>
  const actorId = (req as any).user.id
  db.transaction(() => {
    db.prepare('UPDATE feedback SET customer_id = ? WHERE customer_id = ?').run(targetId, sourceId)
    db.prepare('DELETE FROM customers WHERE id = ?').run(sourceId)
    for (const { id } of feedbackIds) recordActivity(id, actorId, 'customer_merged', { from: sourceId, to: targetId })
  })()
  res.json({ merged_customer_id: sourceId, into_customer_id: targetId, moved_feedback: feedbackIds.length })
})

app.post('/feedback', authenticate, (req: Request, res: Response) => {
  const { customer_id, channel, message, category = 'other', tags = [] } = req.body
  if (!Number.isInteger(customer_id) || !['email', 'chat', 'app store'].includes(channel) || !String(message || '').trim()) {
    return res.status(400).json({ error: 'customer_id, channel and message are required' })
  }
  const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(customer_id)
  if (!customer) return res.status(404).json({ error: 'Customer not found' })
  const createdAt = new Date().toISOString()
  const result = db.prepare(
    `INSERT INTO feedback
     (customer_id, channel, message, status, priority, priority_source, category, tags, escalation_status, created_at)
     VALUES (?, ?, ?, 'open', 'normal', NULL, ?, ?, 'none', ?)`
  ).run(customer_id, channel, String(message).trim(), category, JSON.stringify(tags), createdAt)
  const id = Number(result.lastInsertRowid)
  recordActivity(id, (req as any).user.id, 'created', { channel, category, tags })
  res.status(201).json(serializeFeedback(findFeedbackById(id), (req as any).user))
})

app.patch('/feedback/:id', authenticate, (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const row: any = findFeedbackById(id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const user = (req as any).user
  const changesClassification = req.body.category !== undefined || req.body.tags !== undefined
  const changesDuplicate = req.body.duplicate_of_id !== undefined
  const changesMessage = req.body.message !== undefined
  if ((changesClassification || changesDuplicate) && !canWorkFeedback(user, row)) {
    return res.status(403).json({ error: 'Only the assigned agent or a manager can update this feedback' })
  }
  if (changesMessage && !isManager(user)) {
    return res.status(403).json({ error: 'Only a manager can edit the customer message' })
  }
  const category = req.body.category ?? row.category
  const tags = req.body.tags ?? JSON.parse(row.tags || '[]')
  const duplicateOfId = req.body.duplicate_of_id === undefined ? row.duplicate_of_id : req.body.duplicate_of_id
  const message = req.body.message ?? row.message
  db.prepare('UPDATE feedback SET message = ?, category = ?, tags = ?, duplicate_of_id = ? WHERE id = ?')
    .run(message, category, JSON.stringify(tags), duplicateOfId || null, id)

  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const previousTags = JSON.parse(row.tags || '[]')
  if (message !== row.message) changes.message = { from: row.message, to: message }
  if (category !== row.category) changes.category = { from: row.category, to: category }
  if (JSON.stringify(tags) !== JSON.stringify(previousTags)) changes.tags = { from: previousTags, to: tags }
  if (duplicateOfId !== row.duplicate_of_id) {
    changes.duplicate_of_id = { from: row.duplicate_of_id, to: duplicateOfId }
  }
  if (Object.keys(changes).length > 0) {
    const action = changes.duplicate_of_id
      ? duplicateOfId ? 'duplicate_marked' : 'duplicate_unmarked'
      : 'feedback_updated'
    recordActivity(id, (req as any).user.id, action, { changes })
  }
  res.json(serializeFeedback(findFeedbackById(id), user))
})

app.delete('/feedback/:id', authenticate, requireManager, (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!findFeedbackById(id)) return res.status(404).json({ error: 'Not found' })
  db.transaction(() => {
    recordActivity(id, (req as any).user.id, 'deleted', {})
    db.prepare('DELETE FROM feedback_notes WHERE feedback_id = ?').run(id)
    db.prepare('UPDATE feedback SET duplicate_of_id = NULL WHERE duplicate_of_id = ?').run(id)
    db.prepare('DELETE FROM feedback WHERE id = ?').run(id)
  })()
  res.status(204).send()
})

app.patch('/feedback/:id/status', authenticate, (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const status = req.body.status
  if (!['open', 'resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
  const row: any = findFeedbackById(id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const user = (req as any).user
  if (!canWorkFeedback(user, row)) {
    return res.status(403).json({ error: 'Only the assigned agent or a manager can change status' })
  }
  db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, id)
  if (row.status !== status) {
    recordActivity(id, user.id, status === 'resolved' ? 'feedback_resolved' : 'feedback_reopened', {
      from: row.status,
      to: status,
    })
  }
  res.json(serializeFeedback(findFeedbackById(id), user))
})

app.get('/feedback/:id/activity', authenticate, (req: Request, res: Response) => {
  res.json({ activity: listActivity(Number(req.params.id)) })
})

app.get('/feedback/:id/duplicates', authenticate, (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const source: any = findFeedbackById(id)
  if (!source) return res.status(404).json({ error: 'Not found' })
  const words = new Set(String(source.message).toLowerCase().match(/[a-z0-9]+/g) || [])
  const rows = findDuplicateCandidates(id, source.message)
  const candidates = rows.map((row) => {
    const other = new Set(String(row.message).toLowerCase().match(/[a-z0-9]+/g) || [])
    const overlap = [...words].filter((word) => other.has(word)).length
    const union = new Set([...words, ...other]).size || 1
    return { ...serializeFeedback(row, (req as any).user), similarity: overlap / union }
  }).filter((row) => row.similarity >= 0.35).sort((a, b) => b.similarity - a.similarity).slice(0, 5)
  res.json({ candidates })
})

app.post('/feedback/:id/escalation', authenticate, (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const row: any = findFeedbackById(id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const action = req.body.action
  const user = (req as any).user
  if (!['request', 'approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' })
  if (action === 'request' && !canWorkFeedback(user, row)) {
    return res.status(403).json({ error: 'Only the assigned agent or a manager can request escalation' })
  }
  if (action !== 'request' && !isManager(user)) return res.status(403).json({ error: 'Manager approval required' })
  const nextStatus = action === 'request' ? 'pending' : action === 'approve' ? 'approved' : 'rejected'
  db.prepare('UPDATE feedback SET escalation_status = ?, escalation_reason = ? WHERE id = ?')
    .run(nextStatus, req.body.reason || row.escalation_reason || null, id)
  recordActivity(id, user.id, `escalation_${action}`, { reason: req.body.reason || null })
  res.json(serializeFeedback(findFeedbackById(id), user))
})

app.get('/feedback/:id', authenticate, (req: Request, res: Response) => {
  try {
    const row: any = db.prepare('SELECT * FROM feedback WHERE id = ?').get(req.params.id)
    if (!row) {
      return res.status(404).json({ error: 'Not found' })
    }
    res.json(serializeFeedback(row, (req as any).user))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Something went wrong' })
  }
})

app.post('/feedback/:id/assignment', authenticate, (req: Request, res: Response) => {
  try {
    const { assignee_id, priority, due_at } = req.body
    const requestedAssigneeId = assignee_id === null || assignee_id === '' ? null : Number(assignee_id)
    if (!['low', 'normal', 'high', 'urgent'].includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority' })
    }
    if (requestedAssigneeId !== null && !Number.isInteger(requestedAssigneeId)) {
      return res.status(400).json({ error: 'Invalid owner' })
    }
    if (requestedAssigneeId !== null && !findUserById(requestedAssigneeId)) {
      return res.status(400).json({ error: 'Owner does not exist' })
    }
    if (due_at && Number.isNaN(Date.parse(due_at))) {
      return res.status(400).json({ error: 'Invalid due date' })
    }
    const before: any = findFeedbackById(Number(req.params.id))
    if (!before) return res.status(404).json({ error: 'Not found' })
    const user = (req as any).user
    if (!canAssignFeedback(user, before, requestedAssigneeId)) {
      return res.status(403).json({ error: 'Agents can only claim unassigned feedback or update their own work' })
    }
    db.prepare(
      `UPDATE feedback
       SET assignee_id = ?, priority = ?, due_at = ?, priority_source = 'human',
           priority_reason = NULL, priority_updated_at = ?
       WHERE id = ?`
    ).run(requestedAssigneeId, priority, due_at || null, new Date().toISOString(), req.params.id)

    recordActivity(Number(req.params.id), (req as any).user.id, 'routing_changed', {
      from: { assignee_id: before.assignee_id, priority: before.priority, due_at: before.due_at },
      to: { assignee_id: requestedAssigneeId, priority, due_at: due_at || null },
    })

    const row: any = db.prepare('SELECT * FROM feedback WHERE id = ?').get(req.params.id)
    if (!row) {
      return res.status(404).json({ error: 'Not found' })
    }

    res.json(serializeFeedback(row, user))
  } catch (err) {
    console.error('Feedback assignment failed', err)
    res.status(500).json({ error: 'Something went wrong' })
  }
})

app.post('/feedback/triage-priority', authenticate, requireManager, async (req: Request, res: Response) => {
  const ids: unknown[] = Array.isArray(req.body.ids) ? req.body.ids : []
  const uniqueIds = [...new Set(ids)]
  const feedbackIds = uniqueIds.filter(
    (id): id is number => typeof id === 'number' && Number.isInteger(id) && id >= 1
  )

  if (feedbackIds.length === 0 || feedbackIds.length !== uniqueIds.length || feedbackIds.length > PAGE_SIZE) {
    return res.status(400).json({ error: `Provide between 1 and ${PAGE_SIZE} feedback ids` })
  }

  try {
    const placeholders = feedbackIds.map(() => '?').join(', ')
    const candidates = db
      .prepare(
        `SELECT f.id, f.message, f.channel, c.plan as customerPlan
         FROM feedback f
         JOIN customers c ON c.id = f.customer_id
         WHERE f.id IN (${placeholders}) AND f.priority_source IS NULL`
      )
      .all(...feedbackIds) as Array<{ id: number; message: string; channel: string; customerPlan: string }>

    const decisions = await assignPriorities(candidates)
    const updatedAt = new Date().toISOString()
    const saveDecision = db.prepare(
      `UPDATE feedback
       SET priority = ?, priority_source = 'ai', priority_reason = ?, priority_updated_at = ?
       WHERE id = ? AND priority_source IS NULL`
    )

    const triaged = decisions.flatMap((decision) => {
      const result = saveDecision.run(decision.priority, decision.reason.slice(0, 140), updatedAt, decision.id)
      return result.changes ? [decision.id] : []
    })

    res.json({ triaged })
  } catch (err) {
    console.error('Priority triage failed', err)
    res.status(503).json({ error: 'Priority triage is temporarily unavailable' })
  }
})

app.get('/feedback/:id/notes', authenticate, (req: Request, res: Response) => {
  const user = (req as any).user
  const notes = db
    .prepare(
      `SELECT n.*, u.name as author_name, u.email as author_email
       FROM feedback_notes n
       LEFT JOIN users u ON u.id = n.author_id
       WHERE n.feedback_id = ?
         AND (n.is_private = 0 OR n.author_id = ? OR ? = 'manager')
       ORDER BY n.created_at DESC`
    )
    .all(req.params.id, user.id, user.role)
  res.json({ notes })
})

app.post('/feedback/:id/notes', authenticate, (req: Request, res: Response) => {
  try {
    const user = (req as any).user
    const feedback: any = findFeedbackById(Number(req.params.id))
    if (!feedback) return res.status(404).json({ error: 'Feedback not found' })
    if (!canWorkFeedback(user, feedback)) {
      return res.status(403).json({ error: 'Only the assigned agent or a manager can add notes' })
    }
    const body = String(req.body.body || '').trim()
    if (!body) return res.status(400).json({ error: 'Note body is required' })
    const createdAt = new Date().toISOString()
    db.prepare(
      'INSERT INTO feedback_notes (feedback_id, author_id, body, is_private, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(req.params.id, user.id, body, req.body.is_private ? 1 : 0, createdAt)

    const note: any = db
      .prepare(
        `SELECT n.*, u.name as author_name, u.email as author_email
         FROM feedback_notes n
         LEFT JOIN users u ON u.id = n.author_id
         WHERE n.id = last_insert_rowid()`
      )
      .get()

    recordActivity(Number(req.params.id), user.id, 'note_created', { note_id: note.id, is_private: !!req.body.is_private })

    res.status(201).json(note)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Something went wrong' })
  }
})

app.post('/summarize', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.body
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'A valid feedback id is required' })
    }

    const row: any = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id)
    if (!row) {
      return res.status(404).json({ error: 'Feedback not found' })
    }

    const prompt = `Summarize the following customer feedback in one or two short sentences for a support agent.\n\n${row.message}`
    const summary = await summarizeText(prompt)
    res.json({ summary })
  } catch (err) {
    console.error('Summary generation failed', err)
    res.status(503).json({ error: 'Summary generation is temporarily unavailable' })
  }
})

app.post('/feedback/:id/assist', authenticate, async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'A valid feedback id is required' })

  const user = (req as any).user
  const row = db
    .prepare(
      `SELECT f.*, c.plan AS customer_plan, c.health_score, u.name AS assignee_name
       FROM feedback f
       JOIN customers c ON c.id = f.customer_id
       LEFT JOIN users u ON u.id = f.assignee_id
       WHERE f.id = ?`
    )
    .get(id) as any
  if (!row) return res.status(404).json({ error: 'Feedback not found' })

  try {
    const visibleNotes = db
      .prepare(
        `SELECT n.body, n.is_private, n.created_at, u.name AS author_name
         FROM feedback_notes n
         LEFT JOIN users u ON u.id = n.author_id
         WHERE n.feedback_id = ?
           AND (n.is_private = 0 OR n.author_id = ? OR ? = 'manager')
         ORDER BY n.created_at DESC
         LIMIT 6`
      )
      .all(id, user.id, user.role) as any[]
    const recentActivity = listActivity(id).slice(0, 6)
    const startedAt = Date.now()
    const result = await suggestAgentActions({
      feedback: {
        id,
        message: row.message,
        channel: row.channel,
        status: row.status,
        priority: row.priority,
        category: row.category,
        tags: JSON.parse(row.tags || '[]'),
        assigneeName: row.assignee_name,
        dueAt: row.due_at,
        createdAt: row.created_at,
        escalationStatus: row.escalation_status,
        escalationReason: row.escalation_reason,
      },
      customer: {
        plan: row.customer_plan,
        healthScore: row.health_score,
      },
      visibleNotes: visibleNotes.map((note) => ({
        body: note.body,
        isPrivate: !!note.is_private,
        authorName: note.author_name,
        createdAt: note.created_at,
      })),
      recentActivity: recentActivity.map((entry) => ({
        action: entry.action,
        details: entry.details,
        createdAt: entry.created_at,
      })),
    })

    console.info(JSON.stringify({
      event: 'agent_assist',
      feedback_id: id,
      source: result.source,
      model: result.model,
      duration_ms: Date.now() - startedAt,
    }))
    res.json(result)
  } catch (err) {
    console.error('Agent assist generation failed', err)
    res.status(503).json({ error: 'Action suggestions are temporarily unavailable' })
  }
})

app.patch('/feedback/:id/notes/:noteId', authenticate, (req: Request, res: Response) => {
  const user = (req as any).user
  const note: any = db.prepare('SELECT * FROM feedback_notes WHERE id = ? AND feedback_id = ?').get(req.params.noteId, req.params.id)
  if (!note) return res.status(404).json({ error: 'Note not found' })
  if (note.author_id !== user.id && user.role !== 'manager') return res.status(403).json({ error: 'Not allowed' })
  const body = String(req.body.body ?? note.body).trim()
  if (!body) return res.status(400).json({ error: 'Note body is required' })
  const isPrivate = req.body.is_private === undefined ? note.is_private : req.body.is_private ? 1 : 0
  db.prepare('UPDATE feedback_notes SET body = ?, is_private = ? WHERE id = ?').run(body, isPrivate, note.id)
  recordActivity(Number(req.params.id), user.id, 'note_updated', { note_id: note.id })
  const updated = db.prepare(`SELECT n.*, u.name as author_name, u.email as author_email FROM feedback_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.id = ?`).get(note.id)
  res.json(updated)
})

app.delete('/feedback/:id/notes/:noteId', authenticate, (req: Request, res: Response) => {
  const user = (req as any).user
  const note: any = db.prepare('SELECT * FROM feedback_notes WHERE id = ? AND feedback_id = ?').get(req.params.noteId, req.params.id)
  if (!note) return res.status(404).json({ error: 'Note not found' })
  if (note.author_id !== user.id && user.role !== 'manager') return res.status(403).json({ error: 'Not allowed' })
  db.prepare('DELETE FROM feedback_notes WHERE id = ?').run(note.id)
  recordActivity(Number(req.params.id), user.id, 'note_deleted', { note_id: note.id })
  res.status(204).send()
})
