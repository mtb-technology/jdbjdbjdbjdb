# Phase 1 Implementation Guide

## Progress Summary

### ✅ Completed Tasks

1. **AI Handler Tests** - DONE
   - Created `server/services/ai-models/__tests__/base-handler.test.ts` (375 lines)
   - Created `server/services/ai-models/__tests__/ai-model-factory.test.ts` (250 lines)
   - Coverage: Retry logic, circuit breaker, error handling, configuration validation

2. **Route Extraction Started** - IN PROGRESS
   - Created `server/routes/health-routes.ts` (150 lines)
   - Created `server/routes/prompt-routes.ts` (300 lines)

### 🚧 Remaining Tasks

#### 1. Complete Routes Splitting

Create the following route files:

**A. `server/routes/case-routes.ts`** (Extract lines 1325-1472 from routes.ts)
```typescript
/**
 * Case Management Routes
 * CRUD operations for cases/reports with pagination and filtering
 */
export function registerCaseRoutes(app: Express): void {
  // GET /api/cases - List all cases with pagination
  // GET /api/cases/:id - Get specific case
  // PATCH /api/cases/:id - Update case metadata
  // PATCH /api/cases/:id/status - Update case status
  // DELETE /api/cases/:id - Delete case
  // GET /api/cases/:id/export/:format - Export case (html/json/pdf)
}
```

**B. `server/routes/report-routes.ts`** (Extract lines 166-893 from routes.ts)
```typescript
/**
 * Report Generation and Stage Execution Routes
 * Core workflow operations
 */
export function registerReportRoutes(
  app: Express,
  reportGenerator: ReportGenerator,
  reportProcessor: ReportProcessor,
  sseHandler: SSEHandler
): void {
  // POST /api/test-ai
  // POST /api/extract-dossier
  // POST /api/reports/create
  // GET /api/reports/:id/stage/:stage/preview
  // GET /api/reports/:id/stage/:stage/prompt
  // POST /api/reports/:id/stage/:stage (with deduplication)
  // POST /api/reports/:id/manual-stage
  // DELETE /api/reports/:id/stage/:stage
  // POST /api/reports/:id/finalize
  // GET /api/reports
  // GET /api/reports/:id
}
```

**C. `server/routes/feedback-routes.ts`** (Extract lines 483-850 from routes.ts)
```typescript
/**
 * Feedback Processing Routes
 * Manual review and feedback application
 */
export function registerFeedbackRoutes(
  app: Express,
  reportProcessor: ReportProcessor,
  sseHandler: SSEHandler
): void {
  // GET /api/reports/:id/stage/:stageId/prompt-preview
  // POST /api/reports/:id/stage/:stageId/process-feedback
}
```

**D. `server/routes/stepback-routes.ts`** (Extract lines 1216-1322 from routes.ts)
```typescript
/**
 * Step-Back Capability Routes
 * Version control and concept overriding
 */
export function registerStepBackRoutes(
  app: Express,
  reportProcessor: ReportProcessor
): void {
  // POST /api/reports/:id/stage/:stageId/override-concept
  // POST /api/reports/:id/snapshots/promote
}
```

**E. `server/routes/followup-routes.ts`** (Extract lines 1474-1606 from routes.ts)
```typescript
/**
 * Follow-up Assistant Routes
 * Customer follow-up email handling
 */
export function registerFollowUpRoutes(app: Express): void {
  // POST /api/assistant/generate
  // GET /api/follow-up/sessions
  // GET /api/follow-up/sessions/:id
  // POST /api/follow-up/sessions
  // DELETE /api/follow-up/sessions/:id
  // POST /api/follow-up/sessions/:id/threads
}
```

**F. `server/routes/source-routes.ts`** (Extract lines 963-991 from routes.ts)
```typescript
/**
 * Source Validation Routes
 * Legal/fiscal source verification
 */
export function registerSourceRoutes(
  app: Express,
  sourceValidator: SourceValidator
): void {
  // POST /api/sources/validate
  // GET /api/sources
}
```

#### 2. Update Main Routes File

