import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
    copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null,
        copied: false
    };

    public static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
        this.setState({ errorInfo });
        window.electronAPI?.logRendererError?.({
            message: error.message,
            stack: (error.stack ?? '') + (errorInfo.componentStack ?? ''),
            source: 'renderer/ErrorBoundary'
        });
    }

    private getErrorText(): string {
        const parts: string[] = [];
        if (this.state.error) parts.push(this.state.error.toString());
        if (this.state.error?.stack) parts.push(this.state.error.stack);
        if (this.state.errorInfo?.componentStack) parts.push(this.state.errorInfo.componentStack);
        return parts.join('\n\n');
    }

    private handleCopy = () => {
        navigator.clipboard.writeText(this.getErrorText()).then(() => {
            this.setState({ copied: true });
            setTimeout(() => this.setState({ copied: false }), 2000);
        });
    };

    private handleReportGitHub = async () => {
        const errorText = this.getErrorText();
        const url = await window.electronAPI?.buildCrashReportUrl?.({
            message: this.state.error?.message ?? 'Unknown error',
            stack: errorText,
            source: 'renderer/ErrorBoundary'
        });
        if (url) window.electronAPI?.openExternal?.(url);
    };

    private handleOpenLogs = () => {
        window.electronAPI?.openLogDirectory?.();
    };

    private handleReload = () => {
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>Something went wrong</h1>
                    <p style={{ marginBottom: '1.5rem', color: '#666' }}>
                        The application encountered an unexpected error. Details have been written to the log file.
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
                            maxHeight: '300px',
                            fontSize: '0.8rem',
                            fontFamily: 'monospace',
                            userSelect: 'text',
                            cursor: 'text'
                        }}>
                            <div style={{ color: '#ef4444', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                                {this.state.error.toString()}
                            </div>
                            {this.state.error.stack && (
                                <pre style={{ color: '#64748b', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{this.state.error.stack}</pre>
                            )}
                            {this.state.errorInfo && (
                                <pre style={{ color: '#64748b', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{this.state.errorInfo.componentStack}</pre>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                            onClick={this.handleReportGitHub}
                            style={{
                                padding: '0.5rem 1rem',
                                background: '#24292f',
                                color: 'white',
                                borderRadius: '0.375rem',
                                border: 'none',
                                cursor: 'pointer'
                            }}
                        >
                            Report on GitHub
                        </button>
                        <button
                            onClick={this.handleCopy}
                            style={{
                                padding: '0.5rem 1rem',
                                background: '#e2e8f0',
                                color: '#0f172a',
                                borderRadius: '0.375rem',
                                border: 'none',
                                cursor: 'pointer'
                            }}
                        >
                            {this.state.copied ? 'Copied!' : 'Copy Error'}
                        </button>
                        <button
                            onClick={this.handleOpenLogs}
                            style={{
                                padding: '0.5rem 1rem',
                                background: '#e2e8f0',
                                color: '#0f172a',
                                borderRadius: '0.375rem',
                                border: 'none',
                                cursor: 'pointer'
                            }}
                        >
                            Open Log Directory
                        </button>
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
                </div>
            );
        }

        return this.props.children;
    }
}
