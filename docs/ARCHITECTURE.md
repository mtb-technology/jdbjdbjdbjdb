# Portal JDB - AI Architectuur

> Dit document is bedoeld voor nieuwe developers die de AI-configuratie architectuur moeten begrijpen.

## Quick Start (5 min)

De AI-configuratie heeft **3 lagen**. Dit is het belangrijkste concept om te begrijpen:

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: Model Capabilities                                    │
│  Bestand: server/config/index.ts (AI_MODELS)                   │
│  Vraag: "Wat KAN dit model?"                                   │
│  → Statisch, bepaald door de AI provider                        │
│  → Voorbeeld: gemini-2.5-pro heeft max 65k output tokens        │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2: Stage/Operation Config                                │
│  Bron: Database tabel `prompt_configs`                          │
│  Vraag: "Welke settings voor DEZE stage/operatie?"             │
│  → Dynamisch, configureerbaar via Settings UI                   │
│  → Voorbeeld: Stage 3 gebruikt temperature 0.5                  │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3: Merged Runtime Config                                 │
│  Bestand: server/services/ai-config-resolver.ts                │
│  Vraag: "Wat is de FINALE config voor deze request?"           │
│  → Computed at runtime: Layer 2 merged met Layer 1 limits       │
│  → Output: AiConfig object dat naar de handler gaat             │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow: Van Request tot AI Response

```
1. API Request
   POST /api/reports/:id/execute-stage
   │
   ▼
2. ReportGenerator.executeStage()
   Bestand: server/services/report-generator.ts
   │
   ├──► Fetch report from database
   ├──► Fetch active PromptConfig from database (Layer 2)
   │
   ▼
3. AIConfigResolver.resolveForStage()
   Bestand: server/services/ai-config-resolver.ts
   │
   ├──► Merge stage config met global config
   ├──► Infer provider van model naam (google/openai)
   ├──► Apply provider token limits (Layer 1)
   ├──► Auto-enable features (deep research voor gemini-3)
   │
   ▼
4. PromptBuilder.build()
   Bestand: server/services/prompt-builder.ts
   │
   ├──► Build systemPrompt (instructies + metadata)
   ├──► Build userInput (dossier data als JSON)
   │
   ▼
5. AIModelFactory.callModel()
   Bestand: server/services/ai-models/ai-model-factory.ts
   │
   ├──► Lookup handler type van model (Layer 1)
   ├──► Get handler instance (google/openai-standard/etc)
   ├──► Check circuit breaker
   ├──► Call handler.call()
   │
   ▼
6. Handler (Google/OpenAI)
   Bestand: server/services/ai-models/{google,openai-*}-handler.ts
   │
   ├──► BaseAIHandler.call() - retry logic, monitoring
   ├──► callInternal() - provider-specific API call
   │
   ▼
7. AI Provider Response
   │
   ▼
8. Response terug naar ReportGenerator
   │
   ├──► Store result in database
   ├──► Update report status
   └──► Stream progress via SSE
```

## File Map: Welke File Doet Wat?

### Configuratie

| File | Verantwoordelijkheid |
|------|---------------------|
| `server/config/index.ts` | **Layer 1** - AI_MODELS definities, database config, timeouts |
| `server/config/constants.ts` | Retry/circuit breaker settings, cache TTLs, rate limits |
| `shared/constants.ts` | Stage namen, STAGE_ORDER, stage-gerelateerde timeouts |
| `shared/schema.ts` | Database schema (Drizzle), Zod validatie schemas |

### AI Services

| File | Verantwoordelijkheid |
|------|---------------------|
| `server/services/ai-config-resolver.ts` | **Layer 3** - Merged runtime config voor elke AI call |
| `server/services/ai-models/ai-model-factory.ts` | Handler routing, circuit breaker, model registry |
| `server/services/ai-models/base-handler.ts` | Retry logic, monitoring, shared handler behavior |
| `server/services/ai-models/google-handler.ts` | Google Gemini API calls, grounding, deep research |
| `server/services/ai-models/openai-*.ts` | OpenAI handlers (standard, reasoning, gpt5) |

### Orchestration

