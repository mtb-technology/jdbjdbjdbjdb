/**
 * Rollback Service
 *
 * Handles rolling back individual changes made by review stages.
 * Uses direct string replacement - NO AI calls needed.
 */

import { storage } from '../storage';
import { parseFeedbackToProposals, type ChangeProposal } from '@shared/lib/parse-feedback';
import { STAGE_NAMES, getLatestConceptText, REVIEW_STAGES } from '@shared/constants';

interface RollbackResult {
  success: boolean;
  newContent?: string;
  newVersion?: number;
  warning?: string;
  error?: string;
}

interface RollbackChangeParams {
  reportId: string;
  stageId: string;
  changeIndex: number; // Index of the change in the parsed proposals array
}

/**
 * Roll back a single change by replacing the proposed text with the original
 */
export async function rollbackChange(params: RollbackChangeParams): Promise<RollbackResult> {
  const { reportId, stageId, changeIndex } = params;

  try {
    // 1. Get the report
    const report = await storage.getReport(reportId);
    if (!report) {
      return { success: false, error: 'Rapport niet gevonden' };
    }

    // 2. Get the stage result (raw feedback)
    const stageResults = (report.stageResults || {}) as Record<string, string>;
    const rawFeedback = stageResults[stageId];
    if (!rawFeedback) {
      return { success: false, error: `Geen resultaat gevonden voor stage ${stageId}` };
    }

    // 3. Parse the feedback to get change proposals
    const stageName = STAGE_NAMES[stageId] || stageId;
    const proposals = parseFeedbackToProposals(rawFeedback, stageName, stageId);

    if (changeIndex < 0 || changeIndex >= proposals.length) {
      return { success: false, error: `Change index ${changeIndex} niet gevonden (${proposals.length} changes beschikbaar)` };
    }

    const change = proposals[changeIndex];

    // 4. Get current concept content using shared helper
    const conceptVersions = (report.conceptReportVersions || {}) as Record<string, any>;
    const latestContent = getLatestConceptText(conceptVersions);

    if (!latestContent) {
      return { success: false, error: 'Geen concept rapport content gevonden' };
    }

    // Get latest version number
    let latestVersion = 0;
    if (conceptVersions.latest?.v) {
      latestVersion = conceptVersions.latest.v;
    } else if (conceptVersions.latest?.pointer) {
      const snapshot = conceptVersions[conceptVersions.latest.pointer];
      latestVersion = snapshot?.v || 1;
    } else {
      // Find highest version from any key
      for (const [, value] of Object.entries(conceptVersions)) {
        if (value && typeof value === 'object' && 'v' in value) {
          const v = (value as any).v as number;
          if (v > latestVersion) {
            latestVersion = v;
          }
        }
      }
    }

    // 5. Perform the rollback
    let newContent = latestContent;
    let warning: string | undefined;

    if (change.changeType === 'modify' && change.original && change.proposed) {
      // Case 1: Modify - replace proposed with original
      if (newContent.includes(change.proposed)) {
        newContent = newContent.replace(change.proposed, change.original);
      } else {
        // Try fuzzy match - first 50 chars
        const fuzzyMatch = findFuzzyMatch(newContent, change.proposed, 50);
        if (fuzzyMatch) {
          newContent = newContent.replace(fuzzyMatch, change.original);
          warning = 'Exacte tekst niet gevonden, fuzzy match gebruikt';
        } else {
          // Find which later stage might have overwritten this text
          const overwritingStages = findPossibleOverwritingStages(stageId, change.proposed, stageResults);
          let errorMsg = 'Tekst niet gevonden in rapport';
          if (overwritingStages.length > 0) {
            errorMsg += ` - waarschijnlijk overschreven door: ${overwritingStages.join(', ')}`;
          } else {
            errorMsg += ' - mogelijk al overschreven door een latere wijziging';
          }
          return {
            success: false,
            error: errorMsg
          };
        }
      }
    } else if (change.changeType === 'add' && change.proposed) {
      // Case 2: Add - remove the added text
      if (newContent.includes(change.proposed)) {
        newContent = newContent.replace(change.proposed, '');
        // Clean up double newlines that might result
        newContent = newContent.replace(/\n{3,}/g, '\n\n');
      } else {
        const fuzzyMatch = findFuzzyMatch(newContent, change.proposed, 50);
        if (fuzzyMatch) {
          newContent = newContent.replace(fuzzyMatch, '');
          newContent = newContent.replace(/\n{3,}/g, '\n\n');
          warning = 'Exacte tekst niet gevonden, fuzzy match gebruikt';
        } else {
          // Find which later stage might have overwritten this text
          const overwritingStages = findPossibleOverwritingStages(stageId, change.proposed, stageResults);
          let errorMsg = 'Toegevoegde tekst niet gevonden in rapport';
          if (overwritingStages.length > 0) {
            errorMsg += ` - waarschijnlijk overschreven door: ${overwritingStages.join(', ')}`;
          } else {
            errorMsg += ' - mogelijk al overschreven door een latere wijziging';
          }
          return {
            success: false,
            error: errorMsg
          };
        }
      }
    } else if (change.changeType === 'delete' && change.original) {
      // Case 3: Delete - add back the deleted text
      // This is trickier - we need to know where to insert
      // For now, we'll add it at the section location if specified
      warning = 'Delete rollback voegt tekst toe aan einde van sectie (locatie kan afwijken)';

      // Try to find the section and append
      if (change.section && change.section !== 'Algemeen') {
        const sectionPattern = new RegExp(`(${escapeRegex(change.section)}[^\n]*\n)`, 'i');
        const match = newContent.match(sectionPattern);
        if (match && match.index !== undefined) {
          const insertPos = match.index + match[0].length;
          newContent = newContent.slice(0, insertPos) + change.original + '\n' + newContent.slice(insertPos);
        } else {
          // Append to end
          newContent = newContent + '\n\n' + change.original;
        }
      } else {
        newContent = newContent + '\n\n' + change.original;
      }
    } else {
      return {
        success: false,
        error: `Rollback niet ondersteund voor change type: ${change.changeType}`
      };
    }

    // 6. Save the new version and track rolled back change
    const newVersion = latestVersion + 1;
    const changeKey = `${stageId}-${changeIndex}`;

    // Get existing rolled back changes tracking
    const existingRolledBack = (report.rolledBackChanges || {}) as Record<string, { rolledBackAt: string }>;

    const updatedVersions = {
      ...conceptVersions,
      latest: {
        v: newVersion,
        content: newContent,
        from: 'rollback',
        rollbackInfo: {
          stageId,
          changeIndex,
          rolledBackAt: new Date().toISOString(),
        }
      }
    };

    await storage.updateReport(reportId, {
      conceptReportVersions: updatedVersions,
      rolledBackChanges: {
        ...existingRolledBack,
        [changeKey]: {
          rolledBackAt: new Date().toISOString(),
        }
      }
    });

    console.log(`🔄 Rollback successful for ${stageId} change #${changeIndex}, new version: v${newVersion}`);

    return {
      success: true,
      newContent,
      newVersion,
      warning,
    };

  } catch (error) {
    console.error('Rollback error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Onbekende fout bij rollback',
    };
  }
}

