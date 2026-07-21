import { useEffect, useState } from 'react'
import {
  addNote,
  deleteNote,
  deleteFeedback,
  fetchActivity,
  fetchAgentAssist,
  fetchCustomer,
  fetchDuplicates,
  fetchItem,
  fetchNotes,
  fetchUsers,
  mergeCustomer,
  summarize,
  setFeedbackStatus,
  updateEscalation,
  updateAssignment,
  updateFeedback,
  updateNote,
} from '../api'
import { AgentAssistResult, CustomerProfile, FeedbackActivity, FeedbackItem, InternalNote, User } from '../types'

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'none'
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none'
  return String(value).replace(/_/g, ' ')
}

function activityDescription(entry: FeedbackActivity) {
  let details: Record<string, unknown> = {}
  if (typeof entry.details === 'string') {
    try {
      const parsed = JSON.parse(entry.details)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) details = parsed
    } catch {
      return entry.details
    }
  } else if (entry.details && typeof entry.details === 'object' && !Array.isArray(entry.details)) {
    details = entry.details
  }
  const changes = details.changes as Record<string, { from: unknown; to: unknown }> | undefined

  if (changes) {
    return Object.entries(changes).map(([field, change]) => {
      const label = field === 'duplicate_of_id' ? 'Original feedback' : field.replace(/_/g, ' ')
      return `${label}: ${displayValue(change.from)} → ${displayValue(change.to)}`
    }).join(' · ')
  }

  const from = details.from
  const to = details.to
  if (from && to && typeof from === 'object' && typeof to === 'object' && !Array.isArray(from) && !Array.isArray(to)) {
    return Object.keys(to)
      .filter((field) => displayValue((from as Record<string, unknown>)[field]) !== displayValue((to as Record<string, unknown>)[field]))
      .map((field) => `${field.replace(/_/g, ' ')}: ${displayValue((from as Record<string, unknown>)[field])} → ${displayValue((to as Record<string, unknown>)[field])}`)
      .join(' · ')
  }

  if ('reason' in details && details.reason) return `Reason: ${displayValue(details.reason)}`
  if ('note_id' in details) return `Note #${displayValue(details.note_id)}`
  if ('from' in details || 'to' in details) return `Status changed from ${displayValue(details.from)} to ${displayValue(details.to)}`
  return ''
}

function activityTitle(action: string) {
  const titles: Record<string, string> = {
    status_changed: 'Status changed',
    feedback_resolved: 'Feedback resolved',
    feedback_reopened: 'Feedback reopened',
    escalation_request: 'Escalation requested',
    escalation_approve: 'Escalation approved',
    escalation_reject: 'Escalation rejected',
    duplicate_marked: 'Duplicate marked',
    duplicate_unmarked: 'Duplicate removed',
    routing_changed: 'Routing updated',
    feedback_updated: 'Feedback updated',
  }
  return titles[action] || action.replace(/_/g, ' ')
}