| File | Verantwoordelijkheid |
|------|---------------------|
| `server/services/report-generator.ts` | Stage workflow orchestration |
| `server/services/prompt-builder.ts` | Prompt constructie (system + user input) |
| `server/routes/report-routes.ts` | API endpoints voor rapport operaties |
| `server/routes/streaming-routes.ts` | SSE voor real-time progress |

## Glossary: Wat Betekent Wat?

### Config Termen (BELANGRIJK - vaak verward!)

| Term | Betekenis | Waar te vinden |
|------|-----------|----------------|
| `AI_MODELS` | Statische model capabilities (Layer 1) | `server/config/index.ts` |
| `AiConfig` | Runtime config voor één AI call (Layer 3 output) | `shared/schema.ts` |
| `stageConfig` | Per-stage overrides uit database (Layer 2) | `prompt_configs` tabel |
| `globalConfig` | Fallback config als stage geen override heeft | `prompt_configs` tabel |
| `ModelInfo` | Metadata over een model in de factory | `ai-model-factory.ts` |

### Handler Types

| Type | Models | Beschrijving |
|------|--------|--------------|
| `google` | gemini-2.5-*, gemini-3-* | Google Gemini API, ondersteunt grounding |
| `openai-standard` | gpt-4o, gpt-4o-mini | Standaard OpenAI Chat Completions |
| `openai-reasoning` | o3, o3-mini | OpenAI reasoning models |
| `openai-gpt5` | gpt-5 | GPT-5 met Responses API |

### Workflow Termen

| Term | Betekenis |
|------|-----------|
| Stage | Eén stap in de rapport workflow (1_informatiecheck, 3_generatie, etc.) |
| Operation | Niet-stage AI call (testAI, followUpAssistant, box3Validator) |
| Substep | Review feedback binnen een stage |
| Deep Research | Multi-query research workflow (alleen gemini-3-pro-preview) |

## How-To's

### Een Nieuw AI Model Toevoegen

1. **Layer 1**: Voeg model toe aan `AI_MODELS` in `server/config/index.ts`:
   ```typescript
   'nieuw-model': {
     provider: 'google' | 'openai',
     handlerType: 'google' | 'openai-standard' | ...,
     supportedParameters: ['temperature', 'maxOutputTokens', ...],
     timeout: 300000,
     defaultConfig: { temperature: 0.1, ... },
     limits: { maxTokensPerRequest: 8192, maxRequestsPerMinute: 100 }
   }
   ```

2. Als nieuwe handler nodig: maak `server/services/ai-models/nieuw-handler.ts`

3. Registreer handler in `AIModelFactory.initializeHandlers()`

### Stage Configuratie Wijzigen

Via de Settings UI (prompt_configs tabel):
- Global config: fallback voor alle stages
- Per-stage override: specifieke settings voor één stage

**Let op**: Wijzigingen in de database overschrijven NIET de hardcoded `REPORT_CONFIG` in `server/config/index.ts`. Deze zijn alleen voor model selection en timeouts.

### Timeout Aanpassen

**AI Operation Timeouts**: `server/config/constants.ts`
```typescript
TIMEOUTS.AI_REQUEST      // 2 min - standaard
TIMEOUTS.AI_GROUNDING    // 10 min - grounding requests
TIMEOUTS.AI_REASONING    // 10 min - o3/o4 models
```

**Stage Timeouts**: `server/config/index.ts` → `REPORT_CONFIG.stages`
```typescript
'3_generatie': { timeout: 600000 }  // 10 min voor rapport generatie
```

## AI Config Resolution: Deep Dive

> Dit is het meest verwarrende deel van de codebase. Hier is hoe het ECHT werkt.

### Het Probleem

Je hebt een AI call nodig voor Stage 3. Welke config wordt gebruikt?

```
Optie A: AI_MODELS['gemini-2.5-pro'].defaultConfig        (Layer 1)
Optie B: promptConfig['3_generatie'].aiConfig             (Layer 2 - stage)
Optie C: promptConfig.aiConfig                            (Layer 2 - global)
```

### De Oplossing: Merge Strategie

