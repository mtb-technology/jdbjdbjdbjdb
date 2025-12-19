# Job System - Background Processing

> **Status**: Production
> **Doel**: Lange AI-operaties asynchroon uitvoeren zonder browser te blokkeren

---

## 1. Overzicht

Het Job System maakt het mogelijk om AI-intensieve taken op de achtergrond uit te voeren. De browser kan sluiten en de job blijft doorlopen.

```
┌─────────────────────────────────────────────────────────────────────┐
│  JOB LIFECYCLE                                                      │
│                                                                     │
│  ┌──────────┐    ┌────────────┐    ┌───────────┐                  │
│  │  QUEUED  │ ─► │ PROCESSING │ ─► │ COMPLETED │                  │
│  └──────────┘    └────────────┘    └───────────┘                  │
│                        │                                            │
│                        ▼                                            │
│                  ┌──────────┐                                       │
│                  │  FAILED  │                                       │
│                  └──────────┘                                       │
│                                                                     │
│  Polling: Backend checkt elke 3 seconden voor queued jobs         │
│  Frontend pollt elke 5 seconden voor status updates               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Kernbestanden

| Bestand | Doel |
|---------|------|
| [server/services/job-processor.ts](../server/services/job-processor.ts) | **Background worker** - haalt jobs op en voert ze uit |
| [server/routes/job-routes.ts](../server/routes/job-routes.ts) | API endpoints voor job management |
| [server/storage.ts](../server/storage.ts) | Database operaties |
| [shared/schema.ts](../shared/schema.ts) | Jobs tabel definitie |
| [client/src/hooks/useJobPolling.ts](../client/src/hooks/useJobPolling.ts) | Frontend polling hooks |

---

## 3. Database Schema

```typescript
// shared/schema.ts
jobs = {
  id: varchar (UUID),
  type: text,              // "single_stage" | "express_mode" | "box3_validation" | "box3_revalidation"
  status: text,            // "queued" | "processing" | "completed" | "failed"
  reportId: varchar,       // FK naar reports (voor rapport jobs)
  box3DossierId: varchar,  // Voor Box3 jobs (geen FK)
  progress: text,          // JSON met voortgang details
  result: json,            // Eindresultaat
  error: text,             // Foutmelding bij failure
  startedAt: timestamp,
  completedAt: timestamp,
  createdAt: timestamp
}
```

---

## 4. Job Types

| Type | Beschrijving | Referentie |
|------|--------------|------------|
| `single_stage` | Eén AI stage uitvoeren | `reportId` |
| `express_mode` | Meerdere stages sequentieel | `reportId` |
| `box3_validation` | Box3 intake validatie | `box3DossierId` |
| `box3_revalidation` | Box3 hervalidatie | `box3DossierId` |

---

## 5. API Endpoints

### Job Creatie

#### `POST /api/reports/:id/jobs/stage`
Creëer single stage job.

```typescript
// Request
{
  stageId: "4a_BronnenSpecialist",
  customInput?: string,
  reportDepth?: "quick" | "balanced" | "comprehensive",
  reportLanguage?: "nl" | "en"
}

// Response
{
  jobId: "uuid-123",
  status: "queued"
}
```

#### `POST /api/reports/:id/jobs/express-mode`
Creëer express mode job (meerdere stages).

```typescript
// Request
{
  includeGeneration: boolean,    // Inclusief Stage 3
  autoAccept: boolean,           // Auto-process feedback
  stages?: string[],             // Custom stage lijst
  reportDepth?: "concise" | "balanced" | "comprehensive",
  reportLanguage?: "nl" | "en"
}

