import { Component, type ReactNode } from 'react';

/** Keeps a crash inside one page from blanking the whole app (sidebar and header stay usable). */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey?: string }) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="err" role="alert"><b>This page hit an error.</b><div className="mono small-text" style={{ marginTop: 6 }}>{this.state.error.message}</div></div>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
