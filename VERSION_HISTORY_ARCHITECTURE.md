# Version History - Architecture & Data Flow Diagram

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI LAYER (React)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  VersionTimeline Component                                       │
│  /client/src/components/report/VersionTimeline.tsx             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Renders list of version checkpoints                       │   │
│  │ ┌────────────────────────────────────────────────────┐   │   │
│  │ │ For each version:                                   │   │   │
│  │ │  - Shows version info (stage name, timestamp)      │   │   │
│  │ │  - Renders "Herstel" button (if !isCurrent)        │   │   │
│  │ │  - Renders "Verwijder" button (always)             │   │   │
│  │ │    └─ With confirmation dialog                     │   │   │
│  │ └────────────────────────────────────────────────────┘   │   │
│  │                                                             │   │
│  │ Props: onRestore(), onDelete()                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│           │                                │                      │
│           ▼                                ▼                      │
│   onRestore(version)         onDelete(stageKey)                  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ CaseDetail Component Handler Layer                         │   │
│  │ /client/src/pages/case-detail.tsx                         │   │
│  │                                                             │   │
│  │ handleVersionRestore(version)                              │   │
│  │   ├─ Finds checkpoint by version                           │   │
│  │   ├─ Shows toast "Versie Herstellen..."                   │   │
│  │   └─ ❌ STOPS HERE (TODO - no API call)                   │   │
│  │                                                             │   │
│  │ handleVersionDelete(stageKey)                              │   │
│  │   ├─ Calls apiRequest('DELETE', `/api/reports/:id/...`)  │   │
│  │   ├─ Waits for response                                    │   │
│  │   ├─ Updates queryClient cache                             │   │
│  │   ├─ Shows success toast                                   │   │
│  │   └─ ❌ Missing: queryClient.invalidateQueries()          │   │
│  └──────────────────────────────────────────────────────────┘   │
│           │                                │                      │
│           ▼                                ▼                      │
│  API Request Layer (Missing)    API Request Layer (Works)         │
│  (endpoint doesn't exist)        (has cache issue)                │
└─────────────────────────────────────────────────────────────────┘
                │                                │
                ▼                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   HTTP LAYER (fetch/network)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│ apiRequest(method, url, data)                                   │
│ /client/src/lib/queryClient.ts                                  │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ - Fetches CSRF token                                      │   │
│ │ - Adds CSRF header (X-CSRF-Token)                        │   │
│ │ - Makes fetch request with credentials                    │   │
│ │ - Returns Response object (not parsed)                    │   │
│ │ - Handles 403 CSRF errors with retry                      │   │
│ └──────────────────────────────────────────────────────────┘   │
│           │                                │                      │
│           ▼                                ▼                      │
│  POST /api/reports/:id/restore-version   DELETE /api/reports/:id/stage/:stage
│  (MISSING ENDPOINT)                       (IMPLEMENTED)          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                │                                │
                ▼                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND LAYER (Express)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│ /server/routes.ts                                                │
│                                                                   │
│ ❌ app.post("/api/reports/:id/restore-version")                │
│     NOT IMPLEMENTED                                              │
│     Should:                                                      │
│     - Validate request body { stageKey }                        │
│     - Get report from database                                  │
│     - Find target stage snapshot                                │
│     - Delete all later stage snapshots                          │
│     - Update latest pointer                                     │
│     - Return updated report                                     │
│                                                                   │
│ ✅ app.delete("/api/reports/:id/stage/:stage")                 │
│    (Lines 435-522)                                              │
│    ┌──────────────────────────────────────────────────────┐   │
│    │ Validates request params                              │   │
│    │ Loads report from database                            │   │
│    │ Removes stage from stageResults                        │   │
│    │ Removes stage from conceptReportVersions              │   │
│    │ Cascade deletes all later stages                       │   │
│    │ Updates latest pointer to previous stage               │   │
│    │ ❌ Doesn't add to history array                       │   │
│    │ ❌ Doesn't add timestamp                              │   │
│    │ Returns updated report + cascadeDeleted array         │   │
│    └──────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                │
                ▼
        ┌───────────────────┐
        │   Database        │
        │ (Report storage)  │
        └───────────────────┘
```

---

## Restore Flow - Current (BROKEN)

```
┌─────────────────────────────────────────────────────────────────┐
│ User clicks "Herstel" button on previous version                │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────┐
        │ VersionTimeline.onClick           │
        │ - Stop propagation                │
        │ - Call: onRestore(version)        │
        └──────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────┐
        │ CaseDetail.handleVersionRestore   │
        │ - Find checkpoint by version      │
        │ - Show toast:                     │
        │   "Versie Herstellen..."          │
        └──────────────────────────────────┘
                           │
                           ▼
                  ❌ EXECUTION STOPS
        
        User sees toast but nothing happens
        Version is NOT restored
        Later stages are NOT removed
```

---

## Restore Flow - Fixed (WHAT SHOULD HAPPEN)

```
┌─────────────────────────────────────────────────────────────────┐
│ User clicks "Herstel" button on previous version                │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────┐
        │ VersionTimeline.onClick           │
        │ - Stop propagation                │
        │ - Call: onRestore(version)        │
        └──────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────────────────────────┐
        │ CaseDetail.handleVersionRestore                           │
        │ - Find checkpoint by version                              │
        │ - Call API:                                               │
        │   apiRequest('POST',                                      │
        │     `/api/reports/:id/restore-version`,                  │
        │     { stageKey: checkpoint.stageKey }                    │
        │   )                                                        │
        └──────────────────────────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────┐
        │ Backend: POST /api/reports/:id... │
        │ - Load report                     │
        │ - Find target stage snapshot      │
        │ - Delete all later snapshots      │
        │ - Update latest pointer           │
        │ - Save to database                │
        │ - Return updated report           │
        └──────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────┐
        │ Frontend receives response        │
        │ - Parse JSON                      │
        │ - Update cache with new report    │
        │ - Show success toast              │
        │ - UI re-renders with changes      │
        └──────────────────────────────────┘
                           │
                           ▼
        ✅ Success: Version is restored
           Later stages are removed
           UI shows updated state
```

---

## Delete Flow - Current (PARTIAL)

```
┌─────────────────────────────────────────────────────────────────┐
│ User clicks "Verwijder" button                                  │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────────────────────────┐
        │ VersionTimeline.onClick                                   │
        │ - Stop propagation                                        │
        │ - Show confirmation dialog:                               │
        │   "Weet je zeker dat je ... wilt verwijderen?"           │
        └──────────────────────────────────────────────────────────┘
                           │
                   User confirms
                           │
                           ▼
        ┌──────────────────────────────────────────────────────────┐
        │ CaseDetail.handleVersionDelete(stageKey)                 │
        │ - Call API:                                               │
        │   apiRequest('DELETE',                                    │
        │     `/api/reports/:id/stage/:stageKey`                   │
        │   )                                                        │
        └──────────────────────────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────────────────────────┐
        │ Backend: DELETE /api/reports/:id/stage/:stage            │
        │ - Load report                                             │
        │ - Remove stage from stageResults                          │
        │ - Remove stage from conceptReportVersions                │
        │ - Cascade delete all later stages                         │
        │ - Update latest pointer                                   │
        │ - Save to database                                        │
        │ - Return: { success: true, data: { report, ... } }      │
        └──────────────────────────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────────────────────────┐
        │ Frontend receives response                                │
        │ - Parse JSON                                              │
        │ - Extract: result.data (the report)                      │
        │ - Update cache: queryClient.setQueryData(...)            │
        │ - Show success toast with cascadeDeleted info            │
        │ - UI re-renders with new data                            │
        └──────────────────────────────────────────────────────────┘
                           │
                           ▼
        ⚠️  Partial Success: 
            - Current report is updated ✅
            - Version timeline shows changes ✅
            - Cases list is NOT updated ❌
            - Other queries may be stale ❌
```

---

## Delete Flow - Improved (WITH CACHE FIX)

```
        [All steps same as above until...]
                           │
                           ▼
        ┌──────────────────────────────────────────────────────────┐
        │ Frontend receives response                                │
        │ - Parse JSON                                              │
        │ - Extract: result.data (the report)                      │
        │ - Update cache: queryClient.setQueryData(...)       ✅   │
        │ - Invalidate related queries:                       ✅   │
        │     queryClient.invalidateQueries(                        │
        │       { queryKey: ["/api/cases"], exact: false }         │
        │     )                                                      │
        │ - Show success toast with cascadeDeleted info            │
        │ - UI re-renders with new data                            │
        └──────────────────────────────────────────────────────────┘
                           │
                           ▼
        ✅ Full Success: 
            - Current report is updated ✅
            - Version timeline shows changes ✅
            - Cases list is updated ✅
            - All related queries are fresh ✅
```

---

## Data Structure: conceptReportVersions

```typescript
// What gets stored in database:
report.conceptReportVersions = {
  // Stage snapshots
  "1_informatiecheck": {
    v: 1,
    content: "...",
    timestamp: "2024-11-15T10:00:00Z"
  },
  "2_complexiteitscheck": {
    v: 1,
    content: "...",
    timestamp: "2024-11-15T10:05:00Z"
  },
  "3_generatie": {
    v: 1,
    content: "...",
    timestamp: "2024-11-15T10:10:00Z"
  },
  
  // Latest pointer (which stage is current)
  "latest": {
    pointer: "3_generatie",  // Points to current stage
    v: 1
  },
  
  // History of changes (optional)
  "history": [
    {
      stageId: "1_informatiecheck",
      v: 1,
      timestamp: "2024-11-15T10:00:00Z",
      action: "create"
    },
    {
      stageId: "2_complexiteitscheck",
      v: 1,
      timestamp: "2024-11-15T10:05:00Z",
      action: "create"
    },
    {
      stageId: "3_generatie",
      v: 1,
      timestamp: "2024-11-15T10:10:00Z",
      action: "create"
    }
  ]
}

// When user DELETES "2_complexiteitscheck":
// DELETE removes both "2_complexiteitscheck" and all later stages
// Latest pointer moves to "1_informatiecheck" (the previous stage)

conceptReportVersions = {
  "1_informatiecheck": { ... },
  "latest": {
    pointer: "1_informatiecheck",
    v: 1
  },
  "history": [
    { ... },
    { ... },
    {
      stageId: "2_complexiteitscheck",
      action: "delete",
      timestamp: "2024-11-15T10:30:00Z"
    }
  ]
}

// When user RESTORES to "2_complexiteitscheck":
// RESTORE should restore that snapshot as latest
// Should still delete all stages that came after it
conceptReportVersions = {
  "1_informatiecheck": { ... },
  "2_complexiteitscheck": { ... },
  "latest": {
    pointer: "2_complexiteitscheck",
    v: 1
  },
  "history": [
    { ... },
    { ... },
    { action: "delete", ... },
    {
      stageId: "2_complexiteitscheck",
      action: "restore",
      timestamp: "2024-11-15T10:35:00Z"
    }
  ]
}
```

---

## Response Format from Backend

```typescript
// DELETE /api/reports/:id/stage/:stage returns:
{
  "success": true,
  "data": {
    "report": {
      "id": "...",
      "title": "...",
      "clientName": "...",
      "conceptReportVersions": { ... },
      "stageResults": { ... },
      "generatedContent": "...",
      // ... other fields
    },
    "clearedStage": "3_generatie",
    "cascadeDeleted": ["4a_BronnenSpecialist", "4b_FiscaalTechnischSpecialist"]
  },
  "message": "Stage 3_generatie en alle volgende stages zijn verwijderd..."
}
```

---

## Cache Keys Used

```typescript
// From /client/src/lib/queryClient.ts and api.ts

API_KEYS = {
  cases: (filters?: Record<string, any>) => ["cases", filters],
  case: (id: string) => ["cases", id],
  reports: (filters?: Record<string, any>) => ["reports", filters],
  report: (id: string) => ["reports", id],
}

// When delete happens on case detail page:
queryClient.setQueryData([`/api/reports/${reportId}`], data.report);

// This updates the cache for the current page
// But doesn't invalidate the cases list cache
// So the cases page (if still open) may show stale data

// Need to also do:
queryClient.invalidateQueries({ queryKey: ["/api/cases"], exact: false });
// OR
queryClient.invalidateQueries({ queryKey: ["cases"], exact: false });
```

---

## Summary of Changes Needed

| Component | File | Current | Needed | Priority |
|-----------|------|---------|--------|----------|
| UI | VersionTimeline.tsx | ✅ Works | No change | - |
| Frontend Handler | case-detail.tsx | ❌ TODO only | Implement API call | 🔴 CRITICAL |
| Backend Restore | routes.ts | ❌ Missing | Add new endpoint | 🔴 CRITICAL |
| Frontend Delete | case-detail.tsx | ⚠️ Partial | Add cache invalidation | 🟡 HIGH |
| Backend Delete | routes.ts | ✅ Works | Minor: add history | 🟢 LOW |