/**
 * Find a fuzzy match in content based on first N characters
 */
function findFuzzyMatch(content: string, target: string, prefixLength: number): string | null {
  if (!target || target.length < prefixLength) {
    return null;
  }

  const prefix = target.substring(0, prefixLength);
  const startIndex = content.indexOf(prefix);

  if (startIndex === -1) {
    return null;
  }

  // Try to match a reasonable chunk after the prefix
  // Look for the end of the sentence or paragraph
  const endPatterns = ['\n\n', '.\n', '. ', '\n'];
  let endIndex = content.length;

  for (const pattern of endPatterns) {
    const idx = content.indexOf(pattern, startIndex + prefixLength);
    if (idx !== -1 && idx < endIndex) {
      endIndex = idx + (pattern === '\n\n' ? 0 : pattern.length - 1);
    }
  }

  // Don't match more than 2x the target length
  const maxLength = target.length * 2;
  if (endIndex - startIndex > maxLength) {
    endIndex = startIndex + maxLength;
  }

  return content.substring(startIndex, endIndex);
}

/**
 * Escape special regex characters
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find which later stages might have overwritten the text
 * Returns stage names that:
 * 1. Come after the current stage in REVIEW_STAGES order
 * 2. Have completed (have results in stageResults)
 * 3. Have changes that might affect this text (check if proposed text contains similar content)
 */
function findPossibleOverwritingStages(
  currentStageId: string,
  targetText: string,
  stageResults: Record<string, string>
): string[] {
  const overwritingStages: string[] = [];

  // Find position of current stage in REVIEW_STAGES
  const currentIndex = REVIEW_STAGES.indexOf(currentStageId as any);
  if (currentIndex === -1) return [];

  // Check each later stage
  for (let i = currentIndex + 1; i < REVIEW_STAGES.length; i++) {
    const laterStageId = REVIEW_STAGES[i];
    const laterRawFeedback = stageResults[laterStageId];

    if (!laterRawFeedback) continue; // Stage not executed

    // Parse later stage's changes
    const laterStageName = STAGE_NAMES[laterStageId] || laterStageId;
    const laterProposals = parseFeedbackToProposals(laterRawFeedback, laterStageName, laterStageId);

    // Check if any change in later stage might have modified this text
    // Look for overlap: if target text's first 30 chars appear in any original or proposed text
    const targetPrefix = targetText.substring(0, 30).toLowerCase();

    const hasOverlap = laterProposals.some(proposal => {
      const originalLower = (proposal.original || '').toLowerCase();
      const proposedLower = (proposal.proposed || '').toLowerCase();

      // Check if the target text was modified by this later stage
      return originalLower.includes(targetPrefix) ||
             proposedLower.includes(targetPrefix) ||
             targetPrefix.includes(originalLower.substring(0, 30)) ||
             targetPrefix.includes(proposedLower.substring(0, 30));
    });

    if (hasOverlap) {
      overwritingStages.push(laterStageName);
    }
  }

  return overwritingStages;
}

/**
 * Get all rollbackable changes for a stage
 */
export async function getRollbackableChanges(
  reportId: string,
  stageId: string
): Promise<{ changes: ChangeProposal[]; error?: string }> {
  try {
    const report = await storage.getReport(reportId);
    if (!report) {
      return { changes: [], error: 'Rapport niet gevonden' };
    }

    const stageResults = (report.stageResults || {}) as Record<string, string>;
    const rawFeedback = stageResults[stageId];
    if (!rawFeedback) {
      return { changes: [], error: `Geen resultaat voor stage ${stageId}` };
    }

    const stageName = STAGE_NAMES[stageId] || stageId;
    const proposals = parseFeedbackToProposals(rawFeedback, stageName, stageId);

    return { changes: proposals };
  } catch (error) {
    return {
      changes: [],
      error: error instanceof Error ? error.message : 'Fout bij ophalen changes'
    };
  }
}