```typescript
// Pseudo-code van AIConfigResolver.resolveForStage():

function resolveForStage(stageName, stageConfig, globalConfig) {
  // 1. Start met stage-specifieke config (hoogste prioriteit)
  const stageAiConfig = stageConfig?.aiConfig;

  // 2. Fallback naar global config
  const globalAiConfig = globalConfig?.aiConfig;

  // 3. Merge: stage values override global values
  const baseConfig = {
    ...globalAiConfig,  // Base: global defaults
    ...stageAiConfig,   // Override: stage-specific
  };

  // 4. Infer provider van model naam
  if (!baseConfig.provider) {
    baseConfig.provider = inferProvider(baseConfig.model);
  }

  // 5. Apply provider token limits (Layer 1)
  const modelInfo = AI_MODELS[baseConfig.model];
  if (baseConfig.maxOutputTokens > modelInfo.limits.maxTokensPerRequest) {
    baseConfig.maxOutputTokens = modelInfo.limits.maxTokensPerRequest;
  }

  return baseConfig;
}
```

### Precedence Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                    PRIORITEIT (hoog → laag)                    │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  1. stageConfig.aiConfig.temperature = 0.8                     │
│     ↓ (als niet gezet, fallback naar:)                         │
│                                                                │
│  2. globalConfig.aiConfig.temperature = 0.5                    │
│     ↓ (als niet gezet, fallback naar:)                         │
│                                                                │
│  3. AI_MODELS[model].defaultConfig.temperature = 0.1           │
│     ↓ (als niet gezet, fallback naar:)                         │
│                                                                │
│  4. Zod schema default (shared/schema.ts)                      │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Voorbeeld: "Waarom is mijn temperature 0.5?"

```typescript
// Database prompt_config:
{
  "3_generatie": {
    "prompt": "...",
    "aiConfig": {
      "model": "gemini-2.5-pro"
      // NOTE: temperature NIET gezet!
    }
  },
  "aiConfig": {  // Global
    "provider": "google",
    "model": "gemini-2.5-pro",
    "temperature": 0.5  // ← Dit wordt gebruikt
  }
}

// Resultaat na resolve:
// temperature = 0.5 (van global, want stage heeft het niet)
```

### Special Cases

| Scenario | Gedrag |
|----------|--------|
| Stage 3 met `gemini-3-pro-preview` | Auto-enable `useDeepResearch: true` |
| `maxOutputTokens > model limit` | Silently capped naar model limit |
| OpenAI model met `useGrounding: true` | Validation error (grounding = Google only) |
| Geen `provider` in config | Inferred van model naam |

### Debug Checklist

Als je config niet werkt zoals verwacht:

1. **Check database**: Wat staat er in `prompt_configs` voor deze stage?
2. **Check global**: Wat is de global `aiConfig` fallback?
3. **Check logs**: `[resolveForStage]` log toont de merged config
4. **Check model limits**: Wordt je value gecapped door Layer 1?

## Bekende Architectuur Quirks

### 1. Timeout Duplicatie
TIMEOUTS bestaan in zowel `shared/constants.ts` als `server/config/constants.ts`.
- **Vuistregel**: Server-side timeouts → `server/config/constants.ts`
- **Vuistregel**: Shared/UI timeouts → `shared/constants.ts`

### 2. Handler Routing is String-Based
`handlers.get("google")` gebruikt strings. Typos in `handlerType` falen silent.
- **Tip**: Check altijd of je handler bestaat na toevoegen nieuw model

### 3. Shadow Defaults
`REPORT_CONFIG.defaultModel`, `reviewerModel` etc. zijn hardcoded in code terwijl de filosofie is "alles uit database". Deze worden gebruikt als fallback.

### 4. Config Sources zijn Verspreid
Zie de precedence diagram hierboven. Dit is intentioneel (flexibiliteit) maar verwarrend voor nieuwe developers.

## Debugging Tips

| Symptoom | Check |
|----------|-------|
| "Model X niet geregistreerd" | Is model toegevoegd aan AI_MODELS? |
| "Geen handler gevonden" | Is handlerType correct? Is API key geconfigureerd? |
| Timeout errors | Check model-specifieke timeout in AI_MODELS |
| Verkeerde parameters | Check supportedParameters in AI_MODELS |
| Circuit breaker open | Wacht 60 sec of restart server |

## Gerelateerde Documentatie

- [CLAUDE.md](../CLAUDE.md) - Algemene codebase guide
- [shared/schema.ts](../shared/schema.ts) - Database schema en types
