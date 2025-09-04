import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AppError, ErrorLogger, ErrorType } from '@/lib/errors';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorId: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorId: Date.now().toString(36) + Math.random().toString(36).substr(2)
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const appError = AppError.fromUnknown(error, {
      componentStack: errorInfo.componentStack,
      errorBoundary: true,
      errorId: this.state.errorId
    });

    ErrorLogger.log(appError);

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);
  }

  private handleRefresh = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorId: null
    });
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      // Custom fallback UI if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <CardTitle>Er is iets misgegaan</CardTitle>
              <CardDescription>
                De applicatie heeft een onverwachte fout ondervonden. 
                U kunt proberen de pagina te vernieuwen of naar de startpagina terug te gaan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {import.meta.env.DEV && this.state.error && (
                <details className="rounded border p-2 text-sm bg-muted">
                  <summary className="cursor-pointer font-medium text-destructive">
                    Error Details (Development)
                  </summary>
                  <div className="mt-2 whitespace-pre-wrap break-all text-xs">
                    <strong>Error ID:</strong> {this.state.errorId}
                    <br />
                    <strong>Message:</strong> {this.state.error.message}
                    <br />
                    <strong>Stack:</strong>
                    <br />
                    {this.state.error.stack}
                  </div>
                </details>
              )}
              
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={this.handleRefresh}
                  variant="default" 
                  className="w-full"
                  data-testid="button-refresh"
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Pagina Vernieuwen
                </Button>
                <Button
                  onClick={this.handleReset}
                  variant="outline"
                  className="w-full"
                  data-testid="button-reset"
                >
                  Opnieuw Proberen
                </Button>
              </div>
              
              <Button
                onClick={this.handleGoHome}
                variant="ghost"
                className="w-full"
                data-testid="button-home"
              >
                <Home className="mr-2 h-4 w-4" />
                Terug naar Start
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook voor het afhandelen van async errors in components
 */
export function useErrorHandler() {
  return React.useCallback((error: unknown, context?: Record<string, any>) => {
    const appError = AppError.fromUnknown(error, context);
    ErrorLogger.log(appError);
    
    // In een echte applicatie zou je hier ook een error reporting service kunnen aanroepen
    // bijvoorbeeld: errorReportingService.report(appError);
    
    throw appError;
  }, []);
}

/**
 * Higher-order component voor error boundaries
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
}