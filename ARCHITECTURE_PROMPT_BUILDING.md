# Prompt Building Architecture - Critical Design Decisions

## 🔥 THE PROBLEM WE HAD

### Symptoms
- LLM receiving only 928 characters instead of 40,000+
- "Oké, ik begrijp het..." responses (LLM saw template-like strings)
- Inconsistent prompt formats across stages
- Hard-to-debug double-wrapping issues

### Root Cause
**DUPLICATE PROMPT-BUILDING LOGIC** across multiple classes:

```
❌ BAD (what we had):
┌─────────────────────────────────────────┐
│ THREE different prompt builders:        │
│                                         │
│ 1. PromptBuilder (good)                │
│ 2. ReportProcessor.buildMergePrompt()  │  ← DUPLICATE!
│ 3. Routes.ts ad-hoc building           │  ← INCONSISTENT!
└─────────────────────────────────────────┘
```

##  THE FIX: Single Responsibility Principle

### Design Decision: ONE Source of Truth

**PromptBuilder is THE ONLY class that builds prompts.**

```typescript
✅ CORRECT Architecture:

PromptBuilder              →  Full 40k+ prompt  →  AI
     ↑
     │ (used by)
     │
┌────┴────────────────┐
│  ReportGenerator    │  ← Stages 1-6 (automated)
│  Routes.ts          │  ← Manual feedback processing
└─────────────────────┘
```

### Why This Matters

**Before (WRONG)**:
```typescript
// routes.ts
const prompt = promptBuilder.build(...);  // 40k chars

// Then passes to:
reportProcessor.processStage(reportId, stageId, prompt, strategy);

// Inside processStage:
const newPrompt = buildMergePrompt(prompt);  // ← WRAPS IT AGAIN!
// Result: {baseConcept: 40k_prompt, feedback: "..."} → 928 chars sent to LLM
```

**After (CORRECT)**:
```typescript
// routes.ts
const prompt = promptBuilder.build(...);  // 40k chars

// Passes directly to AI:
reportProcessor.processStageWithPrompt(reportId, stageId, prompt);

// Inside processStageWithPrompt:
const result = await aiHandler.generateContent({ prompt });  // ← SENT AS-IS!
// Result: Full 40k prompt sent to LLM ✅
```

## 📐 THE ROBUST SOLUTION

### 1. PromptBuilder: The Single Source of Truth

**Location**: `server/services/prompt-builder.ts`

**Responsibilities**:
- ✅ Load prompts from database (Settings UI)
- ✅ Format dates consistently
- ✅ Build system prompts
- ✅ Extract stage-specific data
- ✅ Combine everything into final prompt

**Methods**:
```typescript
class PromptBuilder {
  // Core method - builds ANY stage prompt
  build<TData>(
    stageName: string,
    stageConfig: StagePromptConfig,
    dataExtractor: () => TData
  ): { systemPrompt: string; userInput: string }

  // Data extractors for each stage
  buildInformatieCheckData(dossier): string
  buildComplexiteitsCheckData(previousResults): string
  buildGeneratieData(previousResults): string
  buildReviewerData(concept, dossier, bouwplan): string  // ← CRITICAL for 4a-4f
  buildEditorData(feedback, concept): string
  buildChangeSummaryData(versions): string
}
```

### 2. ReportProcessor: Versioning ONLY

**Location**: `server/services/report-processor.ts`

**Responsibilities**:
- ✅ Call AI with pre-built prompts
- ✅ Create concept report snapshots
- ✅ Manage version history
- ✅ Update database
- ❌ ~~Build prompts~~ ← NOT ITS JOB!

**Methods**:
```typescript
class ReportProcessor {
  // ✅ NEW: For manually-built prompts (from PromptBuilder)
  async processStageWithPrompt(
    reportId: string,
    stageId: StageId,
    preBuiltPrompt: string,  // ← Already 40k+ chars from PromptBuilder
    feedbackForTracking: any
  ): Promise<{ newConcept, snapshot, updatedVersions }>

  // ❌ DEPRECATED: Legacy method with internal prompt building
  async processStage(
    reportId: string,
    stageId: StageId,
    feedback: string,
    strategy: string
  ): Promise<...>  // ← Only for backward compat (tests)
}
```

### 3. Routes.ts: Orchestration

**Location**: `server/routes.ts`

**Responsibilities**:
- ✅ Parse request data
- ✅ Call PromptBuilder to build prompts
- ✅ Call ReportProcessor with pre-built prompts
- ✅ Return results to client
- ❌ ~~Build prompts inline~~ ← Use PromptBuilder!