// Response
{
  jobId: "uuid-456",
  status: "queued"
}
```

### Job Status

#### `GET /api/jobs/:id`
Haal job status op.

```typescript
// Response
{
  id: "uuid-123",
  type: "single_stage",
  status: "processing",
  progress: {
    currentStage: "4a_BronnenSpecialist",
    percentage: 50,
    message: "Analyseren bronverwijzingen...",
    stages: [
      { stageId: "4a", status: "processing", percentage: 50 }
    ]
  },
  result: null,
  error: null
}
```

#### `POST /api/jobs/:id/cancel`
Annuleer een job.

```typescript
// Response
{
  success: true,
  message: "Job cancelled"
}
```

### Actieve Jobs

| Endpoint | Beschrijving |
|----------|--------------|
| `GET /api/reports/:id/jobs` | Alle jobs voor rapport |
| `GET /api/reports/:id/jobs/active` | Actieve jobs voor rapport |
| `GET /api/jobs/active` | Alle actieve jobs (cross-rapport) |

---

## 6. Job Processor (Backend Worker)

### Architectuur

```
┌─────────────────────────────────────────────────────────────────┐
│  JobProcessor (Singleton)                                       │
│                                                                 │
│  start()  ──► Polling loop (elke 3 sec)                        │
│     │                                                           │
│     ├─► pollForJobs()                                          │
│     │      │                                                    │
│     │      ├─► Fetch queued jobs                               │
│     │      │                                                    │
│     │      └─► processJob(job)                                 │
│     │             │                                             │
│     │             ├─► single_stage → processSingleStage()      │
│     │             ├─► express_mode → processExpressMode()      │
│     │             └─► box3_* → processBox3Revalidation()       │
│     │                                                           │
│  stop()   ──► Stop polling (graceful shutdown)                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Single Stage Processing

```typescript
processSingleStage(job) {
  1. Haal report op uit database
  2. Extract attachments (tekst + vision OCR)
  3. Update job progress → 25%
  4. Roep reportGenerator.executeStage() aan
  5. Update job progress → 75%
  6. Sla stageResults op in report
  7. Voor Stage 3: Initialiseer conceptReportVersions
  8. Complete job → 100%
}
```

### Express Mode Processing

```typescript
processExpressMode(job) {
  1. Optioneel: Stage 3 (generatie)
  2. Voor elke review stage (4a-4f):
     a. Execute stage → feedback JSON
     b. Als autoAccept: Editor stage → pas wijzigingen toe
     c. Track changesCount per stage
  3. Genereer Fiscale Briefing (Stage 7)
  4. Stuur Slack notificatie
  5. Return: { stages, totalChanges, finalContent, fiscaleBriefing }
}
```

### Server Lifecycle

```typescript
// server/index.ts

// Bij opstarten
server.listen(port, () => {
  startJobProcessor();  // Begin polling
});

// Bij afsluiten (SIGTERM/SIGINT)
gracefulShutdown() {
  stopJobProcessor();   // Stop polling
  server.close();       // Sluit HTTP server
}
```

---

## 7. Frontend Polling Hooks

### `useJobPolling()`

Poll specifieke job status.

```typescript
const {
  job,           // Job object met status/progress
  isLoading,     // Eerste fetch
  isPolling,     // Actief pollen
  progress,      // Parsed progress object
  stopPolling    // Handmatig stoppen
} = useJobPolling({
  jobId: "uuid-123",
  reportId: "report-456",
  onComplete: (job) => { /* success callback */ },
  onError: (job) => { /* error callback */ },
  enabled: true,
  pollInterval: 5000  // 5 seconden
});
```

**Auto-stop**: Stopt automatisch bij `status: completed` of `status: failed`

### `useActiveJobs()`

Check actieve jobs voor een rapport.

```typescript
const {
  hasActiveJobs,  // Boolean
  activeJobs,     // Job[]
  isLoading,
  refetch,
  invalidate
} = useActiveJobs(reportId);

// Polling intervals:
// - 5s als er actieve jobs zijn
// - 60s als er geen actieve jobs zijn
```

### `useAllActiveJobs()`

Alle actieve jobs over alle rapporten.

```typescript
const {
  totalActiveJobs,       // Totaal aantal
  reportIds,             // Rapport IDs met actieve jobs
  byReport,              // Map<reportId, Job[]>
  hasActiveJobForReport  // (id) => boolean
} = useAllActiveJobs();

// Gebruikt in cases list voor job indicators
```

### `useCreateJob()`

Creëer nieuwe jobs.

