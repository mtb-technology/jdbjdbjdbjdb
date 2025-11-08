/**
 * Error Boundary Component
 *
 * Catches and handles React component errors gracefully.
 * Prevents the entire application from crashing when a component fails.
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary fallback={(error) => <ErrorFallback error={error} />}>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 */

import React, { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, errorInfo: React.ErrorInfo) => ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Error Boundary component that catches errors in child components.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error to console
    console.error("❌ Error Boundary caught an error:", error, errorInfo);

    // Update state
    this.setState({
      error,
      errorInfo,
    });

    // Call optional error callback
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback && this.state.error && this.state.errorInfo) {
        return this.props.fallback(this.state.error, this.state.errorInfo);
      }

      // Default error UI
      return (
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Er is een fout opgetreden
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <p className="mb-2">
                Er is een onverwachte fout opgetreden in deze component.
              </p>
              {this.state.error && (
                <div className="mt-4 p-3 bg-red-50 dark:bg-red-950 rounded border border-red-200 dark:border-red-800">
                  <p className="font-mono text-xs text-red-800 dark:text-red-200">
                    {this.state.error.toString()}
                  </p>
                </div>
              )}
              {this.state.errorInfo && process.env.NODE_ENV === "development" && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    Toon stack trace (development only)
                  </summary>
                  <pre className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-auto max-h-64">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>
            <Button onClick={this.handleReset} variant="outline" className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />
              Probeer opnieuw
            </Button>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

/**
 * Default error fallback component for workflow errors.
 */
export function WorkflowErrorFallback({
  error,
  onReset,
}: {
  error: Error;
  onReset?: () => void;
}): JSX.Element {
  return (
    <Card className="border-red-500">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-600">
          <AlertTriangle className="h-5 w-5" />
          Workflow fout
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          <p className="mb-2">
            Er is een fout opgetreden tijdens het uitvoeren van de workflow.
          </p>
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-950 rounded border border-red-200 dark:border-red-800">
            <p className="font-mono text-xs text-red-800 dark:text-red-200">
              {error.message}
            </p>
          </div>
        </div>
        {onReset && (
          <Button onClick={onReset} variant="outline" className="w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            Reset workflow
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