**`server/routes.ts`** - Simplified to:
```typescript
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ReportGenerator } from "./services/report-generator";
import { SourceValidator } from "./services/source-validator";
import { PDFGenerator } from "./services/pdf-generator";
import { ReportProcessor } from "./services/report-processor";
import { SSEHandler } from "./services/streaming/sse-handler";
import { StreamingSessionManager } from "./services/streaming/streaming-session-manager";

// Import route registrations
import { registerHealthRoutes } from "./routes/health-routes";
import { registerPromptRoutes } from "./routes/prompt-routes";
import { registerCaseRoutes } from "./routes/case-routes";
import { registerReportRoutes } from "./routes/report-routes";
import { registerFeedbackRoutes } from "./routes/feedback-routes";
import { registerStepBackRoutes } from "./routes/stepback-routes";
import { registerFollowUpRoutes } from "./routes/followup-routes";
import { registerSourceRoutes } from "./routes/source-routes";
import { registerStreamingRoutes } from "./routes/streaming-routes";
import { documentRouter } from "./routes/document-routes";
import { fileUploadRouter } from "./routes/file-upload-routes";

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize database with default prompts if needed
  try {
    await (storage as any).initializeDefaultPrompts?.();
  } catch (error) {
    console.warn("Could not initialize default prompts:", error);
  }

  // Initialize services
  const reportGenerator = new ReportGenerator();
  const sourceValidator = new SourceValidator();
  const pdfGenerator = new PDFGenerator();
  const sseHandler = new SSEHandler();
  const sessionManager = StreamingSessionManager.getInstance();

  const aiHandler = {
    generateContent: async (params: any) => {
      const result = await reportGenerator.testAI(params.prompt);
      return { content: result };
    }
  };
  const reportProcessor = new ReportProcessor(aiHandler);

  // Register all route modules
  registerHealthRoutes(app);
  registerPromptRoutes(app);
  registerCaseRoutes(app);
  registerReportRoutes(app, reportGenerator, reportProcessor, sseHandler);
  registerFeedbackRoutes(app, reportProcessor, sseHandler);
  registerStepBackRoutes(app, reportProcessor);
  registerFollowUpRoutes(app);
  registerSourceRoutes(app, sourceValidator);
  registerStreamingRoutes(app, sseHandler, sessionManager);

  // Register existing route modules
  app.use("/api/documents", documentRouter);
  app.use("/api/upload", fileUploadRouter);

  const httpServer = createServer(app);
  return httpServer;
}
```

#### 3. Extract Configuration Constants

Create `server/config/constants.ts`:

```typescript
/**
 * Centralized Configuration Constants
 *
 * All magic numbers, timeouts, and configuration values
 * extracted to a single source of truth.
 */

// API Timeouts
export const TIMEOUTS = {
  AI_REQUEST: 120_000,              // 2 minutes for standard AI requests
  AI_LONG_OPERATION: 300_000,       // 5 minutes for complex operations
  AI_REASONING: 600_000,            // 10 minutes for reasoning models
  CIRCUIT_BREAKER_RECOVERY: 60_000, // 1 minute before circuit breaker retry
  REQUEST_DEDUPLICATION: 300_000,   // 5 minutes for duplicate request window
  HTTP_TIMEOUT: 30_000,             // 30 seconds for HTTP requests
} as const;

// Circuit Breaker Configuration
export const CIRCUIT_BREAKER = {
  FAILURE_THRESHOLD: 5,           // Open circuit after 5 failures
  RECOVERY_TIMEOUT_MS: 60_000,    // Try recovery after 60 seconds
  HALF_OPEN_MAX_REQUESTS: 3,      // Max requests in half-open state
  SUCCESS_TO_CLOSE: 1,            // Successes needed to close circuit
} as const;

// Pagination Defaults
export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1,
  DEFAULT_PAGE: 1,
} as const;

// AI Token Limits
export const AI_TOKENS = {
  DEFAULT_MAX: 8_192,
  LONG_CONTENT_MAX: 32_768,
  VALIDATION_MAX: 100_000,
  MIN_OUTPUT: 100,
} as const;

// Retry Configuration
export const RETRY = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1_000,
  MAX_DELAY_MS: 10_000,
  JITTER_FACTOR: 0.3,  // 30% random jitter to prevent thundering herd
} as const;

// Cache Configuration
export const CACHE = {
  HEALTH_CHECK_TTL: 25_000,       // 25 seconds
  PROMPT_CONFIG_TTL: 300_000,     // 5 minutes
  REPORT_LIST_TTL: 60_000,        // 1 minute
  REPORT_DETAIL_TTL: 5_000,       // 5 seconds
  SOURCE_LIST_TTL: 600_000,       // 10 minutes
} as const;

// File Upload Limits
export const FILE_UPLOAD = {
  MAX_SIZE_BYTES: 10_000_000,     // 10 MB
  MAX_FILES: 10,
  ALLOWED_EXTENSIONS: ['.pdf', '.txt', '.docx', '.doc'],
} as const;

// Backup Configuration
export const BACKUP = {
  MAX_BACKUPS_TO_KEEP: 10,
  BACKUP_DIR: 'backups',
} as const;

// Memory Management (WorkflowContext)
export const MEMORY = {
  MAX_STAGE_RESULTS: 100,
  MAX_CONCEPT_VERSIONS: 50,
  MAX_HISTORY_ENTRIES: 20,
} as const;

// Rate Limiting
export const RATE_LIMIT = {
  WINDOW_MS: 15 * 60 * 1000,      // 15 minutes
  MAX_REQUESTS: 100,
  ADMIN_MAX_REQUESTS: 100,
} as const;

// Input Validation
export const VALIDATION = {
  CLIENT_NAME_MAX_LENGTH: 200,
  RAW_TEXT_MAX_LENGTH: 5_000_000, // 5 MB
  USER_INSTRUCTIONS_MAX_LENGTH: 50_000,
  PROMPT_MAX_LENGTH: 100_000,
} as const;
```

