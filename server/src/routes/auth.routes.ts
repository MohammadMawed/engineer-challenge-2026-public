import { Request, Response, Router } from 'express'
import {
  cleanupAuthData,
  clearLoginLimit,
  consumePasswordResetToken,
  consumeRequestLimit,
  createAuthSession,
  createPasswordResetToken,
  findUserByEmail,
  getActiveLoginBlock,
  recordAccountFailure,
  recordAuthEvent,
  revokeSession,
} from '../data/auth.data'
import { findUserById } from '../data/users.data'
import { authenticate } from '../middleware/authenticate'
import {
  clearedSessionCookie,
  createSessionIdentity,
  deliverPasswordReset,
  issueSessionToken,
  newPasswordResetToken,
  resetTokenHash,
  sessionCookie,
} from '../services/auth.service'
import { hashPassword, passwordPolicyError, verifyPassword } from '../services/password.service'

export const authRouter = Router()

const FIFTEEN_MINUTES = 15 * 60 * 1000
const DUMMY_PASSWORD_HASH = hashPassword('Pulse dummy password 2026')

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function requestContext(req: Request) {
  return {
    ip: req.ip || req.socket.remoteAddress || 'unknown',
    userAgent: req.get('user-agent') || null,
  }
}

function publicUser(user: { id: number; email: string; name: string; role: string }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role }
}

function rateLimited(res: Response, retryAfter: number) {
  res.setHeader('Retry-After', String(Math.max(1, retryAfter)))
  return res.status(429).json({ error: 'Too many attempts. Try again later.' })
}

authRouter.get(['/login', '/lgin'], (_req, res) => {
  const webUrl = (process.env.WEB_URL || 'http://localhost:5173').split(',')[0].trim()
  res.redirect(webUrl)
})

authRouter.post('/login', (req, res) => {
  const email = normalizeEmail(req.body.email)
  const password = typeof req.body.password === 'string' ? req.body.password : ''
  const { ip, userAgent } = requestContext(req)
  const ipLimit = consumeRequestLimit('login_ip', ip, 10, FIFTEEN_MINUTES, FIFTEEN_MINUTES)
  if (!ipLimit.allowed) {
    recordAuthEvent('login_rate_limited', email || null, null, ip, userAgent, { scope: 'ip' })
    return rateLimited(res, ipLimit.retryAfter)
  }

  const accountBlock = getActiveLoginBlock('login_account', email)
  if (accountBlock.blocked) {
    recordAuthEvent('login_rate_limited', email || null, null, ip, userAgent, { scope: 'account' })
    return rateLimited(res, accountBlock.retryAfter)
  }

  const user = email ? findUserByEmail(email) : undefined
  const validPassword = verifyPassword(password, user?.password || DUMMY_PASSWORD_HASH)
  if (!user || !validPassword) {
    const accountLimit = recordAccountFailure(email || 'missing-email', 5, FIFTEEN_MINUTES, FIFTEEN_MINUTES)
    recordAuthEvent('login_failure', email || null, user?.id || null, ip, userAgent)
    if (!accountLimit.allowed) return rateLimited(res, accountLimit.retryAfter)
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  clearLoginLimit('login_account', email)
  cleanupAuthData()
  const identity = createSessionIdentity()
  createAuthSession(identity.jti, user.id, identity.expiresAt)
  const token = issueSessionToken(user.id, identity.jti)
  res.setHeader('Set-Cookie', sessionCookie(token))
  recordAuthEvent('login_success', user.email, user.id, ip, userAgent)
  res.json({ user: publicUser(user) })
})

authRouter.get('/session', authenticate, (req, res) => {
  res.json({ user: publicUser((req as any).user) })
})

authRouter.post('/logout', authenticate, (req, res) => {
  const user = (req as any).user
  const { ip, userAgent } = requestContext(req)
  revokeSession(user.session_id)
  recordAuthEvent('logout', user.email, user.id, ip, userAgent)
  res.setHeader('Set-Cookie', clearedSessionCookie())
  res.status(204).send()
})

authRouter.post('/password-reset/request', async (req, res) => {
  const email = normalizeEmail(req.body.email)
  const { ip, userAgent } = requestContext(req)
  const limit = consumeRequestLimit('reset_ip', ip, 5, FIFTEEN_MINUTES, FIFTEEN_MINUTES)
  if (!limit.allowed) return rateLimited(res, limit.retryAfter)

  const response: { message: string; reset_token?: string; reset_url?: string } = {
    message: 'If that account exists, password reset instructions have been prepared.',
  }
  const user = email ? findUserByEmail(email) : undefined
  if (!user) {
    recordAuthEvent('password_reset_requested', email || null, null, ip, userAgent)
    return res.status(202).json(response)
  }

  const token = newPasswordResetToken()
  createPasswordResetToken(user.id, resetTokenHash(token), new Date(Date.now() + 30 * 60 * 1000).toISOString())
  recordAuthEvent('password_reset_requested', user.email, user.id, ip, userAgent)
  try {
    const delivery = await deliverPasswordReset(user.email, token)
    if (delivery.resetToken) response.reset_token = delivery.resetToken
    if (delivery.resetUrl) response.reset_url = delivery.resetUrl
  } catch (err) {
    console.error('Password reset delivery failed', err)
    recordAuthEvent('password_reset_delivery_failed', user.email, user.id, ip, userAgent)
  }
  res.status(202).json(response)
})

authRouter.post('/password-reset/confirm', (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : ''
  const newPassword = typeof req.body.new_password === 'string' ? req.body.new_password : ''
  const { ip, userAgent } = requestContext(req)
  const limit = consumeRequestLimit('reset_confirm_ip', ip, 10, FIFTEEN_MINUTES, FIFTEEN_MINUTES)
  if (!limit.allowed) return rateLimited(res, limit.retryAfter)

  const policyError = passwordPolicyError(newPassword)
  if (!token || policyError) return res.status(400).json({ error: policyError || 'Reset token is required' })
  const userId = consumePasswordResetToken(resetTokenHash(token), hashPassword(newPassword))
  if (!userId) {
    recordAuthEvent('password_reset_failure', null, null, ip, userAgent)
    return res.status(400).json({ error: 'Reset link is invalid or expired' })
  }

  const user = findUserById(userId)
  if (user) clearLoginLimit('login_account', user.email.toLowerCase())
  recordAuthEvent('password_reset_success', user?.email || null, userId, ip, userAgent)
  res.setHeader('Set-Cookie', clearedSessionCookie())
  res.json({ message: 'Password updated. Sign in with your new password.' })
})
