# Version History - Herstel & Verwijder Buttons Analysis

## Executive Summary
The "Herstel" (Restore) and "Verwijder" (Delete) buttons in the version history are partially implemented but have **critical issues**:
- **Restore functionality**: Not implemented at all (commented out TODO)
- **Delete functionality**: Implemented but may have issues with data flow and error handling

---

## 1. Component Rendering: VersionTimeline Component

**File**: `/Users/mgast/Documents/dev2025/portal jdb/client/src/components/report/VersionTimeline.tsx`

### Button Implementation (Lines 155-193)

```tsx
{/* Action buttons */}
<div className="mt-2 flex gap-2">
  {!isCurrent && onRestore && (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 text-xs"
      onClick={(e) => {
        e.stopPropagation();
        onRestore(checkpoint.version);  // ← CALLS PARENT HANDLER
      }}
    >
      <RotateCcw className="h-3 w-3 mr-1" />
      Herstel
    </Button>
  )}
  {onDelete && (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
      onClick={(e) => {
        e.stopPropagation();
        const warningMessage = isCurrent
          ? `⚠️ WAARSCHUWING: Je staat op het punt de HUIDIGE versie te verwijderen!\n\n` +
            `${checkpoint.stageName} (${checkpoint.stageKey}) + alle latere stages worden verwijderd.\n\n` +
            `Weet je het ZEKER?`
          : `Weet je zeker dat je ${checkpoint.stageName} (${checkpoint.stageKey}) wilt verwijderen?\n\n` +
            `Dit verwijdert ook alle latere stages.`;

        const confirmed = window.confirm(warningMessage);
        if (confirmed) {
          onDelete(checkpoint.stageKey);  // ← CALLS PARENT HANDLER
        }
      }}
    >
      <Trash2 className="h-3 w-3 mr-1" />
      Verwijder
    </Button>
  )}
</div>
```

### Key UI Issues:
1. ✅ Restore button only shows when `!isCurrent` (not on current version) - CORRECT
2. ✅ Delete button shows on all versions - CORRECT
3. ✅ Delete has confirmation dialog with different messages for current vs. non-current versions
4. ❌ **Both buttons rely on parent handlers** (`onRestore` and `onDelete` props)

---

## 2. Parent Handler: CaseDetail Component

**File**: `/Users/mgast/Documents/dev2025/portal jdb/client/src/pages/case-detail.tsx`

### Restore Handler (Lines 365-379)

```tsx
const handleVersionRestore = async (version: number) => {
  const checkpoint = versionCheckpoints.find((v: any) => v.version === version);
  if (!checkpoint) return;

  toast({
    title: "Versie Herstellen",
    description: `Versie ${version} (${checkpoint.stageName}) wordt hersteld...`,
  });

  // TODO: Implement version restore API call
  // await apiRequest(`/api/reports/${reportId}/restore-version`, {
  //   method: 'POST',
  //   body: JSON.stringify({ stageKey: checkpoint.stageKey })
  // });
};
```

### CRITICAL ISSUE #1: Restore Not Implemented
- **Lines 374-378**: The actual API call is commented out as TODO
- **What happens**: User clicks button → Toast shows → Nothing happens
- **Expected behavior**: Should call backend `/api/reports/:id/restore-version` endpoint
- **Problem**: This endpoint doesn't exist in the backend either

### Delete Handler (Lines 381-421)

```tsx
const handleVersionDelete = async (stageKey: string) => {
  if (!reportId) return;

  try {
    const response = await apiRequest(
      'DELETE',
      `/api/reports/${reportId}/stage/${stageKey}`
    );

    if (!response.ok) {
      throw new Error('Failed to delete stage');
    }

    const result = await response.json();
    const data = result.success ? result.data : result;
    const cascadeDeleted = data.cascadeDeleted || [];

    const cascadeMessage = cascadeDeleted.length > 0
      ? ` (+ ${cascadeDeleted.length} volgende stages)`
      : '';

    toast({
      title: "Versie Verwijderd",
      description: `${stageKey}${cascadeMessage} is verwijderd en kan nu opnieuw worden uitgevoerd`,
      duration: 3000,
    });

    // DIRECT UPDATE: Set the returned report data immediately in the cache
    // This bypasses HTTP caching (304) and immediately updates the UI
    queryClient.setQueryData([`/api/reports/${reportId}`], data.report);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to delete version:', error);
    toast({
      title: "Fout bij verwijderen",
      description: "Er ging iets mis bij het verwijderen van de versie",
      variant: "destructive",
      duration: 5000,
    });
  }
};
```