Then update imports throughout the codebase:
```typescript
import { TIMEOUTS, CIRCUIT_BREAKER, RETRY } from '../config/constants';

// Instead of:
timeout: 120000

// Use:
timeout: TIMEOUTS.AI_REQUEST
```

#### 4. Add Error Boundaries

Create `client/src/components/ErrorBoundary.tsx`:

```tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);

    this.setState({
      error,
      errorInfo
    });

    // Call optional error handler
    this.props.onError?.(error, errorInfo);

    // Send to error reporting service (e.g., Sentry)
    // reportErrorToService(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback
      return (
        <Card className="max-w-2xl mx-auto mt-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Er is iets misgegaan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Deze sectie kon niet worden geladen door een onverwachte fout.
            </p>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Technische details (alleen zichtbaar in development)
                </summary>
                <pre className="mt-2 p-4 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-auto">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}

            <div className="flex gap-2">
              <Button onClick={this.handleReset} variant="default">
                <RefreshCw className="h-4 w-4 mr-2" />
                Probeer opnieuw
              </Button>
              <Button
                onClick={() => window.location.reload()}
                variant="outline"
              >
                Pagina verversen
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

// Convenience components for specific sections
export function WorkflowErrorFallback() {
  return (
    <Card className="max-w-2xl mx-auto mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-yellow-600">
          <AlertTriangle className="h-5 w-5" />
          Workflow kon niet worden geladen
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          De workflow weergave heeft een fout. Probeer de pagina te verversen.
        </p>
        <Button onClick={() => window.location.reload()}>
          Pagina verversen
        </Button>
      </CardContent>
    </Card>
  );
}

export function ReportPreviewErrorFallback() {
  return (
    <Card className="max-w-2xl mx-auto mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-yellow-600">
          <AlertTriangle className="h-5 w-5" />
          Rapport preview niet beschikbaar
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          De rapport preview kon niet worden weergegeven.
        </p>
      </CardContent>
    </Card>
  );
}
```

Then wrap components in error boundaries:

**`client/src/pages/case-detail.tsx`**:
```tsx
import { ErrorBoundary, WorkflowErrorFallback, ReportPreviewErrorFallback } from '@/components/ErrorBoundary';

export default function CaseDetailPage() {
  // ... existing code ...

  return (
    <div className="container mx-auto py-6">
      <ErrorBoundary fallback={<WorkflowErrorFallback />}>
        <WorkflowView reportId={id!} />
      </ErrorBoundary>

      <ErrorBoundary fallback={<ReportPreviewErrorFallback />}>
        <StickyReportPreview reportId={id!} />
      </ErrorBoundary>
    </div>
  );
}
```

**`client/src/pages/settings.tsx`**:
```tsx
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function SettingsPage() {
  return (
    <ErrorBoundary>
      {/* existing settings content */}
    </ErrorBoundary>
  );
}
```

## Running Tests

After completing the implementation:

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test base-handler.test.ts

# Run in watch mode
npm test -- --watch
```

## Verification Checklist

- [ ] All test files run successfully
- [ ] Health routes work: `curl http://localhost:5000/api/health`
- [ ] Prompt routes work: `curl http://localhost:5000/api/prompts`
- [ ] No compilation errors after route split
- [ ] All endpoints still respond correctly
- [ ] Error boundaries catch and display errors properly
- [ ] Configuration constants are used consistently

## Next Steps (Phase 2)

After completing Phase 1:
1. Refactor base-handler.ts retry logic
2. Add database indexes
3. Split large client components
4. Add API contract tests
5. Implement code splitting

## Estimated Time

- Complete route splitting: 2-3 days
- Extract configuration constants: 1 day
- Add error boundaries: 1 day
- Testing and verification: 1 day

**Total: 5-6 days**
