# Quick Reference: Version History Buttons Issue

## What's Working vs What's Broken

### RESTORE Button Status: BROKEN
Location: `/client/src/components/report/VersionTimeline.tsx` (line 156-169)

Frontend Implementation:
- Shows when NOT current version ✅
- Passes click to parent handler ✅
- **BUT**: Parent handler only shows toast, no actual work

Parent Handler: `/client/src/pages/case-detail.tsx` (line 365-379)
```
handleVersionRestore() {
  toast("Versie Herstellen...")  ← Shows message
  // TODO: API call commented out ← ACTUAL WORK MISSING
}
```

Backend Endpoint: DOES NOT EXIST
- No `/api/reports/:id/restore-version` endpoint
- Need to create this

### DELETE Button Status: PARTIALLY WORKING
Location: `/client/src/components/report/VersionTimeline.tsx` (line 170-193)

Frontend Implementation:
- Shows on all versions ✅
- Has confirmation dialog ✅
- Calls parent handler ✅

Parent Handler: `/client/src/pages/case-detail.tsx` (line 381-421)
```
handleVersionDelete() {
  API call: DELETE /api/reports/:id/stage/:stageKey ✅
  Updates cache ✅
  Shows success toast ✅
  ERROR: Doesn't invalidate other queries ✅ ISSUES
}
```

Backend Endpoint: IMPLEMENTED ✅
- `/api/reports/:id/stage/:stage` (DELETE)
- File: `/server/routes.ts` (line 435-522)
- Cascade deletes all later stages ✅
- Returns updated report ✅

---

## The 2 Critical Fixes Needed

### Fix 1: Implement Restore (Frontend + Backend)

**Frontend Change** - `/client/src/pages/case-detail.tsx` line 374-378:
```javascript
// BEFORE (BROKEN):
// TODO: Implement version restore API call
// await apiRequest(`/api/reports/${reportId}/restore-version`, {

// AFTER (FIXED):
const response = await apiRequest(
  'POST',
  `/api/reports/${reportId}/restore-version`,
  { stageKey: checkpoint.stageKey }
);
const result = await response.json();
queryClient.setQueryData([`/api/reports/${reportId}`], result.data);
```

**Backend Addition** - `/server/routes.ts` (add new endpoint):
```typescript
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

  // Remove all stages after the target
  const stageOrder = ['1_informatiecheck', '2_complexiteitscheck', '3_generatie', ...];
  const targetIndex = stageOrder.indexOf(stageKey);
  
  const updatedVersions = { ...conceptVersions };
  
  // Delete all later stages
  for (let i = targetIndex + 1; i < stageOrder.length; i++) {
    delete updatedVersions[stageOrder[i]];
  }

  // Update latest pointer to restored version
  updatedVersions.latest = {
    pointer: stageKey as StageId,
    v: targetSnapshot.v
  };

  // Add to history if it exists
  if (Array.isArray(updatedVersions.history)) {
    updatedVersions.history.push({
      stageId: stageKey,
      action: 'restore',
      timestamp: new Date().toISOString()
    });
  }

  const updatedReport = await storage.updateReport(id, {
    conceptReportVersions: updatedVersions,
    generatedContent: targetSnapshot.content,
    currentStage: stageKey as StageId
  });

  res.json(createApiSuccessResponse(updatedReport, `Hersteld naar ${stageKey}`));
}));
```

### Fix 2: Improve Delete Cache Invalidation

**Frontend Change** - `/client/src/pages/case-detail.tsx` line 410:
```javascript
// BEFORE (INCOMPLETE):
queryClient.setQueryData([`/api/reports/${reportId}`], data.report);

// AFTER (IMPROVED):
queryClient.setQueryData([`/api/reports/${reportId}`], data.report);
queryClient.invalidateQueries({ queryKey: ["/api/cases"], exact: false });
```

---

## Files Involved

| File Path | Purpose | Issue |
|-----------|---------|-------|
| `/client/src/components/report/VersionTimeline.tsx` | Render buttons | None - works fine |
| `/client/src/pages/case-detail.tsx` | Handle button clicks | Restore: TODO only, Delete: cache issue |
| `/server/routes.ts` | API endpoints | Delete: works, Restore: missing |
| `/client/src/lib/queryClient.ts` | HTTP requests | None - CSRF handling works |

---

## Testing the Fixes

### After Fix #1 (Restore):
1. Open case detail
2. Go to Timeline tab
3. Click "Herstel" on any previous version (not current)
4. Should see: success toast + UI updates to show that stage as current + all later stages removed

### After Fix #2 (Delete):
1. Open case detail  
2. Go to Timeline tab
3. Click "Verwijder" on any version
4. Confirm deletion
5. Should see: success toast + cascade deleted message + cases list also updates

---

## Root Cause Summary

- **Restore**: Developer left TODO comment and never implemented backend endpoint
- **Delete**: Works for current page, but doesn't invalidate related cache queries (cases list, etc.)

Both are fixable in 30 minutes of coding.
