# De Fiscale Analist - AI Agent Instructions

## Project Overview
Dutch fiscal analysis report generation platform with multi-stage AI workflow. Generates professional tax interpretation reports for Dutch clients using a streaming, multi-specialist review pipeline.

## Critical Architecture Patterns

### Multi-Stage AI Workflow System
The core business logic is a **sequential AI pipeline** with 13+ stages that transform client data into professional reports:

1. **Information Check** (`1_informatiecheck`) → validates completeness
2. **Complexity Check** (`2_complexiteitscheck`) → assesses difficulty
3. **Base Generation** (`3_generatie`) → creates initial report
4. **Specialist Reviews** (`4a` through `4g`) → 7 domain experts review and propose changes
   - Each specialist outputs structured `changeProposals` (see `shared/types/api.ts`)
   - User reviews proposals before processing
5. **Feedback Processing** (`5_feedback_verwerker`) → applies approved changes
6. **Change Summary** (`6_change_summary`) → documents modifications

**Key Files:**
- `server/services/streaming/decomposed-stages.ts` - stage execution with substeps
- `shared/streaming-types.ts` - streaming event types and substep definitions
- `server/config/index.ts` - REPORT_CONFIG with all 13 stage configurations

### Real-Time Streaming Architecture
Uses **Server-Sent Events (SSE)** for live progress updates during long-running AI operations:

- **Client**: `client/src/components/streaming/StreamingWorkflow.tsx` - connects to `/api/reports/:id/stages/:stageId/stream`
- **Server**: `server/routes/streaming-routes.ts` + `server/services/streaming/sse-handler.ts`
- **Events**: `StreamingEvent` types in `shared/streaming-types.ts` (`progress`, `token`, `stage_complete`, etc.)
- **Session Management**: `StreamingSessionManager` tracks active streams per report+stage

**Pattern:** Each specialist stage is decomposed into substeps (plan_queries → fetch_sources → review → process) that emit granular progress events.

### Dual AI Provider System
Supports both Google Gemini and OpenAI with model-specific handlers:

```typescript
// Configuration is centralized in server/config/index.ts
AI_MODELS = {
  'gemini-2.5-pro': { provider: 'google', handlerType: 'google', ... },
  'gpt-4o': { provider: 'openai', handlerType: 'openai-standard', ... },
  'o3-mini': { provider: 'openai', handlerType: 'openai-reasoning', ... }
}
```

**Factory Pattern**: `server/services/ai-models/ai-model-factory.ts` routes requests to correct handler:
- `GoogleAIHandler` - Gemini models (supports grounding)
- `OpenAIStandardHandler` - GPT-4o, GPT-4o-mini
- `OpenAIReasoningHandler` - o1/o3 reasoning models (limited parameters)
- `OpenAIDeepResearchHandler` - deep research models

**Per-Stage AI Config**: Each workflow stage can override the global AI config (provider, model, temperature) via `promptConfigs` table.

### Database Schema & Storage
PostgreSQL via Drizzle ORM with Neon serverless hosting:

**Core Tables** (`shared/schema.ts`):
- `reports` - stores full workflow state including:
  - `stageResults` - output from each stage
  - `conceptReportVersions` - evolving report snapshots
  - `substepResults` - review feedback and change proposals
  - `currentStage` - workflow position tracker
- `promptConfigs` - reusable multi-stage prompt templates
- `jobs` - async task queue for report generation
- `sources` - validated Dutch government URLs only

**Storage Layer**: `server/storage.ts` provides unified interface with fallback to in-memory storage.

### Path Aliases & Module Structure
```typescript
// vite.config.ts defines:
"@" → client/src
"@shared" → shared
"@assets" → attached_assets
```

**Shared Types**: All types flow through `shared/` directory - database schemas, API contracts, streaming types. This ensures type safety across the full stack.

## Critical Developer Workflows

### Running the Application
```bash
npm run dev          # Start development server on PORT (defaults to 3000)
npm run db:push      # Sync schema changes to database
npm run check        # TypeScript type checking
```

**Important**: PORT 3000 is used by default because macOS reserves 5000. The Express server serves BOTH API (`/api/*`) and Vite dev server (all other routes) from a single port.

### Database Migrations
Uses Drizzle Kit with push-based workflow (no migration files):
1. Edit `shared/schema.ts`
2. Run `npm run db:push` to sync to Neon database
3. Drizzle introspects and applies changes directly

**Config**: `drizzle.config.ts` points to `DATABASE_URL` env var.

### Testing AI Models
Use the `/api/test-ai` endpoint or `ReportGenerator.testAI()` method to validate API keys and model connectivity without running full workflows.

## Project-Specific Conventions

### Error Handling Pattern
Custom error classes in `server/middleware/errorHandler.ts`:

```typescript
// Throw semantic errors, not generic ones
throw ServerError.validation('Invalid data', 'Gebruikersvriendelijke melding');
throw ServerError.ai('API failed', { context: 'details' });

// All API responses use createApiSuccessResponse/createApiErrorResponse
// from shared/errors.ts for consistent structure
```

**Client-side**: React Query handles errors via `onError` callbacks in `client/src/lib/queryClient.ts`.

### Form Validation Strategy
1. Define Zod schema in `shared/schema.ts` (e.g., `dossierSchema`)
2. Create insert schema with `createInsertSchema()` from drizzle-zod
3. Use in API routes for runtime validation
4. Use in React Hook Form with `@hookform/resolvers/zod`

**Example**: `dossierSchema` is used in both `server/routes.ts` validation and `client/src/pages/pipeline.tsx` form.

