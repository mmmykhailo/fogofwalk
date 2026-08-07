import { Component, type ReactNode } from "react"
import { ErrorCard } from "~/components/ErrorCard"

interface Props {
  children: ReactNode
  /** Render this instead of the default card when an error is caught */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset)
      }
      return <ErrorCard error={this.state.error} reset={this.reset} />
    }
    return this.props.children
  }
}
