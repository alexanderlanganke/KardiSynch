import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
        this.setState({ errorInfo });
    }

    private handleReload = () => {
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>Something went wrong</h1>
                    <p style={{ marginBottom: '1.5rem', color: '#666' }}>
                        The application encountered an unexpected error.
                    </p>

                    {this.state.error && (
                        <div style={{
                            background: '#f1f5f9',
                            padding: '1rem',
                            borderRadius: '0.5rem',
                            border: '1px solid #e2e8f0',
                            textAlign: 'left',
                            marginBottom: '1.5rem',
                            overflow: 'auto',
                            maxHeight: '200px',
                            fontSize: '0.8rem',
                            fontFamily: 'monospace'
                        }}>
                            <div style={{ color: '#ef4444', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                                {this.state.error.toString()}
                            </div>
                            {this.state.errorInfo && (
                                <pre style={{ color: '#64748b' }}>{this.state.errorInfo.componentStack}</pre>
                            )}
                        </div>
                    )}

                    <button
                        onClick={this.handleReload}
                        style={{
                            padding: '0.5rem 1rem',
                            background: '#0f172a',
                            color: 'white',
                            borderRadius: '0.375rem',
                            border: 'none',
                            cursor: 'pointer'
                        }}
                    >
                        Reload Application
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
