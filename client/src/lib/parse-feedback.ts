import type { ChangeProposal } from '@/components/workflow/ChangeProposalCard';

/**
 * Parse raw feedback text into structured change proposals
 * This is a smart parser that tries to identify structured feedback
 */
export function parseFeedbackToProposals(
  rawFeedback: string,
  specialist: string,
  stageId: string
): ChangeProposal[] {
  const proposals: ChangeProposal[] = [];

  // Try to detect if feedback is already structured (JSON)
  if (rawFeedback.trim().startsWith('{') || rawFeedback.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(rawFeedback);
      if (Array.isArray(parsed)) {
        return parsed.map((p, idx) => normalizeProposal(p, specialist, stageId, idx));
      } else if (parsed.proposals && Array.isArray(parsed.proposals)) {
        return parsed.proposals.map((p: any, idx: number) => normalizeProposal(p, specialist, stageId, idx));
      }
    } catch (e) {
      // Not JSON, continue with text parsing
    }
  }

  // Parse text-based feedback into proposals
  // Look for patterns like:
  // 1. CHANGE: ... REASON: ...
  // 2. Section X: ... => ...
  // 3. - Add/Modify/Delete: ...

  const lines = rawFeedback.split('\n');
  let currentProposal: Partial<ChangeProposal> | null = null;
  let proposalCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) {
      if (currentProposal) {
        proposals.push(finalizeProposal(currentProposal, specialist, stageId, proposalCounter++));
        currentProposal = null;
      }
      continue;
    }

    // Detect numbered items (1., 2., etc.)
    const numberedMatch = trimmed.match(/^(\d+)\.\s*(.+)/);
    if (numberedMatch) {
      if (currentProposal) {
        proposals.push(finalizeProposal(currentProposal, specialist, stageId, proposalCounter++));
      }
      currentProposal = {
        section: 'Algemeen',
        proposed: numberedMatch[2],
        original: '',
        reasoning: '',
        changeType: 'modify',
        severity: 'suggestion'
      };
      continue;
    }

    // Detect bullet points (-, *, •)
    const bulletMatch = trimmed.match(/^[-*•]\s*(.+)/);
    if (bulletMatch) {
      if (currentProposal) {
        proposals.push(finalizeProposal(currentProposal, specialist, stageId, proposalCounter++));
      }
      currentProposal = {
        section: 'Algemeen',
        proposed: bulletMatch[1],
        original: '',
        reasoning: '',
        changeType: 'modify',
        severity: 'suggestion'
      };
      continue;
    }

    // Detect section headers
    const sectionMatch = trimmed.match(/^(?:Sectie|Section|Paragraaf|Hoofdstuk)[\s:]+(.+)/i);
    if (sectionMatch && currentProposal) {
      currentProposal.section = sectionMatch[1];
      continue;
    }

    // Detect change types
    const changeTypeMatch = trimmed.match(/^(Toevoegen|Add|Wijzig|Modify|Verwijder|Delete|Herstructureer|Restructure)[\s:]+(.+)/i);
    if (changeTypeMatch) {
      const type = changeTypeMatch[1].toLowerCase();
      const changeType: ChangeProposal['changeType'] = 
        type.includes('add') || type.includes('toevoegen') ? 'add' :
        type.includes('delete') || type.includes('verwijder') ? 'delete' :
        type.includes('restructure') || type.includes('herstructureer') ? 'restructure' :
        'modify';
      
      if (currentProposal) {
        proposals.push(finalizeProposal(currentProposal, specialist, stageId, proposalCounter++));
      }
      
      currentProposal = {
        section: 'Algemeen',
        proposed: changeTypeMatch[2],
        original: '',
        reasoning: '',
        changeType,
        severity: 'suggestion'
      };
      continue;
    }

    // Detect severity keywords
    const severityMatch = trimmed.match(/^(KRITIEK|CRITICAL|BELANGRIJK|IMPORTANT|SUGGESTIE|SUGGESTION)[\s:]+(.+)/i);
    if (severityMatch) {
      const sev = severityMatch[1].toLowerCase();
      const severity: ChangeProposal['severity'] = 
        sev.includes('critical') || sev.includes('kritiek') ? 'critical' :
        sev.includes('important') || sev.includes('belangrijk') ? 'important' :
        'suggestion';
      
      if (currentProposal) {
        currentProposal.severity = severity;
      } else {
        currentProposal = {
          section: 'Algemeen',
          proposed: severityMatch[2],
          original: '',
          reasoning: '',
          changeType: 'modify',
          severity
        };
      }
      continue;
    }

    // Detect reasoning
    const reasonMatch = trimmed.match(/^(?:Reden|Reason|Rationale)[\s:]+(.+)/i);
    if (reasonMatch && currentProposal) {
      currentProposal.reasoning = (currentProposal.reasoning || '') + ' ' + reasonMatch[1];
      continue;
    }

    // Detect before/after patterns
    const beforeAfterMatch = trimmed.match(/^(?:Oud|Old|Before)[\s:]+(.+?)[\s→]+(?:Nieuw|New|After)[\s:]+(.+)/i);
    if (beforeAfterMatch && currentProposal) {
      currentProposal.original = beforeAfterMatch[1];
      currentProposal.proposed = beforeAfterMatch[2];
      continue;
    }

    // If we have a current proposal, append to reasoning or proposed
    if (currentProposal) {
      if (!currentProposal.proposed) {
        currentProposal.proposed = trimmed;
      } else if (!currentProposal.reasoning) {
        currentProposal.reasoning = trimmed;
      } else {
        currentProposal.reasoning += ' ' + trimmed;
      }
    }
  }

  // Finalize last proposal
  if (currentProposal) {
    proposals.push(finalizeProposal(currentProposal, specialist, stageId, proposalCounter++));
  }

  // If no structured proposals found, create one generic proposal
  if (proposals.length === 0) {
    proposals.push({
      id: `${stageId}-0`,
      specialist,
      changeType: 'modify',
      section: 'Algemeen',
      original: '',
      proposed: rawFeedback,
      reasoning: 'Algemene feedback van specialist',
      severity: 'suggestion'
    });
  }

  return proposals;
}

