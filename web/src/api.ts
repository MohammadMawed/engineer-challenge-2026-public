import { API_URL } from './config'
import { AgentAssistResult, CustomerProfile, FeedbackActivity, FeedbackItem, InternalNote, Metrics, User } from './types'

function handleUnauthorized() {
  window.setTimeout(() => window.dispatchEvent(new Event('pulse:unauthorized')), 0)
}

function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, { ...init, credentials: 'include' })
}

async function readJson<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    handleUnauthorized()
    throw new Error('Session expired')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `Request failed with status ${res.status}`)
  }
  return res.json()
}

function requireSuccess(res: Response) {
  if (res.status === 401) {
    handleUnauthorized()
    throw new Error('Session expired')
  }
  if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
}

export async function login(email: string, password: string): Promise<{ user: User }> {
  return readJson(await apiFetch(`${API_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }))
}

export async function getSession(): Promise<{ user: User }> {
  return readJson(await apiFetch(`${API_URL}/session`))
}

export async function logout() {
  requireSuccess(await apiFetch(`${API_URL}/logout`, { method: 'POST' }))
}

export async function requestPasswordReset(email: string): Promise<{ message: string; reset_token?: string; reset_url?: string }> {
  return readJson(await apiFetch(`${API_URL}/password-reset/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }))
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<{ message: string }> {
  return readJson(await apiFetch(`${API_URL}/password-reset/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, new_password: newPassword }) }))
}

export async function fetchInbox(page: number, status: string, search: string): Promise<{ items: FeedbackItem[]; total: number; page: number }> {
  return readJson(await apiFetch(`${API_URL}/feedback?page=${page}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(search)}`))
}

export async function fetchItem(id: number): Promise<FeedbackItem> {
  return readJson(await apiFetch(`${API_URL}/feedback/${id}`))
}

export async function createFeedback(data: { customer_id: number; channel: string; message: string; category: FeedbackItem['category']; tags: string[] }): Promise<FeedbackItem> {
  return readJson(await apiFetch(`${API_URL}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }))
}

export async function deleteFeedback(id: number) {
  requireSuccess(await apiFetch(`${API_URL}/feedback/${id}`, { method: 'DELETE' }))
}

export async function setFeedbackStatus(id: number, status: 'open' | 'resolved'): Promise<FeedbackItem> {
  return readJson(await apiFetch(`${API_URL}/feedback/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }))
}

export async function fetchUsers(): Promise<{ users: User[] }> {
  return readJson(await apiFetch(`${API_URL}/users`))
}

export async function fetchMetrics(): Promise<Metrics> {
  return readJson(await apiFetch(`${API_URL}/metrics`))
}

export function exportFeedbackUrl(status: string, search: string) {
  return `${API_URL}/export.csv?status=${encodeURIComponent(status)}&q=${encodeURIComponent(search)}`
}

export async function fetchCustomer(id: number): Promise<CustomerProfile> {
  return readJson(await apiFetch(`${API_URL}/customers/${id}`))
}

export async function mergeCustomer(sourceId: number, targetId: number) {
  return readJson(await apiFetch(`${API_URL}/customers/${sourceId}/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_customer_id: targetId }) }))
}

export async function updateAssignment(id: number, data: { assignee_id: number | null; priority: string; due_at: string }): Promise<FeedbackItem> {
  return readJson(await apiFetch(`${API_URL}/feedback/${id}/assignment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }))
}

export async function updateFeedback(id: number, data: Partial<Pick<FeedbackItem, 'category' | 'tags' | 'duplicate_of_id'>>): Promise<FeedbackItem> {
  return readJson(await apiFetch(`${API_URL}/feedback/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }))
}

export async function fetchNotes(id: number): Promise<{ notes: InternalNote[] }> {
  return readJson(await apiFetch(`${API_URL}/feedback/${id}/notes`))
}

export async function addNote(id: number, data: { body: string; is_private: boolean }): Promise<InternalNote> {
  return readJson(await apiFetch(`${API_URL}/feedback/${id}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }))
}

export async function updateNote(feedbackId: number, noteId: number, body: string): Promise<InternalNote> {
  return readJson(await apiFetch(`${API_URL}/feedback/${feedbackId}/notes/${noteId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }))
}

export async function deleteNote(feedbackId: number, noteId: number) {
  requireSuccess(await apiFetch(`${API_URL}/feedback/${feedbackId}/notes/${noteId}`, { method: 'DELETE' }))
}

export async function fetchActivity(id: number): Promise<{ activity: FeedbackActivity[] }> {
  return readJson(await apiFetch(`${API_URL}/feedback/${id}/activity`))
}

export async function fetchDuplicates(id: number): Promise<{ candidates: Array<FeedbackItem & { similarity: number }> }> {
  return readJson(await apiFetch(`${API_URL}/feedback/${id}/duplicates`))
}

export async function updateEscalation(id: number, action: 'request' | 'approve' | 'reject', reason: string): Promise<FeedbackItem> {
  return readJson(await apiFetch(`${API_URL}/feedback/${id}/escalation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason }) }))
}

export async function summarize(id: number): Promise<{ summary: string }> {
  return readJson(await apiFetch(`${API_URL}/summarize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }))
}

export async function fetchAgentAssist(id: number): Promise<AgentAssistResult> {
  return readJson(await apiFetch(`${API_URL}/feedback/${id}/assist`, { method: 'POST' }))
}