export default function ItemDetail({
  id,
  user,
  onBack,
  onSelectFeedback,
  onDeleted,
}: {
  id: number
  user: User
  onBack: () => void
  onSelectFeedback: (id: number) => void
  onDeleted: () => void
}) {
  const [item, setItem] = useState<FeedbackItem | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [customer, setCustomer] = useState<CustomerProfile | null>(null)
  const [notes, setNotes] = useState<InternalNote[]>([])
  const [activity, setActivity] = useState<FeedbackActivity[]>([])
  const [duplicates, setDuplicates] = useState<Array<FeedbackItem & { similarity: number }>>([])
  const [summary, setSummary] = useState('')
  const [summaryError, setSummaryError] = useState('')
  const [agentAssist, setAgentAssist] = useState<AgentAssistResult | null>(null)
  const [assistError, setAssistError] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority] = useState('normal')
  const [dueAt, setDueAt] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [privateNote, setPrivateNote] = useState(true)
  const [category, setCategory] = useState<FeedbackItem['category']>('other')
  const [tags, setTags] = useState('')
  const [escalationReason, setEscalationReason] = useState('')
  const [routingMessage, setRoutingMessage] = useState('')
  const [sidePanel, setSidePanel] = useState<'customer' | 'notes' | 'duplicates' | 'activity'>('customer')
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  async function runPending<T>(action: string, operation: () => Promise<T>) {
    setPendingAction(action)
    try {
      return await operation()
    } finally {
      setPendingAction(null)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      setAgentAssist(null)
      setAssistError('')
      const data = await fetchItem(id)
      if (cancelled) return

      setItem(data)
      setAssigneeId(data.assignee_id ? String(data.assignee_id) : user.role === 'agent' ? String(user.id) : '')
      setPriority(data.priority)
      setDueAt(data.due_at ? data.due_at.slice(0, 10) : '')
      setCategory(data.category)
      setTags(data.tags.join(', '))
      setEscalationReason(data.escalation_reason || '')

      fetchUsers().then((userData) => {
        if (!cancelled) setUsers(userData.users)
      })
      fetchCustomer(data.customer_id).then((profile) => {
        if (!cancelled) setCustomer(profile)
      })
      fetchNotes(id).then((noteData) => {
        if (!cancelled) setNotes(noteData.notes)
      })
      fetchActivity(id).then((result) => { if (!cancelled) setActivity(result.activity) })
      fetchDuplicates(id).then((result) => { if (!cancelled) setDuplicates(result.candidates) })
    }

    load()

    return () => {
      cancelled = true
    }
  }, [id])

  const onResolve = async () => {
    if (!item) return
    await runPending('status', async () => {
      const nextStatus = item.status === 'open' ? 'resolved' : 'open'
      const updated = await setFeedbackStatus(item.id, nextStatus)
      setItem({ ...item, status: updated.status })
      setAgentAssist(null)
      const result = await fetchActivity(item.id)
      setActivity(result.activity)
    })
  }

  const onSummarize = async () => {
    setSummaryError('')
    await runPending('summary', async () => {
      try {
        const data = await summarize(id)
        setSummary(data.summary)
      } catch {
        setSummaryError('Summary is temporarily unavailable. Please try again.')
      }
    })
  }

  const onSuggestActions = async () => {
    setAssistError('')
    await runPending('assist', async () => {
      try {
        setAgentAssist(await fetchAgentAssist(id))
      } catch {
        setAssistError('Action suggestions are temporarily unavailable. Please try again.')
      }
    })
  }

  const onSaveAssignment = async () => {
    if (!item) return
    await runPending('routing', async () => {
      setRoutingMessage('Saving…')
      try {
      const updated = await updateAssignment(
        item.id,
        {
          assignee_id: assigneeId ? Number(assigneeId) : null,
          priority,
          due_at: dueAt,
        }
      )
      const classified = await updateFeedback(item.id, { category, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) })
      setItem({ ...updated, category: classified.category, tags: classified.tags })
      setAgentAssist(null)
      setRoutingMessage('Routing saved')
      const result = await fetchActivity(item.id)
      setActivity(result.activity)
      } catch (error) {
        setRoutingMessage((error as Error).message || 'Could not save routing')
      }
    })
  }

  const onEscalate = async (action: 'request' | 'approve' | 'reject') => {
    if (!item) return
    await runPending(`escalation-${action}`, async () => {
      setItem(await updateEscalation(item.id, action, escalationReason))
      setAgentAssist(null)
      const result = await fetchActivity(item.id)
      setActivity(result.activity)
    })
  }

  const onEditNote = async (note: InternalNote) => {
    const body = window.prompt('Edit note', note.body)
    if (!body) return
    await runPending(`note-edit-${note.id}`, async () => {
      const updated = await updateNote(id, note.id, body)
      setNotes((current) => current.map((entry) => entry.id === note.id ? updated : entry))
      setAgentAssist(null)
    })
  }

  const onDeleteNote = async (note: InternalNote) => {
    if (!window.confirm('Delete this note?')) return
    await runPending(`note-delete-${note.id}`, async () => {
      await deleteNote(id, note.id)
      setNotes((current) => current.filter((entry) => entry.id !== note.id))
      setAgentAssist(null)
    })
  }


  const onDeleteFeedback = async () => {
    if (!item || !window.confirm('Delete this feedback and its notes?')) return
    await runPending('delete-feedback', async () => {
      await deleteFeedback(item.id)
      onDeleted()
    })
  }

  const onMergeCustomer = async () => {
    if (!item) return
    const targetId = Number(window.prompt('Merge this customer into customer ID'))
    if (!Number.isInteger(targetId) || targetId === item.customer_id) return
    await runPending('merge-customer', async () => {
      await mergeCustomer(item.customer_id, targetId)
      const profile = await fetchCustomer(targetId)
      setCustomer(profile)
      setItem({ ...item, customer_id: profile.id, customer_name: profile.name, customer_email: profile.email })
      setAgentAssist(null)
    })
  }

  const onMarkDuplicate = async (duplicateOfId: number | null) => {
    if (!item) return
    await runPending(duplicateOfId === null ? 'duplicate-clear' : `duplicate-${duplicateOfId}`, async () => {
      setItem(await updateFeedback(item.id, { duplicate_of_id: duplicateOfId }))
      setAgentAssist(null)
      const result = await fetchActivity(item.id)
      setActivity(result.activity)
    })
  }

  const onAddNote = async () => {
    if (!noteBody.trim()) return
    await runPending('add-note', async () => {
      const note = await addNote(id, { body: noteBody, is_private: privateNote })
      setNotes([note, ...notes])
      setNoteBody('')
      setAgentAssist(null)
    })
  }

  if (!item) {
    return (
      <div className="detail">
        <button className="detail-back-button" onClick={onBack}>
          <span aria-hidden="true">←</span>
          Back to inbox
        </button>
      </div>
    )
  }

  const canEditRouting = item.permissions.can_edit_routing
  const canChangeStatus = item.permissions.can_change_status
  const canRequestEscalation = item.permissions.can_request_escalation
  const canReviewEscalation = item.permissions.can_review_escalation
  const canMarkDuplicate = item.permissions.can_mark_duplicate
  const canAddNote = item.permissions.can_add_note
  const availableOwners = user.role === 'manager'
    ? users
    : users.filter((entry) => entry.id === user.id || entry.id === item.assignee_id)

  return (
    <div className="detail">
      <button className="detail-back-button" onClick={onBack}>
        <span aria-hidden="true">←</span>
        Back to inbox
      </button>
      <div className="detail-grid">
        <div className="detail-card">
          <div className="detail-head">
            <div className="detail-identity">
              <div className="detail-avatar" aria-hidden="true">
                {item.customer_name.split(' ').map((part) => part[0]).slice(0, 2).join('')}
              </div>
              <div>
                <span className="detail-kicker">Feedback #{item.id}</span>
                <h2>{item.customer_name}</h2>
                <a className="detail-email" href={`mailto:${item.customer_email}`}>{item.customer_email}</a>
              </div>
            </div>
            <span className={'badge ' + item.status}>{item.status}</span>
          </div>
          <div className="detail-meta">
            <span className="channel">{item.channel}</span>
            <span className={'priority ' + item.priority}>{item.priority}</span>
            <time>{new Date(item.created_at).toLocaleString()}</time>
          </div>
          <div className="customer-message">
            <span>Customer message</span>
            <div className="message">{item.message}</div>
          </div>
          <div className="assignment-panel">
            <div className="routing-heading">
              <div><h3>Routing</h3><p>Set ownership, urgency, and classification.</p></div>
              <span>{canEditRouting ? 'Editable' : 'Read only'}</span>
            </div>
            <label>
              Owner
              <select disabled={!canEditRouting} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                {user.role === 'manager' && <option value="">Nobody</option>}
                {availableOwners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name} ({owner.role})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select disabled={!canEditRouting} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {['low', 'normal', 'high', 'urgent'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              {item.priority_source === 'ai' && item.priority_reason && (
                <small className="ai-priority-reason">AI suggestion: {item.priority_reason}</small>
              )}
            </label>
            <label>
              Due
              <input disabled={!canEditRouting} type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </label>
            <label>
              Category
              <select disabled={!canEditRouting} value={category} onChange={(e) => setCategory(e.target.value as FeedbackItem['category'])}>
                {['praise', 'bug', 'billing', 'outage', 'feature_request', 'question', 'other'].map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}
              </select>
            </label>
            <label>
              Tags
              <input disabled={!canEditRouting} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="billing, vip" />
            </label>
            <div className="routing-footer">
              <div>
                {!canEditRouting && <span>Only the assigned agent or a manager can change routing.</span>}
                {routingMessage && <span>{routingMessage}</span>}
              </div>
              <button className={pendingAction === 'routing' ? 'is-loading' : ''} disabled={!canEditRouting || pendingAction !== null} onClick={onSaveAssignment}>
                {pendingAction === 'routing' ? 'Saving…' : user.role === 'agent' && item.assignee_id === null ? 'Claim and save' : 'Save routing'}
              </button>
            </div>
          </div>
          <div className="detail-actions">
            {canChangeStatus && (
              <button className={pendingAction === 'status' ? 'is-loading' : ''} disabled={pendingAction !== null} onClick={onResolve}>
                {pendingAction === 'status' ? 'Updating…' : item.status === 'open' ? 'Mark resolved' : 'Reopen'}
              </button>
            )}
            <button className={`secondary${pendingAction === 'summary' ? ' is-loading' : ''}`} disabled={pendingAction !== null} onClick={onSummarize}>
              {pendingAction === 'summary' ? 'Summarizing…' : 'Summarize'}
            </button>
            <button className={`secondary assist-trigger${pendingAction === 'assist' ? ' is-loading' : ''}`} disabled={pendingAction !== null} onClick={onSuggestActions}>
              {pendingAction === 'assist' ? 'Thinking…' : agentAssist ? 'Update next steps' : 'Suggest next steps'}
            </button>
            {item.permissions.can_delete && <button className={`danger${pendingAction === 'delete-feedback' ? ' is-loading' : ''}`} disabled={pendingAction !== null} onClick={onDeleteFeedback}>{pendingAction === 'delete-feedback' ? 'Deleting…' : 'Delete feedback'}</button>}
          </div>
          {summary && (
            <div className="summary">
              <h3>Summary</h3>
              <div>{summary}</div>
            </div>
          )}
          {summaryError && <div className="summary-error">{summaryError}</div>}
          {agentAssist && (
            <section className="agent-assist-panel" aria-live="polite">
              <div className="agent-assist-heading">
                <div className="agent-assist-title">
                  <span aria-hidden="true">AI</span>
                  <div>
                    <h3>Suggested next steps</h3>
                    <p>Decision support only. Review before acting.</p>
                  </div>
                </div>
                <span className="agent-assist-source">{agentAssist.source === 'generated' ? 'New' : 'Cached'}</span>
              </div>
              <p className="agent-assist-assessment">{agentAssist.recommendation.assessment}</p>
              <div className={`agent-assist-escalation ${agentAssist.recommendation.escalation.level}`}>
                <div>
                  <span>Escalation</span>
                  <strong>{agentAssist.recommendation.escalation.level}</strong>
                </div>
                <p>{agentAssist.recommendation.escalation.reason}</p>
              </div>
              <ol className="agent-assist-actions">
                {agentAssist.recommendation.actions.map((action, index) => (
                  <li key={`${action.type}-${index}`}>
                    <span className="agent-assist-step">{index + 1}</span>
                    <div>
                      <div className="agent-assist-action-head">
                        <strong>{action.title}</strong>
                        <span className={`agent-assist-urgency ${action.urgency}`}>{action.urgency}</span>
                      </div>
                      <p>{action.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="agent-assist-human-check">
                <strong>Human check</strong>
                <span>{agentAssist.recommendation.human_check}</span>
              </div>
            </section>
          )}
          {assistError && <div className="summary-error" role="alert">{assistError}</div>}
          <section className="workflow-panel">
            <div className="workflow-heading">
              <div><h3>Escalation</h3><p>Request manager attention when this needs intervention.</p></div>
              <span className={`escalation-state ${item.escalation_status}`}>{item.escalation_status}</span>
            </div>
            {(canRequestEscalation || canReviewEscalation) ? (
              <>
                <input value={escalationReason} onChange={(e) => setEscalationReason(e.target.value)} placeholder="Reason for escalation" />
                <div className="workflow-actions">
                  {canRequestEscalation && <button className={pendingAction === 'escalation-request' ? 'is-loading' : ''} disabled={pendingAction !== null} onClick={() => onEscalate('request')}>{pendingAction === 'escalation-request' ? 'Requesting…' : 'Request escalation'}</button>}
                  {canReviewEscalation && item.escalation_status === 'pending' && <button className={pendingAction === 'escalation-approve' ? 'is-loading' : ''} disabled={pendingAction !== null} onClick={() => onEscalate('approve')}>{pendingAction === 'escalation-approve' ? 'Approving…' : 'Approve'}</button>}
                  {canReviewEscalation && item.escalation_status === 'pending' && <button className={pendingAction === 'escalation-reject' ? 'is-loading' : ''} disabled={pendingAction !== null} onClick={() => onEscalate('reject')}>{pendingAction === 'escalation-reject' ? 'Rejecting…' : 'Reject'}</button>}
                </div>
              </>
            ) : <p className="permission-message">Only the assigned agent or a manager can request escalation.</p>}
          </section>
        </div>

        <aside className="side-panels">
          <nav className="side-panel-tabs" aria-label="Feedback details" role="tablist">
            <button className={sidePanel === 'customer' ? 'active' : ''} onClick={() => setSidePanel('customer')} role="tab" aria-selected={sidePanel === 'customer'}>
              Customer
            </button>
            <button className={sidePanel === 'notes' ? 'active' : ''} onClick={() => setSidePanel('notes')} role="tab" aria-selected={sidePanel === 'notes'}>
              Notes <span>{notes.length}</span>
            </button>
            <button className={sidePanel === 'duplicates' ? 'active' : ''} onClick={() => setSidePanel('duplicates')} role="tab" aria-selected={sidePanel === 'duplicates'}>
              Matches <span>{duplicates.length}</span>
            </button>
            <button className={sidePanel === 'activity' ? 'active' : ''} onClick={() => setSidePanel('activity')} role="tab" aria-selected={sidePanel === 'activity'}>
              Activity <span>{activity.length}</span>
            </button>
          </nav>

          {sidePanel === 'customer' && customer && (
            <section className="mini-panel customer-panel">
              <div className="customer-profile-head">
                <div className="customer-avatar" aria-hidden="true">
                  {customer.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}
                </div>
                <div>
                  <h3>Customer profile</h3>
                  <p>{customer.email}</p>
                </div>
              </div>
              <div className="customer-profile-stats">
                <div className="profile-stat">
                  <span>Plan</span>
                  <strong>{customer.plan}</strong>
                </div>
                <div className="profile-stat health-stat">
                  <div>
                    <span>Health</span>
                    <strong>{customer.health_score}</strong>
                  </div>
                  <div className="health-meter" role="meter" aria-label="Customer health" aria-valuemin={0} aria-valuemax={100} aria-valuenow={customer.health_score}>
                    <span style={{ width: `${Math.max(0, Math.min(100, customer.health_score))}%` }} />
                  </div>
                </div>
              </div>
              <div className="history-heading">
                <div>
                  <h4>Recent history</h4>
                  <span>{customer.history.length} feedback items</span>
                </div>
                {item.permissions.can_merge_customer && <button className={`merge-customer-button${pendingAction === 'merge-customer' ? ' is-loading' : ''}`} disabled={pendingAction !== null} onClick={onMergeCustomer}>{pendingAction === 'merge-customer' ? 'Merging…' : 'Merge'}</button>}
              </div>
              <ul className="history-list">
                {customer.history.map((historyItem) => (
                  <li className={historyItem.id === item.id ? 'is-current' : ''} key={historyItem.id}>
                    <button onClick={() => onSelectFeedback(historyItem.id)}>
                      <span className="history-item-meta">
                        <span className={'badge ' + historyItem.status}>{historyItem.status}</span>
                        <span>{historyItem.channel}</span>
                        <time>{new Date(historyItem.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                      </span>
                      <span className="history-message" title={historyItem.message}>{historyItem.message}</span>
                      {historyItem.id === item.id && <span className="history-current-label">Viewing now</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {sidePanel === 'notes' && (
          <section className="mini-panel notes-panel">
            <div className="side-panel-heading">
              <div><h3>Internal notes</h3><p>Context visible to your support team.</p></div>
              <span>{notes.length}</span>
            </div>
            {canAddNote ? (
              <>
                <textarea
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Paste context, snippets, reminders..."
                />
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={privateNote}
                    onChange={(e) => setPrivateNote(e.target.checked)}
                  />
                  Private note
                </label>
                <button className={pendingAction === 'add-note' ? 'is-loading' : ''} disabled={pendingAction !== null || !noteBody.trim()} onClick={onAddNote}>{pendingAction === 'add-note' ? 'Adding…' : 'Add note'}</button>
              </>
            ) : <p className="permission-message">Notes can be added by the assigned agent or a manager.</p>}
            <div className="notes-list">
              {notes.map((note) => (
                <article key={note.id} className="note">
                  <div className="note-meta">
                    <strong>{note.author_name}</strong>
                    <span>{note.is_private ? 'Private' : 'Shared'}</span>
                  </div>
                  <div>{note.body}</div>
                  {(user.role === 'manager' || note.author_id === user.id) && (
                    <div className="note-actions">
                      <button className={pendingAction === `note-edit-${note.id}` ? 'is-loading' : ''} disabled={pendingAction !== null} onClick={() => onEditNote(note)}>{pendingAction === `note-edit-${note.id}` ? 'Saving…' : 'Edit'}</button>
                      <button className={pendingAction === `note-delete-${note.id}` ? 'is-loading' : ''} disabled={pendingAction !== null} onClick={() => onDeleteNote(note)}>{pendingAction === `note-delete-${note.id}` ? 'Deleting…' : 'Delete'}</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
          )}
          {sidePanel === 'duplicates' && (
          <section className="mini-panel duplicate-panel">
            <div className="duplicate-panel-header">
              <div>
                <h3>Possible duplicates</h3>
                <p>Link matching feedback to keep the inbox tidy.</p>
              </div>
              <span>{duplicates.length}</span>
            </div>
            {item.duplicate_of_id && (
              <div className="duplicate-marked-status">
                <div className="duplicate-marked-icon" aria-hidden="true">✓</div>
                <div className="duplicate-marked-copy">
                  <span>Linked to original</span>
                  <button className="duplicate-original-link" onClick={() => onSelectFeedback(item.duplicate_of_id!)}>
                    Feedback #{item.duplicate_of_id}
                  </button>
                </div>
                {canMarkDuplicate && <button className={`duplicate-unmark${pendingAction === 'duplicate-clear' ? ' is-loading' : ''}`} disabled={pendingAction !== null} onClick={() => onMarkDuplicate(null)}>{pendingAction === 'duplicate-clear' ? 'Updating…' : 'Undo'}</button>}
              </div>
            )}
            {duplicates.length === 0 && <p className="muted">No likely duplicates found.</p>}
            <ul className="duplicate-list">
              {duplicates.map((candidate) => (
                <li className={`duplicate-item${item.duplicate_of_id === candidate.id ? ' is-marked' : ''}`} key={candidate.id}>
                  <div className="duplicate-candidate-head">
                    <span className="duplicate-score">{Math.round(candidate.similarity * 100)}% match</span>
                    {item.duplicate_of_id === candidate.id && <span className="duplicate-linked-badge">Linked</span>}
                  </div>
                  <button className="duplicate-content" onClick={() => onSelectFeedback(candidate.id)}>
                    <span className="duplicate-customer">
                      <strong>{candidate.customer_name}</strong>
                      <small>Feedback #{candidate.id}</small>
                    </span>
                    <span className="duplicate-message">{candidate.message}</span>
                  </button>
                  <div className="duplicate-actions">
                    <button className="duplicate-view" onClick={() => onSelectFeedback(candidate.id)}>View feedback</button>
                    {canMarkDuplicate && (
                      <button
                        className={`duplicate-action${pendingAction === `duplicate-${candidate.id}` ? ' is-loading' : ''}`}
                        disabled={item.duplicate_of_id === candidate.id || pendingAction !== null}
                        onClick={() => onMarkDuplicate(candidate.id)}
                      >
                        {pendingAction === `duplicate-${candidate.id}` ? 'Linking…' : item.duplicate_of_id === candidate.id ? 'Linked' : 'Mark duplicate'}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          )}
          {sidePanel === 'activity' && (
          <section className="mini-panel activity-panel">
            <div className="side-panel-heading">
              <div><h3>Activity</h3><p>A record of changes to this feedback.</p></div>
              <span>{activity.length}</span>
            </div>
            <div className="activity-list">
              {activity.map((entry) => {
                const description = activityDescription(entry)
                return <div key={entry.id} className="activity-entry">
                  <strong>{activityTitle(entry.action)}</strong>
                  {description && <p>{description}</p>}
                  <span>{entry.actor_name || 'System'} · {new Date(entry.created_at).toLocaleString()}</span>
                </div>
              })}
              {activity.length === 0 && <p className="empty-panel">No activity recorded yet.</p>}
            </div>
          </section>
          )}
        </aside>
      </div>
    </div>
  )
}
