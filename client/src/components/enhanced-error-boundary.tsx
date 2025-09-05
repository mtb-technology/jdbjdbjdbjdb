import React, { Component, ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';
import { AppError, ErrorLogger } from '@/lib/errors';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  feature?: string; // Name of the feature for specific error handling
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  showDetails?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
  retryCount: number;
}

export class EnhancedErrorBoundary extends Component<Props, State> {
  private retryTimeoutId: number | null = null;

  public state: State = {
    hasError: false,
    error: null,
    errorId: null,
    retryCount: 0
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      errorId: Date.now().toString(36) + Math.random().toString(36).substr(2)
    };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const appError = AppError.fromUnknown(error, {
      componentStack: errorInfo.componentStack,
      errorBoundary: true,
      errorId: this.state.errorId,
      feature: this.props.feature
    });

    ErrorLogger.log(appError);
    this.props.onError?.(error, errorInfo);
  }

  public componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  private handleRetry = () => {
    this.setState(prevState => ({ 
      hasError: false, 
      error: null, 
      errorId: null,
      retryCount: prevState.retryCount + 1
    }));
  };

  private handleRetryWithDelay = () => {
    const delay = Math.min(1000 * Math.pow(2, this.state.retryCount), 10000); // Exponential backoff, max 10s
    
    this.retryTimeoutId = setTimeout(() => {
      this.handleRetry();
    }, delay) as any;
  };

  private handleRefresh = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  private handleReportBug = () => {
    // Open email client or bug reporting system
    const subject = encodeURIComponent(`Bug Report: ${this.props.feature || 'Unknown Feature'}`);
    const body = encodeURIComponent(`
Error ID: ${this.state.errorId}
Feature: ${this.props.feature || 'Unknown'}
Error: ${this.state.error?.message || 'Unknown error'}
User Agent: ${navigator.userAgent}
Timestamp: ${new Date().toISOString()}
    `.trim());
    
    window.open(`mailto:support@fiscale-analist.nl?subject=${subject}&body=${body}`);
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isFeatureError = Boolean(this.props.feature);
      const canRetry = this.state.retryCount < 3;

      return (
        <Card className="w-full max-w-2xl mx-auto my-8">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>
              {isFeatureError 
                ? `Fout in ${this.props.feature}` 
                : "Er is iets misgegaan"
              }
            </CardTitle>
            <p className="text-muted-foreground">
              {isFeatureError
                ? `Er is een fout opgetreden in de ${this.props.feature} functionaliteit. De rest van de applicatie blijft werkzaam.`
                : "De applicatie heeft een onverwachte fout ondervonden."
              }
            </p>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {canRetry && (
                <Button 
                  onClick={this.handleRetry}
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Opnieuw proberen
                </Button>
              )}
              
              {!canRetry && (
                <Button 
                  onClick={this.handleRetryWithDelay}
                  className="flex items-center gap-2"
                  variant="outline"
                >
                  <RefreshCw className="h-4 w-4" />
                  Probeer over {Math.ceil(Math.min(1000 * Math.pow(2, this.state.retryCount), 10000) / 1000)}s
                </Button>
              )}
              
              {!isFeatureError && (
                <Button 
                  onClick={this.handleRefresh}
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Pagina vernieuwen
                </Button>
              )}
              
              <Button 
                onClick={this.handleGoHome}
                variant="outline"
                className="flex items-center gap-2"
              >
                <Home className="h-4 w-4" />
                Naar startpagina
              </Button>
            </div>
            
            <div className="text-center">
              <Button 
                onClick={this.handleReportBug}
                variant="ghost"
                size="sm"
                className="flex items-center gap-2"
              >
                <Bug className="h-4 w-4" />
                Bug rapporteren
              </Button>
            </div>

            {(this.props.showDetails || import.meta.env.DEV) && this.state.error && (
              <details className="rounded border p-3 text-sm bg-muted">
                <summary className="cursor-pointer font-medium text-destructive mb-2">
                  Technische details {import.meta.env.DEV ? '(Development)' : ''}
                </summary>
                <div className="space-y-2 text-xs font-mono">
                  <div>
                    <strong>Error ID:</strong> {this.state.errorId}
                  </div>
                  <div>
                    <strong>Feature:</strong> {this.props.feature || 'Unknown'}
                  </div>
                  <div>
                    <strong>Retry Count:</strong> {this.state.retryCount}
                  </div>
                  <div>
                    <strong>Message:</strong> {this.state.error.message}
                  </div>
                  {this.state.error.stack && (
                    <div>
                      <strong>Stack:</strong>
                      <pre className="mt-1 whitespace-pre-wrap break-all text-xs">
                        {this.state.error.stack}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

// Convenience wrapper for feature-specific error boundaries
export function FeatureErrorBoundary({ 
  children, 
  feature, 
  ...props 
}: Omit<Props, 'feature'> & { feature: string }) {
  return (
    <EnhancedErrorBoundary feature={feature} {...props}>
      {children}
    </EnhancedErrorBoundary>
  );
}