### Source Validation Requirements
**CRITICAL**: All external sources must pass validation via `SourceValidator` service:

```typescript
// Only these Dutch government domains are allowed:
ALLOWED_DOMAINS = [
  'belastingdienst.nl',
  'wetten.overheid.nl', 
  'rijksoverheid.nl'
]
```

AI-generated content with external sources is automatically validated and rejected if non-compliant. This is enforced in `server/services/source-validator.ts`.

### State Management Pattern
- **Server State**: TanStack Query (React Query) for all API data fetching
- **Component State**: React `useState` for UI-only state
- **Form State**: React Hook Form with Zod validation
- **No Redux/Zustand**: This project uses React Query as the primary state management solution

### Routing Convention
Uses Wouter (lightweight React router):

```typescript
// client/src/App.tsx defines routes
<Route path="/" component={Pipeline} />           // Main workflow
<Route path="/cases/:id" component={CaseDetail} /> // Report detail with streaming
```

**API Routes**: Defined in `server/routes.ts` with `/api` prefix. Streaming routes are split into `server/routes/streaming-routes.ts`.

## Development Gotchas

### Environment Variables
`.env` file is REQUIRED with:
- `DATABASE_URL` - Neon connection string with `?sslmode=require`
- `OPENAI_API_KEY` or `GOOGLE_AI_API_KEY` - at least one AI provider
- `PORT=3000` - avoid macOS port 5000 conflict

**Validation**: `server/config/index.ts` validates all env vars on startup with Zod schema.

### TypeScript Configuration
- Strict mode enabled in `tsconfig.json`
- Use `type` imports for type-only imports: `import type { Report } from '@shared/schema'`
- Path aliases configured in both `tsconfig.json` and `vite.config.ts`

### Async Handler Pattern
All Express routes use `asyncHandler` wrapper from `server/middleware/errorHandler.ts` to catch async errors:

```typescript
app.get("/api/route", asyncHandler(async (req, res) => {
  // Errors automatically caught and sent to errorHandler middleware
}));
```

### Session Management
Express sessions stored in PostgreSQL via `connect-pg-simple`. Session cookie name is `connect.sid`. No authentication UI implemented yet - sessions are prepared for future auth.

### Concurrent Stage Execution Prevention
`server/routes.ts` maintains `activeStageRequests` Map to prevent duplicate execution of the same stage for a report. Check before starting new stage execution.

## AI Provider Specifics

### Google Gemini Features
- **Grounding**: Set `useGrounding: true` in stage config for web search integration
- **Models**: `gemini-2.5-pro` (high quality) or `gemini-2.5-flash` (fast)
- **Parameters**: supports temperature, topP, topK, maxOutputTokens

### OpenAI Features
- **Reasoning Models**: o1/o3 series use different API with limited parameters (no temperature/topP)
- **Standard Models**: GPT-4o series support full parameter set
- **Deep Research**: Specialized models for comprehensive analysis
- **Web Search**: Set `useWebSearch: true` in stage config (OpenAI only)

**Handler Selection**: Factory automatically routes to correct handler based on model name via `getAIModelConfig()` in `server/config/index.ts`.

## Testing & Debugging

### Health Checks
- `/api/health` - public health status (cached)
- `/api/health/detailed` - full diagnostic info (requires ADMIN_API_KEY)

Monitor AI service health via `AIHealthService` with periodic checks every 5 minutes.

### Logging Pattern
All API requests logged with request IDs for tracing:

```
✅ [req-id] GET /api/reports/123 200 in 45ms
❌ [req-id] POST /api/reports 400 in 12ms :: VALIDATION_ERROR
```

Emoji prefixes indicate success/failure. Configure log level via `LOG_LEVEL` env var.

### Development Debugging
- Vite HMR enabled for instant client updates
- Server watches TypeScript files via `tsx` in dev mode
- Error overlay via `@replit/vite-plugin-runtime-error-modal`

## Key Integration Points

### Report Generator → AI Models
`ReportGenerator` class delegates to `AIModelFactory` which routes to provider-specific handlers. All AI calls include jobId for monitoring.

### Streaming Workflow → SSE Handler
`DecomposedStages.executeStreamingStage()` emits events via `SSEHandler.broadcast()` which pushes to all connected clients listening to that reportId+stageId.

### Storage Layer → Database
`server/storage.ts` abstracts database operations. All database access should go through this layer, not direct Drizzle queries.

### Client Components → API
React Query hooks in pages fetch from `/api/*` endpoints. No direct fetch calls - always use `useQuery`/`useMutation` with proper error handling.

## Common Development Tasks

**Add a new workflow stage:**
1. Add stage config to `REPORT_CONFIG` in `server/config/index.ts`
2. Define stage prompt template in `promptConfigs` table
3. Add stage ID to `StageId` type in `shared/schema.ts`
4. Implement stage logic in `DecomposedStages` or add to `ReportGenerator`

**Add a new AI model:**
1. Add model config to `AI_MODELS` in `server/config/index.ts`
2. If new provider, create handler extending `BaseAIHandler`
3. Register in `AIModelFactory.initializeHandlers()`
4. Update model enum in `shared/schema.ts`

**Modify report schema:**
1. Edit `reports` table in `shared/schema.ts`
2. Run `npm run db:push` to sync
3. Update `InsertReport` type if needed
4. Regenerate types with TypeScript check

**Debug streaming issues:**
1. Check browser DevTools Network tab for SSE connection
2. Verify `StreamingSessionManager` session exists
3. Check server logs for stage execution errors
4. Inspect `substepResults` in database for checkpoint data
