import { Suspense, lazy } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { ThemeProvider } from "@/components/theme-provider";

// Code splitting with lazy loading for better performance
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Settings = lazy(() => import("@/pages/settings"));
const Pipeline = lazy(() => import("@/pages/pipeline"));
const Cases = lazy(() => import("@/pages/cases"));
const CaseDetail = lazy(() => import("@/pages/case-detail"));
const NotFound = lazy(() => import("@/pages/not-found"));

// Loading component for lazy loaded routes
function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex items-center space-x-3">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        <span className="text-lg font-medium text-foreground">Pagina laden...</span>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Pipeline} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/cases" component={Cases} />
        <Route path="/cases/:id" component={CaseDetail} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
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
