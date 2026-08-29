import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-negative/30 bg-negative/10 p-6 text-center">
          <p className="font-semibold text-negative">Something went wrong</p>
          <p className="mt-1 text-sm text-muted">{this.state.error?.message || 'Unexpected error'}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })} className="mt-3 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-surfaceAlt">Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
