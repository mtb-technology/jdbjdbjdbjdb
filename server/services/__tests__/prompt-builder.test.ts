/**
 * ## TESTS: PromptBuilder - De "Instructie Fabriek"
 *
 * **Critical Component**: Deze class bepaalt WAT elke AI specialist ZIET.
 * Als de data extractie fout gaat, krijgen specialists de verkeerde input.
 *
 * ### Wat wordt getest:
 * 1. Correct data extraction per stage type
 * 2. buildReviewerData - KRITIEK: moet concept text doorgeven, niet metadata
 * 3. Template method pattern werking
 * 4. Date formatting consistency
 * 5. Edge cases (lege data, missing fields, etc.)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromptBuilder, StagePromptConfig } from '../prompt-builder';
import type { DossierData, BouwplanData } from '@shared/schema';

describe('PromptBuilder - De Instructie Fabriek', () => {
  let promptBuilder: PromptBuilder;

  beforeEach(() => {
    promptBuilder = new PromptBuilder();
  });

  describe('Template Method - build()', () => {
    it('should build prompt with system prompt and user input', () => {
      const stageConfig: StagePromptConfig = {
        prompt: 'Je bent een test specialist',
        useGrounding: false
      };

      const result = promptBuilder.build(
        'test_stage',
        stageConfig,
        () => ({ test: 'data' })
      );

      expect(result.systemPrompt).toContain('Je bent een test specialist');
      expect(result.systemPrompt).toContain('### Datum:');
      expect(result.userInput).toContain('"test"');
      expect(result.userInput).toContain('"data"');
    });

    it('should format current date in Dutch locale', () => {
      const stageConfig: StagePromptConfig = {
        prompt: 'Test',
        useGrounding: false
      };

      const result = promptBuilder.build(
        'test',
        stageConfig,
        () => 'data'
      );

      // Date should be in format like "dinsdag 10 november 2025"
      expect(result.systemPrompt).toMatch(/### Datum: \w+/);
    });

    it('should handle string data extractor output', () => {
      const stageConfig: StagePromptConfig = {
        prompt: 'Test',
        useGrounding: false
      };

      const result = promptBuilder.build(
        'test',
        stageConfig,
        () => 'Simple string data'
      );

      expect(result.userInput).toBe('Simple string data');
    });

    it('should handle object data extractor output', () => {
      const stageConfig: StagePromptConfig = {
        prompt: 'Test',
        useGrounding: false
      };

      const result = promptBuilder.build(
        'test',
        stageConfig,
        () => ({ key: 'value', nested: { data: 123 } })
      );

      const parsed = JSON.parse(result.userInput);
      expect(parsed.key).toBe('value');
      expect(parsed.nested.data).toBe(123);
    });
  });

  describe('buildCombined() - Legacy Format', () => {
    it('should combine system prompt and user input with separator', () => {
      const stageConfig: StagePromptConfig = {
        prompt: 'System instructions',
        useGrounding: false
      };

      const result = promptBuilder.buildCombined(
        'test',
        stageConfig,
        () => 'User data'
      );

      expect(result).toContain('System instructions');
      expect(result).toContain('### Datum:');
      expect(result).toContain('### USER INPUT:');
      expect(result).toContain('User data');
    });
  });

  describe('buildInformatieCheckData() - Stage 1 Data Extraction', () => {
    it('should extract rawText when available', () => {
      const dossier: any = {
        rawText: 'De klant heeft een vraag over box 3 vermogen...',
        klant: {
          naam: 'Test Client',
          situatie: 'Situation'
        }
      };

      const result = promptBuilder.buildInformatieCheckData(dossier);

      expect(result).toBe('De klant heeft een vraag over box 3 vermogen...');
    });

    it('should fallback to structured data when rawText not available', () => {
      const dossier: DossierData = {
        klant: {
          naam: 'Test Client',
          situatie: 'Client wil emigreren naar Spanje'
        },
        fiscale_gegevens: {
          vermogen: 500000,
          inkomsten: 75000
        },
        datum: '2025-01-01T00:00:00Z'
      };

      const result = promptBuilder.buildInformatieCheckData(dossier);

      const parsed = JSON.parse(result);
      expect(parsed.klant.naam).toBe('Test Client');
      expect(parsed.situatie).toBe('Client wil emigreren naar Spanje');
    });
  });

  describe('buildComplexiteitsCheckData() - Stage 2 Data Extraction', () => {
    it('should extract Stage 1 output for Stage 2', () => {
      const previousResults = {
        '1_informatiecheck': JSON.stringify({
          status: 'COMPLEET',
          dossier: { samenvatting_onderwerp: 'Test' }
        })
      };

      const result = promptBuilder.buildComplexiteitsCheckData(previousResults);

      expect(result).toContain('COMPLEET');
      expect(result).toContain('samenvatting_onderwerp');
    });

    it('should return empty object when Stage 1 not completed', () => {
      const result = promptBuilder.buildComplexiteitsCheckData({});

      expect(result).toBe('{}');
    });
  });

  describe('buildGeneratieData() - Stage 3 Data Extraction', () => {
    it('should extract Stage 2 output for Stage 3', () => {
      const previousResults = {
        '2_complexiteitscheck': JSON.stringify({
          fiscale_kernthemas: ['Box 3', 'Emigratie'],
          bouwplan_voor_rapport: {}
        })
      };

      const result = promptBuilder.buildGeneratieData(previousResults);

      expect(result).toContain('fiscale_kernthemas');
      expect(result).toContain('Box 3');
    });

    it('should return empty object when Stage 2 not completed', () => {
      const result = promptBuilder.buildGeneratieData({});

      expect(result).toBe('{}');
    });
  });

  describe('buildReviewerData() - CRITICAL Stage 4a-4f Data Extraction', () => {
    it('should provide concept TEXT to reviewers, not metadata', () => {
      const conceptReport = `# Fiscaal Advies Rapport

## Inleiding
Dit rapport behandelt de fiscale gevolgen van emigratie naar Spanje.

## Box 3 Vermogen
Bij emigratie blijft u belastingplichtig voor...
`;

      const dossier: DossierData = {
        klant: {
          naam: 'Test Client',
          situatie: 'Emigratie'
        },
        fiscale_gegevens: {
          vermogen: 500000,
          inkomsten: 75000
        },
        datum: '2025-01-01T00:00:00Z'
      };

      const bouwplan: any = {
        taal: 'nl',
        structuur: {
          inleiding: true,
          knelpunten: ['Box 3 emigratie'],
          scenario_analyse: true,
          vervolgstappen: true
        }
      };

      const result = promptBuilder.buildReviewerData(conceptReport, dossier, bouwplan);

      const parsed = JSON.parse(result);

      // CRITICAL TEST: Verify reviewer sees the actual CONCEPT TEXT
      expect(parsed.concept_rapport_tekst).toContain('# Fiscaal Advies Rapport');
      expect(parsed.concept_rapport_tekst).toContain('Box 3 Vermogen');

      // Verify context is also provided
      expect(parsed.dossier_context).toBeDefined();
      expect(parsed.dossier_context.klant.naam).toBe('Test Client');

      expect(parsed.bouwplan_context).toBeDefined();
      expect(parsed.bouwplan_context.taal).toBe('nl');
    });

    it('should filter out rawText from dossier_context in Stage 4+', () => {
      const conceptReport = `# Test Rapport`;

      const dossierWithRawText: DossierData = {
        klant: {
          naam: 'Test Client',
          situatie: 'Test situatie'
        },
        fiscale_gegevens: {
          vermogen: 100000,
          inkomsten: 50000
        },
        datum: '2025-01-01T00:00:00Z',
        rawText: 'Dit is een hele lange ruwe tekst die NIET in Stage 4 validatie mag komen...'
      };

      const bouwplan: any = {
        taal: 'nl',
        structuur: { inleiding: true }
      };

      const result = promptBuilder.buildReviewerData(conceptReport, dossierWithRawText, bouwplan);
      const parsed = JSON.parse(result);

      // ✅ CRITICAL: rawText should be FILTERED OUT
      expect(parsed.dossier_context.rawText).toBeUndefined();

      // But other dossier fields should still be present
      expect(parsed.dossier_context.klant.naam).toBe('Test Client');
      expect(parsed.dossier_context.fiscale_gegevens.vermogen).toBe(100000);
    });

    it('should handle JSON-formatted concept reports', () => {
      const jsonConcept = JSON.stringify({
        title: 'Rapport',
        content: 'Rapport tekst'
      });

      const dossier: DossierData = {
        klant: { naam: 'Test', situatie: 'Test' },
        fiscale_gegevens: { vermogen: 0, inkomsten: 0 },
        datum: ''
      };

      const bouwplan: any = {
        taal: 'nl',
        structuur: { inleiding: true, knelpunten: ['K'], scenario_analyse: true, vervolgstappen: true }
      };

      const result = promptBuilder.buildReviewerData(jsonConcept, dossier, bouwplan);

      const parsed = JSON.parse(result);

      // Should include the JSON concept plus context
      expect(parsed.title).toBe('Rapport');
      expect(parsed.content).toBe('Rapport tekst');
      expect(parsed.dossier_context).toBeDefined();
    });

    it('should handle empty concept report gracefully', () => {
      const emptyReport = '';

      const dossier: DossierData = {
        klant: { naam: 'Test', situatie: 'Test' },
        fiscale_gegevens: { vermogen: 0, inkomsten: 0 },
        datum: ''
      };

      const bouwplan: any = {
        taal: 'nl',
        structuur: { inleiding: true, knelpunten: ['K'], scenario_analyse: true, vervolgstappen: true }
      };

      const result = promptBuilder.buildReviewerData(emptyReport, dossier, bouwplan);

      const parsed = JSON.parse(result);

      // Should still provide context even with empty report
      expect(parsed.concept_rapport_tekst).toBe('');
      expect(parsed.dossier_context).toBeDefined();
      expect(parsed.bouwplan_context).toBeDefined();
    });

    it('should handle very long concept reports (>50k chars)', () => {
      const longReport = 'A'.repeat(60000); // 60k character report

      const dossier: DossierData = {
        klant: { naam: 'Test', situatie: 'Test' },
        fiscale_gegevens: { vermogen: 0, inkomsten: 0 },
        datum: ''
      };

      const bouwplan: any = {
        taal: 'nl',
        structuur: { inleiding: true, knelpunten: ['K'], scenario_analyse: true, vervolgstappen: true }
      };

      // Should not throw error with large reports
      const result = promptBuilder.buildReviewerData(longReport, dossier, bouwplan);

      const parsed = JSON.parse(result);
      expect(parsed.concept_rapport_tekst).toHaveLength(60000);
    });

    it('should handle special characters in concept report', () => {
      const reportWithSpecialChars = `# Rapport

Bedrag: €500.000
Client: François (émigré)
Quote: "Box 3 heffing"
Newlines and\ntabs\there`;

      const dossier: DossierData = {
        klant: { naam: 'Test', situatie: 'Test' },
        fiscale_gegevens: { vermogen: 0, inkomsten: 0 },
        datum: ''
      };

      const bouwplan: any = {
        taal: 'nl',
        structuur: { inleiding: true, knelpunten: ['K'], scenario_analyse: true, vervolgstappen: true }
      };

      const result = promptBuilder.buildReviewerData(reportWithSpecialChars, dossier, bouwplan);

      const parsed = JSON.parse(result);
      expect(parsed.concept_rapport_tekst).toContain('€500.000');
      expect(parsed.concept_rapport_tekst).toContain('François');
      expect(parsed.concept_rapport_tekst).toContain('"Box 3 heffing"');
    });
  });

  describe('buildEditorData() - Stage 5 (Editor) Data Extraction', () => {
    it('should provide all reviewer feedback and latest concept', () => {
      const previousResults = {
        '4a_BronnenSpecialist': 'Voeg bronverwijzingen toe',
        '4b_FiscaalTechnischSpecialist': 'Technische correcties',
        '4c_ScenarioGatenAnalist': 'Scenario analyse',
        '4e_DeAdvocaat': 'Juridische check',
        '4f_HoofdCommunicatie': 'Communicatie en klantgerichtheid'
      };

      const conceptVersions = {
        'latest': 'LATEST CONCEPT RAPPORT TEXT'
      };

      const result = promptBuilder.buildEditorData(previousResults, conceptVersions);

      const parsed = JSON.parse(result);

      // Verify all feedback is included
      expect(parsed.reviewer_feedback['4a_BronnenSpecialist']).toBe('Voeg bronverwijzingen toe');
      expect(parsed.reviewer_feedback['4b_FiscaalTechnischSpecialist']).toBe('Technische correcties');

      // Verify latest concept is included
      expect(parsed.latest_concept_report).toBe('LATEST CONCEPT RAPPORT TEXT');
    });

    it('should fallback to 3_generatie when latest not available', () => {
      const conceptVersions = {
        '3_generatie': 'GENERATIE CONCEPT'
      };

      const result = promptBuilder.buildEditorData({}, conceptVersions);

      const parsed = JSON.parse(result);
      expect(parsed.latest_concept_report).toBe('GENERATIE CONCEPT');
    });

    it('should handle missing reviewer feedback gracefully', () => {
      const previousResults = {
        '4a_BronnenSpecialist': 'Feedback'
        // Other reviewers not executed
      };

      const conceptVersions = {
        'latest': 'Concept'
      };

      const result = promptBuilder.buildEditorData(previousResults, conceptVersions);

      const parsed = JSON.parse(result);

      expect(parsed.reviewer_feedback['4a_BronnenSpecialist']).toBe('Feedback');
      expect(parsed.reviewer_feedback['4b_FiscaalTechnischSpecialist']).toBeUndefined();
    });
  });

  describe('buildChangeSummaryData() - Stage 6 Data Extraction', () => {
    it('should create version overview from concept versions', () => {
      const conceptVersions = {
        '3_generatie': 'A'.repeat(5000),
        '4a_BronnenSpecialist': 'B'.repeat(5500),
        '4b_FiscaalTechnischSpecialist': 'C'.repeat(6000),
        'latest': { pointer: '4b_FiscaalTechnischSpecialist', v: 3 },
        'history': []
      };

      const result = promptBuilder.buildChangeSummaryData(conceptVersions);

      const parsed = JSON.parse(result);

      expect(parsed.versions).toBeDefined();
      expect(parsed.versions).toHaveLength(3); // Should exclude 'latest' and 'history'

      // Check that content lengths are tracked
      const generatieVersion = parsed.versions.find((v: any) => v.stage === '3_generatie');
      expect(generatieVersion.contentLength).toBe(5000);

      // Check that previews are provided (first 200 chars)
      expect(generatieVersion.preview).toHaveLength(200);
    });

    it('should handle empty concept versions', () => {
      const result = promptBuilder.buildChangeSummaryData({});

      const parsed = JSON.parse(result);
      expect(parsed.versions).toHaveLength(0);
    });

    it('should filter out special keys (latest, history)', () => {
      const conceptVersions = {
        '3_generatie': 'Content',
        'latest': { pointer: '3_generatie', v: 1 },
        'history': [{ stageId: '3_generatie', v: 1, timestamp: '2025-01-01' }]
      };

      const result = promptBuilder.buildChangeSummaryData(conceptVersions);

      const parsed = JSON.parse(result);

      // Should only have 3_generatie, not latest or history
      expect(parsed.versions).toHaveLength(1);
      expect(parsed.versions[0].stage).toBe('3_generatie');
    });
  });

  describe('Edge Cases - Data Validation', () => {
    it('should handle null/undefined data gracefully', () => {
      const stageConfig: StagePromptConfig = {
        prompt: 'Test',
        useGrounding: false
      };

      const result = promptBuilder.build(
        'test',
        stageConfig,
        () => null
      );

      expect(result.userInput).toBe('null');
    });

    it('should handle numbers as data', () => {
      const stageConfig: StagePromptConfig = {
        prompt: 'Test',
        useGrounding: false
      };

      const result = promptBuilder.build(
        'test',
        stageConfig,
        () => 12345
      );

      expect(result.userInput).toBe('12345');
    });

    it('should handle boolean as data', () => {
      const stageConfig: StagePromptConfig = {
        prompt: 'Test',
        useGrounding: false
      };

      const result = promptBuilder.build(
        'test',
        stageConfig,
        () => true
      );

      expect(result.userInput).toBe('true');
    });

    it('should handle arrays as data', () => {
      const stageConfig: StagePromptConfig = {
        prompt: 'Test',
        useGrounding: false
      };

      const result = promptBuilder.build(
        'test',
        stageConfig,
        () => ['item1', 'item2', 'item3']
      );

      const parsed = JSON.parse(result.userInput);
      expect(parsed).toHaveLength(3);
      expect(parsed).toContain('item1');
    });

    it('should preserve object structure in JSON stringification', () => {
      const complexData = {
        level1: {
          level2: {
            level3: {
              value: 'deeply nested'
            }
          }
        },
        array: [1, 2, { nested: true }]
      };

      const stageConfig: StagePromptConfig = {
        prompt: 'Test',
        useGrounding: false
      };

      const result = promptBuilder.build(
        'test',
        stageConfig,
        () => complexData
      );

      const parsed = JSON.parse(result.userInput);
      expect(parsed.level1.level2.level3.value).toBe('deeply nested');
      expect(parsed.array[2].nested).toBe(true);
    });
  });

  describe('Integration - Complete Prompt Building', () => {
    it('should build complete reviewer prompt with all components', () => {
      const stageConfig: StagePromptConfig = {
        prompt: 'Je bent de BronnenSpecialist. Controleer alle bronverwijzingen.',
        useGrounding: true
      };

      const conceptReport = '# Rapport met fiscale analyse...';
      const dossier: DossierData = {
        klant: { naam: 'Client', situatie: 'Emigratie' },
        fiscale_gegevens: { vermogen: 500000, inkomsten: 75000 },
        datum: ''
      };
      const bouwplan: any = {
        taal: 'nl',
        structuur: { inleiding: true, knelpunten: ['K'], scenario_analyse: true, vervolgstappen: true }
      };

      const result = promptBuilder.build(
        '4a_BronnenSpecialist',
        stageConfig,
        () => promptBuilder.buildReviewerData(conceptReport, dossier, bouwplan)
      );

      // Verify system prompt
      expect(result.systemPrompt).toContain('BronnenSpecialist');
      expect(result.systemPrompt).toContain('### Datum:');

      // Verify user input
      const parsed = JSON.parse(result.userInput);
      expect(parsed.concept_rapport_tekst).toContain('# Rapport');
      expect(parsed.dossier_context.klant.naam).toBe('Client');

      // Complete prompt should be ready for AI
      expect(result.systemPrompt.length).toBeGreaterThan(0);
      expect(result.userInput.length).toBeGreaterThan(0);
    });
  });
});
