import { Switch, Route, Redirect } from "wouter";
import { Suspense, lazy } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { EnhancedErrorBoundary as ErrorBoundary } from "@/components/enhanced-error-boundary";

// Lazy loading enabled for optimal bundle splitting and performance
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Settings = lazy(() => import("@/pages/settings"));
const Pipeline = lazy(() => import("@/pages/pipeline"));
const Cases = lazy(() => import("@/pages/cases"));
const CaseDetail = lazy(() => import("@/pages/case-detail"));
const BatchProcessing = lazy(() => import("@/pages/batch-processing"));
const FollowUpAssistant = lazy(() => import("@/pages/follow-up-assistant"));
const NotFound = lazy(() => import("@/pages/not-found"));

// Loading fallback component for better UX during code splitting
function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    </div>
  );
}

// Wrapper component to handle lazy loading properly with Wouter
function LazyRoute({ Component, ...props }: { Component: React.ComponentType<any>; [key: string]: any }) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Component {...props} />
    </Suspense>
  );
}

function Router() {
  return (
    <ErrorBoundary>
      <Switch>
        <Route path="/">
          <Redirect to="/cases" />
        </Route>
        <Route path="/dashboard">
          <LazyRoute Component={Dashboard} />
        </Route>
        <Route path="/pipeline">
          <LazyRoute Component={Pipeline} />
        </Route>
        <Route path="/cases">
          <LazyRoute Component={Cases} />
        </Route>
        <Route path="/cases/:id">
          <LazyRoute Component={CaseDetail} />
        </Route>
        <Route path="/batch">
          <LazyRoute Component={BatchProcessing} />
        </Route>
        <Route path="/assistant">
          <LazyRoute Component={FollowUpAssistant} />
        </Route>
        <Route path="/settings">
          <LazyRoute Component={Settings} />
        </Route>
        <Route>
          <LazyRoute Component={NotFound} />
        </Route>
      </Switch>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
