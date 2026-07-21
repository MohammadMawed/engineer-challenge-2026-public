import { NextFunction, Request, Response } from 'express'

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = performance.now()
  res.on('finish', () => {
    console.info(
      JSON.stringify({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Math.round(performance.now() - startedAt),
      })
    )
  })
  next()
}
