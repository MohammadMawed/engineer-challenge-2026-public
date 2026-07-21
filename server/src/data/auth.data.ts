import { db } from '../database/db'

export type AuthUser = {
  id: number
  email: string
  password: string
  name: string
  role: 'agent' | 'manager'
}

type AuthLimit = {
  attempts: number
  window_started_at: string
  blocked_until: string | null
}

export function findUserByEmail(email: string): AuthUser | undefined {
  return db.prepare('SELECT id, email, password, name, role FROM users WHERE lower(email) = ?').get(email) as AuthUser | undefined
}

export function createAuthSession(jti: string, userId: number, expiresAt: string) {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO auth_sessions (jti, user_id, expires_at, revoked_at, created_at, last_seen_at)
     VALUES (?, ?, ?, NULL, ?, ?)`
  ).run(jti, userId, expiresAt, now, now)
}

export function findActiveSession(jti: string) {
  return db.prepare(
    `SELECT jti, user_id, expires_at
     FROM auth_sessions
     WHERE jti = ? AND revoked_at IS NULL AND expires_at > ?`
  ).get(jti, new Date().toISOString()) as { jti: string; user_id: number; expires_at: string } | undefined
}

export function revokeSession(jti: string) {
  db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), jti)
}

export function revokeUserSessions(userId: number) {
  db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), userId)
}

export function recordAuthEvent(
  event: string,
  email: string | null,
  userId: number | null,
  ipAddress: string,
  userAgent: string | null,
  details: Record<string, unknown> = {}
) {
  db.prepare(
    `INSERT INTO auth_events (event, email, user_id, ip_address, user_agent, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(event, email, userId, ipAddress, userAgent, JSON.stringify(details), new Date().toISOString())
}

function retryAfter(blockedUntil: string | null, now: number) {
  if (!blockedUntil) return 0
  return Math.max(0, Math.ceil((Date.parse(blockedUntil) - now) / 1000))
}

export function getActiveLoginBlock(scope: string, subject: string) {
  const row = db.prepare(
    'SELECT attempts, window_started_at, blocked_until FROM auth_login_limits WHERE scope = ? AND subject = ?'
  ).get(scope, subject) as AuthLimit | undefined
  const now = Date.now()
  const retry = retryAfter(row?.blocked_until || null, now)
  return { blocked: retry > 0, retryAfter: retry }
}

function updateLimit(
  scope: string,
  subject: string,
  maxAttempts: number,
  windowMs: number,
  blockMs: number,
  blockAtLimit: boolean
) {
  return db.transaction(() => {
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const row = db.prepare(
      'SELECT attempts, window_started_at, blocked_until FROM auth_login_limits WHERE scope = ? AND subject = ?'
    ).get(scope, subject) as AuthLimit | undefined
    const activeRetry = retryAfter(row?.blocked_until || null, now)
    if (activeRetry > 0) return { allowed: false, retryAfter: activeRetry }

    const windowExpired = !row || Date.parse(row.window_started_at) + windowMs <= now
    const attempts = windowExpired ? 1 : row.attempts + 1
    const shouldBlock = blockAtLimit ? attempts >= maxAttempts : attempts > maxAttempts
    const blockedUntil = shouldBlock ? new Date(now + blockMs).toISOString() : null
    const windowStartedAt = windowExpired ? nowIso : row.window_started_at

    db.prepare(
      `INSERT INTO auth_login_limits (scope, subject, attempts, window_started_at, blocked_until, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, subject) DO UPDATE SET
         attempts = excluded.attempts,
         window_started_at = excluded.window_started_at,
         blocked_until = excluded.blocked_until,
         updated_at = excluded.updated_at`
    ).run(scope, subject, attempts, windowStartedAt, blockedUntil, nowIso)

    return {
      allowed: !shouldBlock,
      retryAfter: shouldBlock ? Math.ceil(blockMs / 1000) : 0,
    }
  })()
}

export function consumeRequestLimit(scope: string, subject: string, maxAttempts: number, windowMs: number, blockMs: number) {
  return updateLimit(scope, subject, maxAttempts, windowMs, blockMs, false)
}

export function recordAccountFailure(subject: string, maxAttempts: number, windowMs: number, blockMs: number) {
  return updateLimit('login_account', subject, maxAttempts, windowMs, blockMs, true)
}

export function clearLoginLimit(scope: string, subject: string) {
  db.prepare('DELETE FROM auth_login_limits WHERE scope = ? AND subject = ?').run(scope, subject)
}

export function createPasswordResetToken(userId: number, tokenHash: string, expiresAt: string) {
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now, userId)
    db.prepare(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used_at, created_at)
       VALUES (?, ?, ?, NULL, ?)`
    ).run(userId, tokenHash, expiresAt, now)
  })()
}

export function consumePasswordResetToken(tokenHash: string, passwordHash: string) {
  return db.transaction(() => {
    const now = new Date().toISOString()
    const token = db.prepare(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`
    ).get(tokenHash, now) as { id: number; user_id: number } | undefined
    if (!token) return null

    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(passwordHash, token.user_id)
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(now, token.id)
    db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, token.user_id)
    return token.user_id
  })()
}

export function cleanupAuthData() {
  db.transaction(() => {
    db.prepare("DELETE FROM auth_sessions WHERE datetime(expires_at) < datetime('now', '-7 days')").run()
    db.prepare("DELETE FROM password_reset_tokens WHERE datetime(expires_at) < datetime('now', '-1 day')").run()
    db.prepare("DELETE FROM auth_login_limits WHERE datetime(updated_at) < datetime('now', '-1 day')").run()
  })()
}
