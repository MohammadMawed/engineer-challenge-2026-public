import { useEffect, useState } from 'react'
import { getSession, logout } from './api'
import Inbox from './components/Inbox'
import Login from './components/Login'
import { User } from './types'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    const clearSession = () => setUser(null)
    window.addEventListener('pulse:unauthorized', clearSession)
    getSession()
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false))
    return () => window.removeEventListener('pulse:unauthorized', clearSession)
  }, [])

  const onLogout = async () => {
    setSigningOut(true)
    try {
      await logout()
    } finally {
      setUser(null)
      setSigningOut(false)
    }
  }

  if (checkingSession) {
    return <div className="login-wrap"><div className="login-card session-check">Checking your session…</div></div>
  }
  if (!user) return <Login onLogin={setUser} />

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Pulse</h1>
          <p className="topbar-subtitle">Customer feedback inbox</p>
        </div>
        <div className="topbar-right">
          <div className="topbar-identity">
            <span className="topbar-user">{user.name}</span>
            <span className={`role-badge ${user.role}`}>{user.role === 'manager' ? 'Manager' : 'Support agent'}</span>
          </div>
          <button className="link-button" disabled={signingOut} onClick={onLogout}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>
      <Inbox user={user} />
    </div>
  )
}
