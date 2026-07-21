import { NextFunction, Request, Response } from 'express'
import { findActiveSession } from '../data/auth.data'
import { findUserById } from '../data/users.data'
import { clearedSessionCookie, readSessionToken, verifySessionToken } from '../services/auth.service'

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = readSessionToken(req)
  if (!token) return res.status(401).json({ error: 'Authentication required' })

  try {
    const identity = verifySessionToken(token)
    if (!Number.isInteger(identity.userId)) throw new Error('Invalid session user')
    const session = findActiveSession(identity.jti)
    const user = findUserById(identity.userId)
    if (!session || session.user_id !== identity.userId || !user) throw new Error('Session is no longer active')
    ;(req as any).user = { ...user, session_id: identity.jti }
    next()
  } catch {
    res.setHeader('Set-Cookie', clearedSessionCookie())
    res.status(401).json({ error: 'Session expired' })
  }
}

export function requireManager(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user
  if (user?.role !== 'manager') return res.status(403).json({ error: 'Manager access required' })
  next()
}
