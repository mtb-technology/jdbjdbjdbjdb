# Testing Documentation

## Overzicht

Dit project gebruikt **Vitest** voor unit testing van kritieke componenten.

### Waarom Deze Tests?

De tests focussen op de **meest breekbare en kritieke** onderdelen van het AI Pipeline Orchestrator systeem:

1. **ReportProcessor** - De "Chirurgische Redacteur" die feedback merget
2. **Workflow Parsers** - De "Vertalers" die AI output parsen
3. **PromptBuilder** - De "Instructie Fabriek" die data extraheert voor AI

Deze componenten zijn het **hart van de versioning en data flow logica**. Als deze falen, breekt het hele systeem.

## Tests Uitvoeren

### Alle Tests Runnen

```bash
npm test
```

### Tests in Watch Mode (tijdens development)

```bash
npm test
```

Vitest blijft actief en runt tests opnieuw bij bestandswijzigingen.

### Tests Eenmalig Runnen (voor CI/CD)

```bash
npm run test:run
```

### Tests met UI Interface

```bash
npm run test:ui
```

Opent een browser interface om tests visueel te inspecteren.

### Coverage Report Genereren

```bash
npm run test:coverage
```

Genereert een HTML coverage report in `coverage/` directory.

## Test Structuur

### 1. ReportProcessor Tests
**Locatie**: `server/services/__tests__/report-processor.test.ts`

**Wat wordt getest:**
- ✅ AI merge functionality (happy path)
- ✅ Fallback handling wanneer AI faalt
- ✅ Snapshot creation met versie tracking
- ✅ Re-processing logic (stage opnieuw uitvoeren)
- ✅ Version chaining (predecessor detection)
- ✅ Edge cases (lege feedback, extreme lengths, special characters)
- ✅ Data loss prevention (zelfs bij complete AI failure)

**Kritieke Test Cases:**
```typescript
it('should use current stage version as base when re-processing')
it('should never lose data even with AI failure')
it('should handle extremely long concept reports (>100k chars)')
```

### 2. Workflow Parser Tests
**Locatie**: `client/src/lib/__tests__/workflowParsers.test.ts`

**Wat wordt getest:**
- ✅ Perfect formatted JSON parsing
- ✅ Markdown-wrapped JSON extraction (```json ... ```)
- ✅ JSON embedded in text
- ✅ Malformed JSON handling
- ✅ Stage 1 blocking logic (COMPLEET vs INCOMPLEET)
- ✅ Backward compatibility met oude formaten
- ✅ Unicode en special characters
- ✅ Real-world AI output voorbeelden (Gemini, GPT)

**Kritieke Test Cases:**
```typescript
it('should return false for INCOMPLEET status') // Blokkeert pipeline
it('should return true for unparseable output (backward compatibility)')
it('should extract JSON from markdown code blocks') // Gemini/GPT output
```

### 3. PromptBuilder Tests
**Locatie**: `server/services/__tests__/prompt-builder.test.ts`

**Wat wordt getest:**
- ✅ Correct data extraction per stage type
- ✅ buildReviewerData - KRITIEK: moet concept TEXT doorgeven
- ✅ Template method pattern werking
- ✅ Date formatting consistency
- ✅ Edge cases (lege data, missing fields, null values)
- ✅ Special characters handling
- ✅ Very long data (>50k chars)

**Kritieke Test Cases:**
```typescript
it('should provide concept TEXT to reviewers, not metadata')
it('should handle very long concept reports (>50k chars)')
it('should handle special characters in concept report')
```

## Belangrijke Edge Cases

### 1. Re-processing Logic (ReportProcessor)

**Scenario**: Gebruiker voert Stage 4a opnieuw uit (met betere prompt)

**Expected Behavior**:
```typescript
// CORRECT:
base = conceptReportVersions["4a_BronnenSpecialist"].content  // v2
newVersion = 3 // Increment vanaf v2

// FOUT:
base = conceptReportVersions["3_generatie"].content  // Predecessor
// Dit zou data loss veroorzaken!
```

**Test**: `should use current stage version as base when re-processing`

### 2. Pipeline Blocking (Workflow Parsers)

**Scenario**: Stage 1 returnt INCOMPLEET

**Expected Behavior**:
```typescript
isInformatieCheckComplete(stage1Output) === false
→ UI: Stage 2 button DISABLED ❌
→ Gebruiker moet e-mail versturen
```