### Issues with Delete Handler:

**Issue #1: Incorrect API Request Call**
- Line 385: `apiRequest('DELETE', '/api/reports/${reportId}/stage/${stageKey}')`
- **Problem**: `apiRequest` expects parameters in wrong order and format
- **Current signature**: `apiRequest(method: string, url: string, data?: unknown)`
- **What's being called**: Method='DELETE', URL (correct), no data
- **This is actually CORRECT** - but the real issue is below

**Issue #2: Response Handling Mismatch**
- Lines 390-395: Assumes `result.success` and `result.data.cascadeDeleted`
- But the backend returns: `{ success: true, data: { report, clearedStage, cascadeDeleted }, message }`
- **Current code**: `data = result.success ? result.data : result;`
- **Then**: `cascadeDeleted = data.cascadeDeleted || [];`
- **Problem**: If `result.success === true`, then `data = result.data` (correct), but needs proper extraction

**Issue #3: Cache Update Missing Invalidation**
- Line 410: Only updates cache with returned data
- **Problem**: Doesn't invalidate/refetch other related queries (cases list, etc.)
- **Solution**: Should call `queryClient.invalidateQueries()`

### Component Usage (Lines 631-639)

```tsx
<VersionTimeline
  versions={versionCheckpoints}
  currentVersion={currentVersion}
  onVersionSelect={(version) => {
    console.log('Version selected:', version);
  }}
  onRestore={handleVersionRestore}
  onDelete={handleVersionDelete}
/>
```

---

## 3. Backend API Endpoints

**File**: `/Users/mgast/Documents/dev2025/portal jdb/server/routes.ts`

### Delete Endpoint (Lines 435-522)

```tsx
app.delete("/api/reports/:id/stage/:stage", asyncHandler(async (req: Request, res: Response) => {
  const { id, stage } = req.params;

  const report = await storage.getReport(id);
  if (!report) {
    throw ServerError.notFound("Report");
  }

  // Define stage order for cascading deletes
  const stageOrder = [
    '1_informatiecheck',
    '2_complexiteitscheck',
    '3_generatie',
    '4a_BronnenSpecialist',
    '4b_FiscaalTechnischSpecialist',
    '4c_ScenarioGatenAnalist',
    '4d_DeVertaler',
    '4e_DeAdvocaat',
    '4f_DeKlantpsycholoog'
  ];

  const deletedStageIndex = stageOrder.indexOf(stage);

  // Remove the stage from stageResults
  const currentStageResults = (report.stageResults as Record<string, string>) || {};
  delete currentStageResults[stage];

  // Cascade delete: remove all stages that come after this one
  if (deletedStageIndex >= 0) {
    for (let i = deletedStageIndex + 1; i < stageOrder.length; i++) {
      const laterStage = stageOrder[i];
      delete currentStageResults[laterStage];
    }
  }

  // Also remove from conceptReportVersions
  const currentConceptVersions = (report.conceptReportVersions as Record<string, any>) || {};

  // Delete the stage's snapshot
  delete currentConceptVersions[stage];

  // Delete all later stages' snapshots
  if (deletedStageIndex >= 0) {
    for (let i = deletedStageIndex + 1; i < stageOrder.length; i++) {
      const laterStage = stageOrder[i];
      delete currentConceptVersions[laterStage];
    }
  }

  // Update or remove the 'latest' pointer
  let newLatestStage: string | null = null;
  for (let i = deletedStageIndex - 1; i >= 0; i--) {
    const earlierStage = stageOrder[i];
    if (currentConceptVersions[earlierStage]) {
      newLatestStage = earlierStage;
      break;
    }
  }

  if (newLatestStage && currentConceptVersions[newLatestStage]) {
    currentConceptVersions.latest = {
      pointer: newLatestStage as StageId,
      v: currentConceptVersions[newLatestStage].v || 1
    };
  } else {
    delete currentConceptVersions.latest;
  }

  const updatedReport = await storage.updateReport(id, {
    stageResults: currentStageResults,
    conceptReportVersions: currentConceptVersions,
  });

  if (!updatedReport) {
    throw ServerError.notFound("Updated report not found");
  }

  console.log(`🗑️ Deleted stage ${stage} and all subsequent stages for report ${id}`);

  res.json(createApiSuccessResponse({
    report: updatedReport,
    clearedStage: stage,
    cascadeDeleted: deletedStageIndex >= 0 ? stageOrder.slice(deletedStageIndex + 1) : []
  }, `Stage ${stage} en alle volgende stages zijn verwijderd - workflow kan opnieuw vanaf hier worden uitgevoerd`));
}));
```

