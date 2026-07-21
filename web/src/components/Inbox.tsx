import { useCallback, useEffect, useRef, useState } from 'react'
import {
  exportFeedbackUrl,
  createFeedback,
  fetchInbox,
  fetchMetrics,
  setFeedbackStatus,
} from '../api'
import { FeedbackItem, Metrics, User } from '../types'
import ItemDetail from './ItemDetail'

const PAGE_SIZE = 10

export default function Inbox({ user }: { user: User }) {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const latestRequest = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current
    try {
      const data = await fetchInbox(page, filter, search)
      if (requestId !== latestRequest.current) return
      setItems(Array.isArray(data.items) ? data.items : [])
      setTotal(Number.isFinite(data.total) ? data.total : 0)
      setError('')
    } catch (err) {
      if (requestId === latestRequest.current && (err as Error).message !== 'Session expired') {
        setError('Could not load feedback. Please try again.')
      }
    }
  }, [filter, page, search])

  const loadMetrics = useCallback(() => {
    fetchMetrics().then(setMetrics).catch(() => setMetrics(null))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    loadMetrics()
  }, [loadMetrics])

  useEffect(() => {
    const interval = setInterval(() => {
      void load()
      loadMetrics()
    }, 45000)
    return () => clearInterval(interval)
  }, [load, loadMetrics])

  const onResolve = async (item: FeedbackItem) => {
    const nextStatus = item.status === 'open' ? 'resolved' : 'open'
    setItems(items.map((it) => (it.id === item.id ? { ...it, status: nextStatus } : it)))
    try {
      await setFeedbackStatus(item.id, nextStatus)
      loadMetrics()
    } catch {
      setItems((current) => current.map((it) => (it.id === item.id ? item : it)))
    }
  }

  const onCreate = async () => {
    const customerId = Number(window.prompt('Customer ID'))
    const message = window.prompt('Feedback message')
    if (!Number.isInteger(customerId) || !message?.trim()) return
    await createFeedback({ customer_id: customerId, channel: 'email', message, category: 'other', tags: [] })
    setPage(1)
    await load()
    loadMetrics()
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (selectedId !== null) {
    return (
      <ItemDetail
        id={selectedId}
        user={user}
        onSelectFeedback={setSelectedId}
        onDeleted={() => { setSelectedId(null); void load(); loadMetrics() }}
        onBack={() => {
          setSelectedId(null)
          void load()
          loadMetrics()
        }}
      />
    )
  }

  return (
    <div className="inbox">
      {error && <div className="error-state"><span>{error}</span><button onClick={() => void load()}>Retry</button></div>}
      {metrics && (
        <div className="metrics-strip">
          <div>
            <strong>{metrics.open}</strong>
            <span>Open</span>
          </div>
          <div>
            <strong>{metrics.resolved}</strong>
            <span>Resolved</span>
          </div>
          <div>
            <strong>{metrics.urgent}</strong>
            <span>Urgent</span>
          </div>
          <div>
            <strong>{metrics.overdue}</strong>
            <span>Overdue</span>
          </div>
        </div>
      )}
      <div className="toolbar">
        <div className="filters">
          {['all', 'open', 'resolved'].map((f) => (
            <button
              key={f}
              className={'chip' + (filter === f ? ' active' : '')}
              onClick={() => {
                setFilter(f)
                setPage(1)
              }}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <input
          className="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Search VIPs, refunds, chaos..."
        />
        <button
          className="export-button"
          onClick={() => {
            window.location.href = exportFeedbackUrl(filter, search)
          }}
        >
          Export CSV
        </button>
        <button className="export-button" onClick={onCreate}>New feedback</button>
      </div>

      <table className="feedback-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Channel</th>
            <th>Priority</th>
            <th>Message</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Due</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="row" onClick={() => setSelectedId(item.id)}>
              <td>{item.customer_name}</td>
              <td>
                <span className="channel">{item.channel}</span>
              </td>
              <td>
                <span className={'priority ' + item.priority}>{item.priority}</span>
                {item.priority_source === 'ai' && <span className="ai-label">AI</span>}
              </td>
              <td className="preview">
                {item.message.slice(0, 70)}
                {item.message.length > 70 ? '…' : ''}
              </td>
              <td>{item.assignee_name || 'Nobody'}</td>
              <td>
                <span className={'badge ' + item.status}>{item.status}</span>
              </td>
              <td>{item.due_at ? new Date(item.due_at).toLocaleDateString() : 'Someday'}</td>
              <td>
                {item.permissions.can_change_status ? (
                  <button
                    className="link-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onResolve(item)
                    }}
                  >
                    {item.status === 'open' ? 'Resolve' : 'Reopen'}
                  </button>
                ) : <span className="read-only-label">View only</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  )
}
