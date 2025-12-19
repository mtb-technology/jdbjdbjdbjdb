import { Switch, Route, Redirect, useLocation } from "wouter";
import { Suspense, lazy } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { EnhancedErrorBoundary as ErrorBoundary } from "@/components/enhanced-error-boundary";
import { useCommandPalette, type Command } from "@/components/ui/command-palette";
import { Home, FileText, Plus, Settings as SettingsIcon, Package, MessageSquare, Sparkles, FileCheck } from "lucide-react";

// Lazy loading enabled for optimal bundle splitting and performance
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Settings = lazy(() => import("@/pages/settings"));
const Pipeline = lazy(() => import("@/pages/pipeline"));
const Cases = lazy(() => import("@/pages/cases"));
const CaseDetail = lazy(() => import("@/pages/case-detail"));
const BatchProcessing = lazy(() => import("@/pages/batch-processing"));
const FollowUpAssistant = lazy(() => import("@/pages/follow-up-assistant"));
const TextStyler = lazy(() => import("@/pages/text-styler"));
const Box3Validator = lazy(() => import("@/pages/box3-validator"));
const AutomailEmbed = lazy(() => import("@/pages/automail-embed"));
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
  const [, setLocation] = useLocation();

  // Define global commands
  const commands: Command[] = [
    {
      id: 'go-cases',
      label: 'Go to Cases',
      description: 'View all your cases',
      icon: FileText,
      action: () => setLocation('/cases'),
      keywords: ['cases', 'list', 'overview'],
    },
    {
      id: 'new-case',
      label: 'New Case',
      description: 'Create a new case',
      icon: Plus,
      action: () => setLocation('/pipeline'),
      shortcut: {
        key: 'n',
        ctrlOrCmd: true,
        description: 'Create new case',
      },
      keywords: ['create', 'new', 'add'],
    },
    {
      id: 'go-pipeline',
      label: 'Go to Pipeline',
      description: 'Access the processing pipeline',
      icon: Home,
      action: () => setLocation('/pipeline'),
      keywords: ['pipeline', 'process'],
    },
    {
      id: 'go-batch',
      label: 'Go to Batch Processing',
      description: 'Process multiple cases at once',
      icon: Package,
      action: () => setLocation('/batch'),
      keywords: ['batch', 'bulk', 'multiple'],
    },
    {
      id: 'go-assistant',
      label: 'Go to Assistant',
      description: 'Open the follow-up assistant',
      icon: MessageSquare,
      action: () => setLocation('/assistant'),
      keywords: ['assistant', 'chat', 'help'],
    },
    {
      id: 'go-text-styler',
      label: 'Go to Text Styler',
      description: 'Style text and export to PDF',
      icon: Sparkles,
      action: () => setLocation('/text-styler'),
      keywords: ['text', 'style', 'format', 'pdf', 'export'],
    },
    {
      id: 'go-box3-validator',
      label: 'Go to Box 3 Validator',
      description: 'Validate Box 3 documents',
      icon: FileCheck,
      action: () => setLocation('/box3-validator'),
      keywords: ['box3', 'validator', 'documents', 'bezwaar'],
    },
    {
      id: 'go-settings',
      label: 'Go to Settings',
      description: 'Configure application settings',
      icon: SettingsIcon,
      action: () => setLocation('/settings'),
      keywords: ['settings', 'config', 'preferences'],
    },
  ];

  const { CommandPaletteComponent } = useCommandPalette(commands);

  return (
    <ErrorBoundary>
      <CommandPaletteComponent />
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
        <Route path="/text-styler">
          <LazyRoute Component={TextStyler} />
        </Route>
        <Route path="/box3-validator/new">
          <LazyRoute Component={Box3Validator} />
        </Route>
        <Route path="/box3-validator/:id">
          <LazyRoute Component={Box3Validator} />
        </Route>
        <Route path="/box3-validator">
          <LazyRoute Component={Box3Validator} />
        </Route>
        <Route path="/settings">
          <LazyRoute Component={Settings} />
        </Route>
        {/* Embedded views for Automail integration */}
        <Route path="/embed/automail/:conversationId">
          <LazyRoute Component={AutomailEmbed} />
        </Route>
        <Route path="/embed/case/:reportId">
          <LazyRoute Component={AutomailEmbed} />
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