### Delete Endpoint Issues:

✅ **Properly implemented** with:
- Cascade delete logic (removes all later stages)
- Updates `latest` pointer correctly
- Returns cascadeDeleted array
- Proper error handling

❌ **Potential Issues**:
1. **Missing from history tracking**: Doesn't add to `history` array if it exists
2. **No timestamp tracking**: Doesn't record when the deletion happened
3. **No validation**: Doesn't check if stage exists before deleting

### Missing: Restore Endpoint

**There is NO restore endpoint implemented!**
- The commented-out code references: `/api/reports/:id/restore-version`
- This endpoint doesn't exist in the backend
- Need to implement:
  ```tsx
  app.post("/api/reports/:id/restore-version", async (req, res) => {
    // Should restore a previous version by:
    // 1. Finding the target stage snapshot
    // 2. Truncating all later stages
    // 3. Setting latest pointer to target stage
    // 4. Updating report content
  });
  ```

---

## 4. API Request Handler Issues

**File**: `/Users/mgast/Documents/dev2025/portal jdb/client/src/lib/queryClient.ts`

### apiRequest Function (Lines 98-162)

```tsx
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  try {
    const headers: Record<string, string> = {};

    // Add Content-Type header if there's data
    if (data) {
      headers["Content-Type"] = "application/json";
    }

    // Add CSRF token for state-changing methods
    const isStateMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
    if (isStateMutation) {
      const token = await getCsrfToken();
      headers['X-CSRF-Token'] = token;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    // If we get a 403 CSRF error, try refreshing the token once
    if (res.status === 403 && isStateMutation) {
      const errorText = await res.clone().text();
      if (errorText.includes('CSRF')) {
        console.log('CSRF token invalid, refreshing...');
        await fetchCsrfToken();
        const token = await getCsrfToken();
        headers['X-CSRF-Token'] = token;

        // Retry the request with new token
        const retryRes = await fetch(url, {
          method,
          headers,
          body: data ? JSON.stringify(data) : undefined,
          credentials: "include",
        });

        await throwIfResNotOk(retryRes);
        return retryRes;
      }
    }

    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    // Als het geen AppError is, converteer het dan
    if (!(error instanceof AppError)) {
      const appError = AppError.network(
        `Request failed: ${method} ${url}`,
        'Er kon geen verbinding worden gemaakt met de server.',
        error instanceof Error ? error : undefined,
        { method, url, data }
      );
      ErrorLogger.logAndThrow(appError);
    }
    throw error;
  }
}
```

### Issues:
✅ **CSRF token handling**: Properly adds CSRF token for DELETE requests
✅ **Error handling**: Throws AppError on failure
❌ **Response type**: Returns Response object, not parsed JSON

---

## 5. Data Flow Analysis

### Delete Flow (What Currently Works)

```
User clicks "Verwijder" button
    ↓
VersionTimeline.onClick → onDelete(stageKey)
    ↓
case-detail.handleVersionDelete(stageKey)
    ↓
apiRequest('DELETE', `/api/reports/${reportId}/stage/${stageKey}`)
    ↓
Backend: DELETE /api/reports/:id/stage/:stage
    ↓
Deletes from stageResults and conceptReportVersions
Updates latest pointer
Cascade deletes later stages
    ↓
Returns: { success: true, data: { report, clearedStage, cascadeDeleted }, message }
    ↓
Frontend: queryClient.setQueryData([...], data.report)
    ↓
UI Updates with new report data
```

**Problem**: Cache not fully invalidated, other queries may be stale

### Restore Flow (NOT IMPLEMENTED)

```
User clicks "Herstel" button
    ↓
VersionTimeline.onClick → onRestore(version)
    ↓
case-detail.handleVersionRestore(version)
    ↓
❌ STOPS HERE - No actual API call
Toast shows "Versie Herstellen..." but nothing happens
```

---

## 6. Summary of Issues

### Critical Issues:
1. ✅ **Restore functionality completely missing** - No backend endpoint, no frontend implementation
2. ✅ **Delete implementation incomplete** - No backend validation that stage exists