function normalizeProposal(
  data: any,
  specialist: string,
  stageId: string,
  index: number
): ChangeProposal {
  return {
    id: data.id || `${stageId}-${index}`,
    specialist: data.specialist || specialist,
    changeType: data.changeType || data.type || 'modify',
    section: data.section || 'Algemeen',
    original: data.original || data.old || '',
    proposed: data.proposed || data.new || data.suggestion || '',
    reasoning: data.reasoning || data.reason || data.rationale || '',
    severity: data.severity || data.priority || 'suggestion',
    userDecision: data.userDecision,
    userNote: data.userNote
  };
}

function finalizeProposal(
  partial: Partial<ChangeProposal>,
  specialist: string,
  stageId: string,
  index: number
): ChangeProposal {
  return {
    id: `${stageId}-${index}`,
    specialist,
    changeType: partial.changeType || 'modify',
    section: partial.section || 'Algemeen',
    original: partial.original || '',
    proposed: partial.proposed || '',
    reasoning: partial.reasoning || 'Geen specifieke reden opgegeven',
    severity: partial.severity || 'suggestion',
    userDecision: partial.userDecision,
    userNote: partial.userNote
  };
}

/**
 * Convert change proposals with user decisions back to text format for API
 */
export function serializeProposals(proposals: ChangeProposal[]): string {
  const accepted = proposals.filter(p => p.userDecision === 'accept');
  const rejected = proposals.filter(p => p.userDecision === 'reject');
  const modified = proposals.filter(p => p.userDecision === 'modify');

  let result = '';

  if (accepted.length > 0) {
    result += '=== GEACCEPTEERDE WIJZIGINGEN ===\n\n';
    accepted.forEach((p, idx) => {
      result += `${idx + 1}. [${p.section}] ${p.changeType.toUpperCase()}\n`;
      if (p.original) result += `   Oud: ${p.original}\n`;
      result += `   Nieuw: ${p.proposed}\n`;
      result += `   Reden: ${p.reasoning}\n\n`;
    });
  }

  if (modified.length > 0) {
    result += '\n=== AANGEPASTE WIJZIGINGEN ===\n\n';
    modified.forEach((p, idx) => {
      result += `${idx + 1}. [${p.section}] ${p.changeType.toUpperCase()}\n`;
      if (p.original) result += `   Oud: ${p.original}\n`;
      result += `   Nieuw: ${p.proposed}\n`;
      result += `   Reden: ${p.reasoning}\n`;
      if (p.userNote) result += `   Aanpassing gebruiker: ${p.userNote}\n`;
      result += '\n';
    });
  }

  if (rejected.length > 0) {
    result += '\n=== AFGEWEZEN WIJZIGINGEN (NEGEER DEZE) ===\n\n';
    rejected.forEach((p, idx) => {
      result += `${idx + 1}. [${p.section}] - ${p.proposed.substring(0, 100)}...\n`;
    });
  }

  return result;
}
