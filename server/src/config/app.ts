import cors from 'cors'
import express from 'express'
import { requestLogger } from '../middleware/requestLogger'

const allowedOrigins = new Set(
  (process.env.WEB_URL || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
)

export function createApp() {
  const app = express()
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    next()
  })
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin))
    },
  }))
  app.use((req, res, next) => {
    const changesState = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    const origin = req.get('origin')
    if (changesState && origin && !allowedOrigins.has(origin)) {
      return res.status(403).json({ error: 'Origin is not allowed' })
    }
    next()
  })
  app.use(express.json({ limit: '64kb' }))
  app.use(requestLogger)
  return app
}