### Moderate Issues:
3. ❌ **Cache invalidation** - Delete only updates one query, doesn't invalidate related caches
4. ❌ **No history tracking** - Deletions aren't recorded in history array
5. ❌ **Error messages generic** - Delete error handling doesn't provide specific feedback

### Minor Issues:
6. ❌ **No loading state** - No visual feedback while delete is processing
7. ❌ **No undo capability** - Once deleted, no way to recover except from backup

---

## 7. Recommended Fixes

### Fix #1: Implement Version Restore Backend Endpoint
```tsx
app.post("/api/reports/:id/restore-version", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { stageKey } = req.body;

  const report = await storage.getReport(id);
  if (!report) throw ServerError.notFound("Report");

  const conceptVersions = report.conceptReportVersions as Record<string, any> || {};
  const targetSnapshot = conceptVersions[stageKey];
  
  if (!targetSnapshot) {
    throw ServerError.business(ERROR_CODES.REPORT_NOT_FOUND, `Versie ${stageKey} niet gevonden`);
  }

  // Remove all stages after the target stage
  const stageOrder = ['1_informatiecheck', '2_complexiteitscheck', ...];
  const targetIndex = stageOrder.indexOf(stageKey);
  
  const updatedVersions = { ...conceptVersions };
  delete updatedVersions.history; // Will rebuild
  
  for (let i = targetIndex + 1; i < stageOrder.length; i++) {
    delete updatedVersions[stageOrder[i]];
  }

  updatedVersions.latest = {
    pointer: stageKey as StageId,
    v: targetSnapshot.v
  };

  updatedVersions.history = [
    ...(conceptVersions.history || []),
    { stageId: stageKey, action: 'restore', timestamp: new Date().toISOString() }
  ];

  const updatedReport = await storage.updateReport(id, {
    conceptReportVersions: updatedVersions,
    generatedContent: targetSnapshot.content,
    currentStage: stageKey as StageId
  });

  res.json(createApiSuccessResponse(updatedReport, `Hersteld naar ${stageKey}`));
}));
```

### Fix #2: Implement Version Restore Frontend Handler
```tsx
const handleVersionRestore = async (version: number) => {
  const checkpoint = versionCheckpoints.find((v: any) => v.version === version);
  if (!checkpoint) return;

  try {
    const response = await apiRequest(
      'POST',
      `/api/reports/${reportId}/restore-version`,
      { stageKey: checkpoint.stageKey }
    );

    const result = await response.json();
    queryClient.setQueryData([`/api/reports/${reportId}`], result.data);
    
    toast({
      title: "Versie Hersteld",
      description: `Teruggekeerd naar ${checkpoint.stageName}`,
    });
  } catch (error) {
    toast({
      title: "Fout bij herstellen",
      description: "Kon versie niet herstellen",
      variant: "destructive",
    });
  }
};
```

### Fix #3: Improve Delete Cache Invalidation
```tsx
queryClient.setQueryData([`/api/reports/${reportId}`], data.report);
// Add:
queryClient.invalidateQueries({ queryKey: ["/api/cases"], exact: false });
queryClient.invalidateQueries({ queryKey: [`/api/reports/${reportId}`] });
```

### Fix #4: Add Loading State
```tsx
const deleteVersionMutation = useMutation({
  mutationFn: async (stageKey: string) => {
    const response = await apiRequest(
      'DELETE',
      `/api/reports/${reportId}/stage/${stageKey}`
    );
    return response.json();
  },
  onSuccess: (result) => {
    queryClient.setQueryData([`/api/reports/${reportId}`], result.data.report);
  }
});

// Then use in VersionTimeline component:
<Button
  disabled={deleteVersionMutation.isPending}
  onClick={() => deleteVersionMutation.mutate(stageKey)}
>
  {deleteVersionMutation.isPending ? 'Verwijderen...' : 'Verwijder'}
</Button>
```

---

## File Locations Summary

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| UI Component | `/client/src/components/report/VersionTimeline.tsx` | 155-193 | ✅ Works |
| Parent Handler | `/client/src/pages/case-detail.tsx` | 365-421 | ❌ Incomplete |
| Backend Route | `/server/routes.ts` | 435-522 | ✅ Delete works |
| Backend Route | `/server/routes.ts` | (missing) | ❌ Restore missing |
| API Request | `/client/src/lib/queryClient.ts` | 98-162 | ⚠️ Works but issues |

