import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to devtools so it isn't a silent black screen.
    console.error('[ErrorBoundary] caught render error:', error, info?.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 px-6 text-center">
        <div className="h-14 w-14 rounded-2xl bg-mesh-danger/15 flex items-center justify-center">
          <AlertTriangle className="h-7 w-7 text-mesh-danger" />
        </div>
        <h3 className="text-base font-semibold text-mesh-text-primary">Something went wrong</h3>
        <p className="text-xs text-mesh-text-muted max-w-md break-words">
          {error.message || 'An unexpected error occurred while rendering this view.'}
        </p>
        <button
          onClick={this.reset}
          className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-mesh-green text-white text-xs font-semibold hover:bg-mesh-green/90 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    )
  }
}
