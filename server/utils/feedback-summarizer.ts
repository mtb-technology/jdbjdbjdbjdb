/**
 * Server-side feedback summarizer for Express Mode
 * Uses shared parser for consistent feedback extraction across client and server
 */

import { getStageName } from '@shared/constants';
import { parseFeedbackToProposals, type ChangeProposal } from '@shared/lib/parse-feedback';
import type { ExpressModeChange, ExpressModeStageSummary } from '@shared/types/api';

/**
 * Parse raw feedback output into a stage summary
 * Uses the shared parseFeedbackToProposals function for consistent parsing
 */
export function summarizeFeedback(
  stageId: string,
  rawFeedback: string,
  processingTimeMs?: number
): ExpressModeStageSummary {
  const stageName = getStageName(stageId);

  // Use shared parser to extract proposals
  const proposals = parseFeedbackToProposals(rawFeedback, stageName, stageId);

  // Convert ChangeProposal[] to ExpressModeChange[]
  const changes: ExpressModeChange[] = proposals.map(proposal => convertProposalToChange(proposal));

  return {
    stageId,
    stageName,
    changesCount: changes.length,
    changes,
    processingTimeMs,
  };
}

/**
 * Convert a ChangeProposal to an ExpressModeChange
 * Includes original text and reasoning for better UI display
 */
function convertProposalToChange(proposal: ChangeProposal): ExpressModeChange {
  return {
    type: proposal.changeType,
    description: truncate(proposal.proposed || proposal.reasoning, 300),
    severity: proposal.severity,
    section: proposal.section !== 'Algemeen' ? truncate(proposal.section, 100) : undefined,
    original: proposal.original ? truncate(proposal.original, 300) : undefined,
    reasoning: proposal.reasoning ? truncate(proposal.reasoning, 200) : undefined,
  };
}

/**
 * Truncate string to max length
 */
function truncate(str: string, maxLength: number): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}
