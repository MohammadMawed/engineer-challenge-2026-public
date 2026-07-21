import { FormEvent, useState } from 'react'
import { confirmPasswordReset, login, requestPasswordReset } from '../api'
import { User } from '../types'

type LoginMode = 'login' | 'request-reset' | 'reset-password'

function requestError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ''
  return message === 'Failed to fetch' ? 'Could not reach the server. Please try again.' : message || fallback
}

export default function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const initialToken = new URLSearchParams(window.location.search).get('reset_token') || ''
  const [mode, setMode] = useState<LoginMode>(initialToken ? 'reset-password' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetToken, setResetToken] = useState(initialToken)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const switchMode = (nextMode: LoginMode) => {
    setMode(nextMode)
    setError('')
    setMessage('')
    setPassword('')
    setConfirmPassword('')
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      if (mode === 'login') {
        const result = await login(email, password)
        onLogin(result.user)
        return
      }

      if (mode === 'request-reset') {
        const result = await requestPasswordReset(email)
        setMessage(result.message)
        if (result.reset_token) {
          setResetToken(result.reset_token)
          setMode('reset-password')
        }
        return
      }

      if (password !== confirmPassword) {
        setError('Passwords do not match')
        return
      }
      const result = await confirmPasswordReset(resetToken, password)
      window.history.replaceState({}, '', window.location.pathname)
      switchMode('login')
      setMessage(result.message)
    } catch (err) {
      setError(requestError(err, 'The request could not be completed.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <span>Pulse</span>
          <strong>{mode === 'login' ? 'Sign in' : mode === 'request-reset' ? 'Reset password' : 'Choose a new password'}</strong>
        </div>
        <p className="subtitle">
          {mode === 'login'
            ? 'Secure access to your customer feedback workspace.'
            : mode === 'request-reset'
              ? 'Enter your account email to request a reset link.'
              : 'Use a 12-character password with uppercase, lowercase, and a number.'}
        </p>

        {mode !== 'reset-password' && (
          <label>
            Email
            <input
              autoComplete="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
            />
          </label>
        )}

        {mode === 'reset-password' && !initialToken && (
          <label>
            Reset token
            <input value={resetToken} onChange={(event) => setResetToken(event.target.value)} required />
          </label>
        )}

        {mode !== 'request-reset' && (
          <label>
            {mode === 'login' ? 'Password' : 'New password'}
            <input
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••••••"
              minLength={mode === 'reset-password' ? 12 : undefined}
              required
            />
          </label>
        )}

        {mode === 'reset-password' && (
          <label>
            Confirm new password
            <input
              autoComplete="new-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="••••••••••••"
              minLength={12}
              required
            />
          </label>
        )}

        {error && <div className="error" role="alert">{error}</div>}
        {message && <div className="login-message" role="status">{message}</div>}
        <button type="submit" disabled={loading}>
          {loading
            ? 'Please wait…'
            : mode === 'login'
              ? 'Sign in'
              : mode === 'request-reset'
                ? 'Request reset'
                : 'Update password'}
        </button>

        <div className="login-links">
          {mode === 'login' ? (
            <button type="button" onClick={() => switchMode('request-reset')}>Forgot password?</button>
          ) : (
            <button type="button" onClick={() => switchMode('login')}>Back to sign in</button>
          )}
        </div>
      </form>
    </div>
  )
}
