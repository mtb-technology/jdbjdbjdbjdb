/**
 * ## TESTS: ReportProcessor - De "Chirurgische Redacteur"
 *
 * **Critical Component**: Deze class is het HART van de versioning system.
 * Als deze faalt, breekt de hele feedback merging logica.
 *
 * ### Wat wordt getest:
 * 1. AI Merge functionaliteit (happy path)
 * 2. Fallback handling (wanneer AI faalt)
 * 3. Snapshot creation met versie tracking
 * 4. Re-processing logic (stage opnieuw uitvoeren)
 * 5. Version chaining (predecessor detection)
 * 6. Edge cases (lege feedback, ontbrekende base, etc.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportProcessor } from '../report-processor';
import type {
  StageId,
  ConceptReportSnapshot,
  ConceptReportVersions,
  ReportProcessorInput
} from '@shared/schema';

// Mock storage module
vi.mock('../../storage', () => ({
  storage: {
    getReport: vi.fn(),
    updateReport: vi.fn(),
  },
  getActivePromptConfig: vi.fn(),
}));

import { storage, getActivePromptConfig } from '../../storage';

describe('ReportProcessor - De Chirurgische Redacteur', () => {
  let reportProcessor: ReportProcessor;
  let mockAIHandler: any;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Mock AI handler met standaard success response
    mockAIHandler = {
      generateContent: vi.fn().mockResolvedValue({
        content: 'MERGED_CONCEPT_REPORT_CONTENT'
      })
    };

    // Mock getActivePromptConfig to return a valid config with editor prompt
    vi.mocked(getActivePromptConfig).mockResolvedValue({
      editor: {
        prompt: 'BASE: {baseConcept}\nFEEDBACK: {feedback}\nSTAGE: {stageId}\nSTRATEGY: {strategy}',
        aiConfig: {
          temperature: 0.1,
          topP: 0.9,
          maxOutputTokens: 32768,
        }
      },
      aiConfig: {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 4096,
      }
    } as any);

    reportProcessor = new ReportProcessor(mockAIHandler);
  });

  describe('AI Merge Functionality', () => {
    it('should correctly merge feedback into base concept using AI', async () => {
      const input: ReportProcessorInput = {
        baseConcept: 'Original rapport text...',
        feedback: 'Voeg bronverwijzingen toe voor sectie X',
        stageId: '4a_BronnenSpecialist',
        strategy: 'merge'
      };

      const result = await reportProcessor.process(input);

      // Verify AI was called with correct prompt
      expect(mockAIHandler.generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('Original rapport text'),
          prompt: expect.stringContaining('Voeg bronverwijzingen toe'),
          temperature: 0.1,
          topP: 0.9,
          maxOutputTokens: 32768
        })
      );

      // Verify result
      expect(result.newConcept).toBe('MERGED_CONCEPT_REPORT_CONTENT');
      expect(result.summary).toContain('4a_BronnenSpecialist');
    });

    it('should use "sectional" strategy in prompt', async () => {
      const input: ReportProcessorInput = {
        baseConcept: 'Test',
        feedback: 'Feedback',
        stageId: '4b_FiscaalTechnischSpecialist',
        strategy: 'sectional'
      };

      await reportProcessor.process(input);

      const calledPrompt = mockAIHandler.generateContent.mock.calls[0][0].prompt;
      expect(calledPrompt).toContain('STRATEGY: sectional');
      expect(calledPrompt).toContain('BASE: Test');
      expect(calledPrompt).toContain('FEEDBACK: Feedback');
    });

    it('should use "replace" strategy in prompt', async () => {
      const input: ReportProcessorInput = {
        baseConcept: 'Test',
        feedback: 'Feedback',
        stageId: '4c_ScenarioGatenAnalist',
        strategy: 'replace'
      };

      await reportProcessor.process(input);

      const calledPrompt = mockAIHandler.generateContent.mock.calls[0][0].prompt;
      expect(calledPrompt).toContain('STRATEGY: replace');
      expect(calledPrompt).toContain('BASE: Test');
      expect(calledPrompt).toContain('FEEDBACK: Feedback');
    });

    it('should use "append" strategy in prompt', async () => {
      const input: ReportProcessorInput = {
        baseConcept: 'Test',
        feedback: 'Feedback',
        stageId: '4d_DeVertaler',
        strategy: 'append'
      };

      await reportProcessor.process(input);

      const calledPrompt = mockAIHandler.generateContent.mock.calls[0][0].prompt;
      expect(calledPrompt).toContain('STRATEGY: append');
      expect(calledPrompt).toContain('BASE: Test');
      expect(calledPrompt).toContain('FEEDBACK: Feedback');
    });
  });

  describe('Fallback Handling - CRITICAL Edge Cases', () => {
    it('should use fallback merge when AI returns empty content', async () => {
      mockAIHandler.generateContent.mockResolvedValue({ content: '' });

      const input: ReportProcessorInput = {
        baseConcept: 'Original text',
        feedback: 'Some feedback',
        stageId: '4a_BronnenSpecialist',
        strategy: 'merge'
      };

      const result = await reportProcessor.process(input);

      // Should fallback to simple append
      expect(result.newConcept).toContain('Original text');
      expect(result.newConcept).toContain('Some feedback');
      expect(result.newConcept).toContain('⚠️ FEEDBACK VERWERKING');
      expect(result.summary).toContain('Fallback merge');
    });

    it('should use fallback merge when AI throws error', async () => {
      mockAIHandler.generateContent.mockRejectedValue(new Error('AI service timeout'));

      const input: ReportProcessorInput = {
        baseConcept: 'Original text',
        feedback: 'Some feedback',
        stageId: '4b_FiscaalTechnischSpecialist',
        strategy: 'merge'
      };

      const result = await reportProcessor.process(input);

      // Should NOT throw, should fallback gracefully
      expect(result.newConcept).toBeDefined();
      expect(result.newConcept).toContain('⚠️ FEEDBACK VERWERKING');
      expect(result.summary).toContain('Fallback merge');
    });

    it('should handle empty feedback gracefully', async () => {
      const input: ReportProcessorInput = {
        baseConcept: 'Original text',
        feedback: '',
        stageId: '4a_BronnenSpecialist',
        strategy: 'merge'
      };

      const result = await reportProcessor.process(input);

      // Should still call AI (AI might add nothing, that's OK)
      expect(mockAIHandler.generateContent).toHaveBeenCalled();
      expect(result.newConcept).toBeDefined();
    });
  });

  describe('Snapshot Creation with Version Tracking', () => {
    it('should create snapshot with version 1 for first-time stage execution', async () => {
      const mockReport = {
        id: 'report-123',
        conceptReportVersions: {
          '3_generatie': { v: 1, content: 'Base concept' }
        }
      };
      vi.mocked(storage.getReport).mockResolvedValue(mockReport as any);

      const snapshot = await reportProcessor.createSnapshot(
        'report-123',
        '4a_BronnenSpecialist',
        'Updated concept',
        '3_generatie',
        'Feedback processed'
      );

      expect(snapshot.v).toBe(2); // Increment from predecessor (v1)
      expect(snapshot.content).toBe('Updated concept');
      expect(snapshot.from).toBe('3_generatie');
      expect(snapshot.processedFeedback).toBe('Feedback processed');
      expect(snapshot.createdAt).toBeDefined();
    });

    it('should increment version when re-processing same stage', async () => {
      const mockReport = {
        id: 'report-123',
        conceptReportVersions: {
          '3_generatie': { v: 1, content: 'Base' },
          '4a_BronnenSpecialist': { v: 2, content: 'Previous version' }
        }
      };
      vi.mocked(storage.getReport).mockResolvedValue(mockReport as any);

      // Re-run 4a (already has v2)
      const snapshot = await reportProcessor.createSnapshot(
        'report-123',
        '4a_BronnenSpecialist',
        'Re-processed concept',
        '3_generatie'
      );

      expect(snapshot.v).toBe(3); // Increment from current stage version (v2)
    });

    it('should handle missing report gracefully', async () => {
      vi.mocked(storage.getReport).mockResolvedValue(null);

      await expect(
        reportProcessor.createSnapshot(
          'non-existent-report',
          '4a_BronnenSpecialist',
          'Content'
        )
      ).rejects.toThrow('Report non-existent-report not found');
    });
  });

  describe('Complete processStage Workflow', () => {
    it('should complete full processing flow for first-time stage execution', async () => {
      const mockReport = {
        id: 'report-123',
        conceptReportVersions: {
          '3_generatie': { v: 1, content: 'Base concept from stage 3' }
        }
      };
      vi.mocked(storage.getReport).mockResolvedValue(mockReport as any);
      vi.mocked(storage.updateReport).mockResolvedValue(undefined);

      const result = await reportProcessor.processStage(
        'report-123',
        '4a_BronnenSpecialist',
        'Add source references to section 2',
        'merge'
      );

      // Verify AI was called with base concept from predecessor
      expect(mockAIHandler.generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('Base concept from stage 3')
        })
      );

      // Verify snapshot was created
      expect(result.snapshot.v).toBe(2);
      expect(result.snapshot.from).toBe('3_generatie');
      expect(result.newConcept).toBe('MERGED_CONCEPT_REPORT_CONTENT');

      // Verify database was updated
      expect(storage.updateReport).toHaveBeenCalledWith(
        'report-123',
        expect.objectContaining({
          conceptReportVersions: expect.objectContaining({
            '4a_BronnenSpecialist': result.snapshot,
            latest: { pointer: '4a_BronnenSpecialist', v: 2 }
          })
        })
      );
    });

    it('should use current stage version as base when re-processing', async () => {
      const mockReport = {
        id: 'report-123',
        conceptReportVersions: {
          '3_generatie': { v: 1, content: 'Original from stage 3' },
          '4a_BronnenSpecialist': { v: 2, content: 'CURRENT 4a version - use this!' }
        }
      };
      vi.mocked(storage.getReport).mockResolvedValue(mockReport as any);

      await reportProcessor.processStage(
        'report-123',
        '4a_BronnenSpecialist',
        'Re-run with better prompt',
        'merge'
      );

      // CRITICAL: Should use current 4a version, NOT predecessor
      expect(mockAIHandler.generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('CURRENT 4a version - use this!')
        })
      );
    });

    it('should handle Stage 3 (generatie) which has no predecessor', async () => {
      const mockReport = {
        id: 'report-123',
        generatedContent: 'Initial generated content',
        conceptReportVersions: {}
      };
      vi.mocked(storage.getReport).mockResolvedValue(mockReport as any);

      const result = await reportProcessor.processStage(
        'report-123',
        '3_generatie',
        'Generated report text',
        'merge'
      );

      expect(result.snapshot.v).toBe(1); // First version
      expect(result.snapshot.from).toBeUndefined(); // No predecessor
    });
  });

  describe('Predecessor Stage Detection', () => {
    it('should correctly identify predecessor for stage 4a', () => {
      const predecessor = reportProcessor.getPredecessorStage('4a_BronnenSpecialist');
      expect(predecessor).toBe('3_generatie');
    });

    it('should correctly identify predecessor for stage 4b', () => {
      const predecessor = reportProcessor.getPredecessorStage('4b_FiscaalTechnischSpecialist');
      expect(predecessor).toBe('4a_BronnenSpecialist');
    });

    it('should correctly identify predecessor for stage 4f (last reviewer)', () => {
      const predecessor = reportProcessor.getPredecessorStage('4f_DeKlantpsycholoog');
      expect(predecessor).toBe('4e_DeAdvocaat');
    });

    it('should return null for stage 3 (generatie) - first stage with concept', () => {
      const predecessor = reportProcessor.getPredecessorStage('3_generatie');
      expect(predecessor).toBeNull();
    });
  });

  describe('Version History Tracking', () => {
    it('should maintain version history with timestamps', async () => {
      const mockReport = {
        id: 'report-123',
        conceptReportVersions: {
          '3_generatie': { v: 1, content: 'Base' },
          history: [
            { stageId: '3_generatie', v: 1, timestamp: '2025-01-01T00:00:00Z' }
          ]
        }
      };
      vi.mocked(storage.getReport).mockResolvedValue(mockReport as any);
      vi.mocked(storage.updateReport).mockResolvedValue(undefined);

      await reportProcessor.processStage(
        'report-123',
        '4a_BronnenSpecialist',
        'Feedback',
        'merge'
      );

      const updateCall = vi.mocked(storage.updateReport).mock.calls[0][1];
      const updatedVersions = updateCall.conceptReportVersions as ConceptReportVersions;

      expect(updatedVersions.history).toHaveLength(2);
      expect(updatedVersions.history![1]).toMatchObject({
        stageId: '4a_BronnenSpecialist',
        v: 2
      });
      expect(updatedVersions.history![1].timestamp).toBeDefined();
    });

    it('should update latest pointer to most recent stage', async () => {
      const mockReport = {
        id: 'report-123',
        conceptReportVersions: {
          '3_generatie': { v: 1, content: 'Base' },
          latest: { pointer: '3_generatie', v: 1 }
        }
      };
      vi.mocked(storage.getReport).mockResolvedValue(mockReport as any);

      await reportProcessor.processStage(
        'report-123',
        '4a_BronnenSpecialist',
        'Feedback',
        'merge'
      );

      const updateCall = vi.mocked(storage.updateReport).mock.calls[0][1];
      const updatedVersions = updateCall.conceptReportVersions as ConceptReportVersions;

      expect(updatedVersions.latest).toEqual({
        pointer: '4a_BronnenSpecialist',
        v: 2
      });
    });
  });

  describe('Edge Cases - Data Loss Prevention', () => {
    it('should never lose data even with AI failure', async () => {
      mockAIHandler.generateContent.mockRejectedValue(new Error('Complete AI failure'));

      const mockReport = {
        id: 'report-123',
        conceptReportVersions: {
          '3_generatie': { v: 1, content: 'IMPORTANT ORIGINAL CONTENT' }
        }
      };
      vi.mocked(storage.getReport).mockResolvedValue(mockReport as any);

      const result = await reportProcessor.processStage(
        'report-123',
        '4a_BronnenSpecialist',
        'Feedback',
        'merge'
      );

      // Original content should be preserved
      expect(result.newConcept).toContain('IMPORTANT ORIGINAL CONTENT');
      expect(result.newConcept).toBeDefined();
      expect(result.newConcept.length).toBeGreaterThan(0);
    });

    it('should handle extremely long concept reports (>100k chars)', async () => {
      const longConcept = 'A'.repeat(150000); // 150k characters
      const mockReport = {
        id: 'report-123',
        conceptReportVersions: {
          '3_generatie': { v: 1, content: longConcept }
        }
      };
      vi.mocked(storage.getReport).mockResolvedValue(mockReport as any);

      // Should not throw, should handle gracefully
      const result = await reportProcessor.processStage(
        'report-123',
        '4a_BronnenSpecialist',
        'Short feedback',
        'merge'
      );

      expect(result.newConcept).toBeDefined();
      expect(mockAIHandler.generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          maxOutputTokens: 32768 // Should use high token limit
        })
      );
    });

    it('should handle special characters in feedback and concept', async () => {
      const mockReport = {
        id: 'report-123',
        conceptReportVersions: {
          '3_generatie': { v: 1, content: 'Concept with "quotes" and \n newlines' }
        }
      };
      vi.mocked(storage.getReport).mockResolvedValue(mockReport as any);

      const result = await reportProcessor.processStage(
        'report-123',
        '4a_BronnenSpecialist',
        'Feedback with <html> and & symbols',
        'merge'
      );

      // Should not throw errors due to special characters
      expect(result.newConcept).toBeDefined();
    });
  });
});
