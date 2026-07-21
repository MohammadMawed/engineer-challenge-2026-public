import { Component, ErrorInfo, ReactNode } from 'react'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unexpected UI error', error, info)
  }

  render() {
    if (this.state.failed) {
      return <main className="fatal-error"><h1>Something went wrong</h1><p>Refresh the page to continue.</p><button onClick={() => window.location.reload()}>Refresh</button></main>
    }
    return this.props.children
  }
}