```typescript
const { createStageJob, createExpressModeJob } = useCreateJob();

// Single stage
const jobId = await createStageJob(
  reportId,
  "4a_BronnenSpecialist",
  customInput,
  depth,
  language
);

// Express mode
const jobId = await createExpressModeJob(reportId, {
  includeGeneration: true,
  autoAccept: true,
  reportDepth: "comprehensive"
});
```

### `useCancelJob()`

Annuleer een job.

```typescript
const { cancelJob } = useCancelJob();

const success = await cancelJob(jobId, reportId);
// Invalideert: job, activeJobs, report, allActiveJobs
```

---

## 8. Progress Tracking

### Progress Object Structuur

```typescript
interface JobProgress {
  currentStage: string;      // Huidige stage ID
  percentage: number;        // 0-100%
  message: string;           // "Analyseren bronnen..."
  stages: Array<{
    stageId: string;
    status: "pending" | "processing" | "completed" | "failed";
    percentage: number;
    changesCount?: number;   // Bij review stages
    error?: string;
  }>;
}
```

### Progress Updates

| Event | Percentage |
|-------|------------|
| Job start | 0% |
| Attachments extracted | 25% |
| AI call started | 50% |
| AI call completed | 75% |
| Results saved | 100% |

---

## 9. Conflict Detection

Het systeem voorkomt dubbele jobs:

```typescript
// Single stage: Check voor bestaande job op zelfde stage
const existing = await getJobsForReport(reportId, ["queued", "processing"]);
const conflict = existing.find(j =>
  j.type === "single_stage" &&
  j.result?.stageId === stageId
);
if (conflict) return { jobId: conflict.id }; // Return bestaande

// Express mode: Geen tweede express job toestaan
const hasExpress = existing.find(j => j.type === "express_mode");
if (hasExpress) throw Error("Express mode job al actief");
```

---

## 10. Error Handling

| Scenario | Afhandeling |
|----------|-------------|
| Job crasht tijdens processing | `failJob()` met error message |
| Database connection lost | Retry bij volgende poll cycle |
| Stage timeout | Error captured, job failed |
| User cancels | Status → "failed", message: "cancelled" |
| Slack notificatie faalt | Log warning, job completion doorgaat |

---

## 11. Typische Flow

```
1. User klikt "Run Stage" in UI
   ↓
2. useCreateJob.createStageJob(reportId, stageId)
   ↓
3. POST /api/reports/:id/jobs/stage
   ↓
4. Job created: { status: "queued" }
   ↓
5. Frontend start useJobPolling(jobId)
   ↓
6. JobProcessor.pollForJobs() pakt job op
   ↓
7. processSingleStage() voert AI call uit
   ↓
8. job.progress wordt continu bijgewerkt
   ↓
9. Frontend pollt GET /api/jobs/:id elke 5s
   ↓
10. UI toont realtime voortgang
    ↓
11. Job complete → status: "completed"
    ↓
12. Frontend stopt polling, toont success toast
    ↓
13. React Query invalidateert report cache
    ↓
14. UI refresht met nieuwe stage results
```

---

## 12. Debugging Tips

### Logs Bekijken

```bash
# Job processor logs
grep "JobProcessor" logs/server.log

# Specifieke job
grep "job-uuid-123" logs/server.log
```

### Common Issues

| Probleem | Oorzaak | Oplossing |
|----------|---------|-----------|
| Job blijft "queued" | JobProcessor niet gestart | Check server startup logs |
| Job faalt zonder error | Unhandled exception | Check server logs voor stack trace |
| Polling stopt niet | Frontend component unmount | Check useEffect cleanup |
| Dubbele jobs | Race condition | Conflict detection zou moeten werken |

### Database Queries

```sql
-- Alle actieve jobs
SELECT * FROM jobs WHERE status IN ('queued', 'processing');

-- Jobs voor specifiek rapport
SELECT * FROM jobs WHERE report_id = 'uuid' ORDER BY created_at DESC;

-- Failed jobs laatste uur
SELECT * FROM jobs
WHERE status = 'failed'
  AND created_at > NOW() - INTERVAL '1 hour';
```
