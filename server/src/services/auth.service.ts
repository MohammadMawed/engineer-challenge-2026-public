import { createHash, randomBytes, randomUUID } from 'crypto'
import { Request } from 'express'
import jwt from 'jsonwebtoken'

export const SESSION_COOKIE = 'pulse_session'
export const SESSION_TTL_SECONDS = Math.max(900, Number(process.env.SESSION_TTL_HOURS || 8) * 60 * 60)

const configuredSecret = process.env.JWT_SECRET?.trim()
if (process.env.NODE_ENV === 'production' && (!configuredSecret || configuredSecret.length < 32)) {
  throw new Error('JWT_SECRET must be at least 32 characters in production')
}

export const JWT_SECRET = configuredSecret && configuredSecret.length >= 32
  ? configuredSecret
  : randomBytes(48).toString('base64url')

if (!configuredSecret || configuredSecret.length < 32) {
  console.warn('JWT_SECRET is missing or too short; using an ephemeral development secret')
}

export function createSessionIdentity() {
  const jti = randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString()
  return { jti, expiresAt }
}

export function issueSessionToken(userId: number, jti: string) {
  return jwt.sign({}, JWT_SECRET, {
    algorithm: 'HS256',
    audience: 'pulse-web',
    issuer: 'pulse-api',
    subject: String(userId),
    jwtid: jti,
    expiresIn: SESSION_TTL_SECONDS,
  })
}

export function verifySessionToken(token: string) {
  const payload = jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    audience: 'pulse-web',
    issuer: 'pulse-api',
  })
  if (typeof payload === 'string' || !payload.sub || !payload.jti) throw new Error('Invalid session')
  return { userId: Number(payload.sub), jti: payload.jti }
}

export function readSessionToken(req: Request) {
  const cookies = Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=')
        return separator < 0
          ? [part, '']
          : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))]
      })
  )
  return cookies[SESSION_COOKIE] || null
}

export function sessionCookie(token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`
}

export function clearedSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`
}

export function resetTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function newPasswordResetToken() {
  return randomBytes(32).toString('base64url')
}

export async function deliverPasswordReset(email: string, token: string) {
  const webUrl = (process.env.WEB_URL || 'http://localhost:5173').split(',')[0].trim()
  const resetUrl = `${webUrl}/?reset_token=${encodeURIComponent(token)}`
  if (process.env.NODE_ENV !== 'production') return { resetToken: token, resetUrl }

  const webhookUrl = process.env.PASSWORD_RESET_WEBHOOK_URL
  if (!webhookUrl) throw new Error('PASSWORD_RESET_WEBHOOK_URL is required for production password reset')
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, reset_url: resetUrl }),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`Password reset delivery failed with status ${response.status}`)
  return {}
}