**Test**: `should return false for INCOMPLEET status`

### 3. Reviewer Data (PromptBuilder)

**Scenario**: Stage 4a (BronnenSpecialist) wordt uitgevoerd

**Expected Behavior**:
```typescript
// CORRECT:
reviewerInput = {
  concept_rapport_tekst: "# Fiscaal Advies\n\nDe volledige rapport tekst..."
}

// FOUT:
reviewerInput = previousStageResults['3_generatie'] // Metadata, geen tekst!
```

**Test**: `should provide concept TEXT to reviewers, not metadata`

### 4. AI Failure Resilience (ReportProcessor)

**Scenario**: AI service is down of timeout

**Expected Behavior**:
```typescript
// Geen crash, geen data loss
// Fallback naar simple append
newConcept = baseConcept + "\n\n⚠️ FEEDBACK VERWERKING\n" + feedback
```

**Test**: `should use fallback merge when AI throws error`

## Mocking Strategy

### Storage Mock
```typescript
vi.mock('../../storage', () => ({
  storage: {
    getReport: vi.fn(),
    updateReport: vi.fn(),
  }
}));
```

### AI Handler Mock
```typescript
const mockAIHandler = {
  generateContent: vi.fn().mockResolvedValue({
    content: 'MERGED_CONCEPT_REPORT_CONTENT'
  })
};
```

## Test Coverage Goals

- **ReportProcessor**: 90%+ coverage
- **Workflow Parsers**: 95%+ coverage (kritiek voor pipeline flow)
- **PromptBuilder**: 85%+ coverage

## Nieuwe Tests Toevoegen

### Template voor nieuwe test file:

```typescript
/**
 * ## TESTS: [Component Name] - [Beschrijving]
 *
 * **Critical Component**: [Waarom dit kritiek is]
 *
 * ### Wat wordt getest:
 * 1. [Happy path]
 * 2. [Edge case 1]
 * 3. [Edge case 2]
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('[Component Name]', () => {
  beforeEach(() => {
    // Setup code
  });

  describe('[Feature Group]', () => {
    it('should [expected behavior]', () => {
      // Test code
      expect(result).toBe(expected);
    });
  });
});
```

## CI/CD Integration

Voor CI/CD pipelines (GitHub Actions, etc.):

```yaml
- name: Run tests
  run: npm run test:run

- name: Generate coverage
  run: npm run test:coverage

- name: Upload coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/coverage-final.json
```

## Debugging Tests

### Test isoleren:
```typescript
it.only('should test this specific case', () => {
  // Deze test wordt als enige uitgevoerd
});
```

### Test skippen:
```typescript
it.skip('should test this later', () => {
  // Deze test wordt overgeslagen
});
```

### Verbose output:
```bash
npm test -- --reporter=verbose
```

## Best Practices

1. **Test één ding per test** - Elke `it()` test één specifiek gedrag
2. **Duidelijke test namen** - Beschrijf het verwachte gedrag
3. **Arrange-Act-Assert** patroon:
   ```typescript
   it('should do something', () => {
     // Arrange: Setup
     const input = 'test';

     // Act: Execute
     const result = doSomething(input);

     // Assert: Verify
     expect(result).toBe('expected');
   });
   ```
4. **Test edge cases** - Niet alleen happy path, ook errors
5. **Mock externe dependencies** - Database, AI services, etc.
6. **Clean up mocks** - `beforeEach(() => vi.clearAllMocks())`

## Troubleshooting

### Import errors
Als je import errors krijgt, check `vitest.config.ts` aliases:
```typescript
resolve: {
  alias: {
    '@shared': path.resolve(__dirname, './shared'),
    '@': path.resolve(__dirname, './client/src'),
  }
}
```

### Tests falen onverwacht
1. Clear mock history: `vi.clearAllMocks()`
2. Check of je de juiste modules mockt
3. Verify dat test data overeenkomt met schema's

### Performance issues
Als tests lang duren:
1. Check of je geen echte database calls doet (moet gemocked zijn)
2. Gebruik `beforeEach` voor setup, niet in elke test
3. Overweeg test parallelization (standaard aan in Vitest)

## Verder Lezen

- [Vitest Documentatie](https://vitest.dev/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- Zie ook: `shared/schema.ts` voor data schema's en documentatie