**Example**:
```typescript
// ✅ CORRECT: Manual feedback processing
app.post("/api/reports/:id/stage/:stageId/process-feedback", async (req, res) => {
  // 1. Get data
  const { filteredChanges } = req.body;
  const latestConcept = await getLatestConcept(reportId);

  // 2. Build prompt using PromptBuilder (THE ONLY PLACE)
  const promptBuilder = new PromptBuilder();
  const { systemPrompt, userInput } = promptBuilder.build(
    'editor',
    editorConfig,
    () => ({
      BASISTEKST: latestConcept,      // 41,215 chars
      WIJZIGINGEN_JSON: filteredChanges  // Accepted proposals
    })
  );

  const combinedPrompt = `${systemPrompt}\n\n### USER INPUT:\n${userInput}`;
  // ↑ Full prompt is now 42,000+ characters

  // 3. Process with ReportProcessor (NO PROMPT BUILDING INSIDE!)
  const result = await reportProcessor.processStageWithPrompt(
    reportId,
    stageId,
    combinedPrompt,  // ← Sent AS-IS to LLM (no re-wrapping!)
    filteredChanges  // Only for audit trail
  );

  return res.json({ success: true, newVersion: result.snapshot.v });
});
```

## 🚨 WHAT NOT TO DO

### Anti-Pattern 1: Building Prompts in Multiple Places
```typescript
❌ WRONG:
// In ReportProcessor
private buildPrompt() {
  const config = await getPromptConfig();
  return config.prompt
    .replace('{baseConcept}', baseConcept)
    .replace('{feedback}', feedback);
}

// In Routes
const prompt = buildSomePrompt();

// Result: Inconsistent, hard to maintain, causes bugs
```

### Anti-Pattern 2: Passing Prompts as "Feedback"
```typescript
❌ WRONG:
const fullPrompt = buildPrompt();  // 40k chars

// This method expects "feedback" but we're passing a prompt!
await processor.processStage(reportId, stageId, fullPrompt, 'merge');
// ↑ Inside processStage, it wraps fullPrompt AGAIN as {feedback}

// Result: Double-wrapping → truncation → LLM sees garbage
```

### Anti-Pattern 3: Ad-hoc Prompt String Concatenation
```typescript
❌ WRONG:
const prompt = `
  ${stageConfig.prompt}

  ### Datum: ${new Date().toLocaleDateString()}

  ${JSON.stringify(data)}
`;

// Result: Formatting inconsistencies, hard to test, no reusability
```

## ✅ THE CORRECT PATTERN

### For ANY New Feature That Needs AI

```typescript
// Step 1: Add data extractor to PromptBuilder (if needed)
class PromptBuilder {
  buildMyNewFeatureData(input: MyFeatureInput): string {
    return JSON.stringify({
      field1: input.field1,
      field2: input.field2
    }, null, 2);
  }
}

// Step 2: In your route/service
const promptBuilder = new PromptBuilder();
const { systemPrompt, userInput } = promptBuilder.build(
  'my_feature_stage',
  stageConfig,
  () => promptBuilder.buildMyNewFeatureData(myInput)
);

const combinedPrompt = `${systemPrompt}\n\n### USER INPUT:\n${userInput}`;

// Step 3: Use processStageWithPrompt (NOT processStage)
const result = await reportProcessor.processStageWithPrompt(
  reportId,
  stageId,
  combinedPrompt,
  myInput  // For tracking only
);
```

## 🔍 HOW TO DETECT THIS ISSUE

### Red Flags to Watch For:

1. **Short prompt lengths in logs**:
   ```
   promptLength: 928  ← Should be 40,000+!
   ```

2. **LLM gives meta-responses**:
   ```
   "Oké, ik begrijp het..." ← Saw template, not actual data
   ```

3. **Multiple places fetching prompt config**:
   ```typescript
   ❌ const config = await getActivePromptConfig();  // In 3+ files
   ```

4. **String replacement in multiple files**:
   ```typescript
   ❌ .replace('{baseConcept}', ...)  // Duplicated logic
   ```

### How to Verify Fix:

```typescript
// Add logging to see actual prompt
console.log('📝 Prompt being sent:', {
  systemPromptLength: systemPrompt.length,
  userInputLength: userInput.length,
  combinedPromptLength: combinedPrompt.length,
  preview: combinedPrompt.substring(0, 200)
});

// Should see:
// systemPromptLength: 500-1000
// userInputLength: 40,000+
// combinedPromptLength: 41,000+
```

## 🎯 KEY TAKEAWAYS

1. **PromptBuilder** = The ONLY place that builds prompts
2. **ReportProcessor** = Handles versioning, NOT prompt building
3. **Routes** = Orchestrates, uses PromptBuilder, passes to ReportProcessor
4. Use `processStageWithPrompt()` for manual feedback (NOT `processStage()`)
5. Always log prompt lengths to catch truncation bugs early
6. Never pass a full prompt as "feedback" parameter
7. If you see duplicate prompt-building logic → REFACTOR IMMEDIATELY

## 📚 Related Files

- `server/services/prompt-builder.ts` - The single source of truth
- `server/services/report-processor.ts` - Versioning and AI calls
- `server/services/report-generator.ts` - Uses PromptBuilder correctly
- `server/routes.ts` - Manual feedback processing
- `server/storage.ts` - Prompt config storage (database)

## 🔄 Migration Checklist

If you find code using the OLD pattern:

- [ ] Check if it calls `reportProcessor.processStage()` with a pre-built prompt
- [ ] Check if it builds prompts outside PromptBuilder
- [ ] Refactor to use PromptBuilder
- [ ] Change to `processStageWithPrompt()` instead
- [ ] Add logging to verify full prompt is sent
- [ ] Test with real data (40k+ chars)
- [ ] Remove any duplicate prompt-building logic

---

**Last Updated**: 2025-11-17
**Authors**: Senior Architecture Review
**Status**: ✅ Implemented and Documented
