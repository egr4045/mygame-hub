import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Shown in the fallback header so we know which region failed. */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Isolates a region of the UI so one failing widget (e.g. the WebGL map) doesn't blank the whole
 * screen. Shows the error inline during development.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div
          className="civa-panel"
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            maxWidth: 480,
            padding: 14,
            pointerEvents: 'auto',
            borderLeft: '3px solid var(--c-negative)',
          }}
        >
          <strong style={{ color: 'var(--c-negative)' }}>⚠ {this.props.label} failed</strong>
          <pre
            style={{
              marginTop: 8,
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-xs)',
              color: 'var(--c-text-muted)',
            }}
          >
            {error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
