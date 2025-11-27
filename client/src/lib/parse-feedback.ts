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

  // Extract JSON from markdown code blocks if present
  let jsonContent = rawFeedback.trim();

  // Try multiple patterns for code blocks
  const codeBlockPatterns = [
    /```json\s*([\s\S]*?)```/,  // ```json ... ```
    /```\s*([\s\S]*?)```/,       // ``` ... ```
    /`json\s*([\s\S]*?)`/,       // `json ... `
  ];

  for (const pattern of codeBlockPatterns) {
    const match = jsonContent.match(pattern);
    if (match) {
      jsonContent = match[1].trim();
      console.log('[parseFeedbackToProposals] Extracted JSON from code block:', jsonContent.substring(0, 200));
      break;
    }
  }

  // Try to detect if feedback is already structured (JSON)
  if (jsonContent.startsWith('{') || jsonContent.startsWith('[')) {
    try {
      console.log('[parseFeedbackToProposals] Attempting to parse JSON...');
      const parsed = JSON.parse(jsonContent);
      console.log('[parseFeedbackToProposals] Successfully parsed JSON:', parsed);

      if (Array.isArray(parsed)) {
        console.log(`[parseFeedbackToProposals] Found array with ${parsed.length} proposals`);
        const normalized = parsed
          .map((p, idx) => normalizeProposal(p, specialist, stageId, idx))
          .filter((p): p is ChangeProposal => p !== null); // Filter out null values
        console.log(`[parseFeedbackToProposals] After filtering: ${normalized.length} valid proposals`);
        return normalized;
      } else if (parsed.proposals && Array.isArray(parsed.proposals)) {
        console.log(`[parseFeedbackToProposals] Found proposals array with ${parsed.proposals.length} items`);
        const normalized = parsed.proposals
          .map((p: any, idx: number) => normalizeProposal(p, specialist, stageId, idx))
          .filter((p: ChangeProposal | null): p is ChangeProposal => p !== null); // Filter out null values
        console.log(`[parseFeedbackToProposals] After filtering: ${normalized.length} valid proposals`);
        return normalized;
      } else if (parsed.bevindingen && Array.isArray(parsed.bevindingen)) {
        console.log(`[parseFeedbackToProposals] Found bevindingen array with ${parsed.bevindingen.length} items`);
        const normalized = parsed.bevindingen
          .map((p: any, idx: number) => normalizeProposal(p, specialist, stageId, idx))
          .filter((p: ChangeProposal | null): p is ChangeProposal => p !== null); // Filter out null values
        console.log(`[parseFeedbackToProposals] After filtering: ${normalized.length} valid proposals`);
        return normalized;
      }
    } catch (e) {
      console.error('[parseFeedbackToProposals] Failed to parse JSON feedback:', e);
      console.error('[parseFeedbackToProposals] JSON content:', jsonContent.substring(0, 500));
      // Not JSON, continue with text parsing
    }
  } else {
    console.log('[parseFeedbackToProposals] Content does not start with { or [, using text parser');
  }

  // Parse text-based feedback into proposals
  // Look for structured patterns like "Bevinding #X" blocks or complete change proposals

  // STRATEGY 0: Look for "Sectie:" blocks - used by some reviewers (4c ScenarioGatenAnalist)
  // Each block starts with "Sectie:" and ends at the next "Sectie:" or "***" followed by a new section
  const sectiePattern = /^Sectie:\s*(.+?)$/gm;
  const sectieMatches = Array.from(rawFeedback.matchAll(sectiePattern));

  if (sectieMatches.length >= 1) {
    console.log(`[parseFeedbackToProposals] Found ${sectieMatches.length} "Sectie:" blocks`);

    for (let i = 0; i < sectieMatches.length; i++) {
      const startIndex = sectieMatches[i].index!;
      // Find the end - either next "Sectie:" or next separator pattern that indicates a new logical section
      let endIndex = rawFeedback.length;

      if (i < sectieMatches.length - 1) {
        endIndex = sectieMatches[i + 1].index!;
      }

      // Also check for "***" followed by "### " which indicates a meta-section like "Toe te voegen"
      const metaSectionMatch = rawFeedback.substring(startIndex, endIndex).match(/\n\*\*\*\n+###\s+/);
      if (metaSectionMatch && metaSectionMatch.index) {
        endIndex = startIndex + metaSectionMatch.index;
      }

      const sectionBlock = rawFeedback.substring(startIndex, endIndex).trim();
      const sectionTitle = sectieMatches[i][1].trim();

      // Extract "Reden:" if present
      const redenMatch = sectionBlock.match(/\n\s*Reden:\s*([\s\S]+?)(?=\n\s*(?:Voeg|Vervang|Verwijder)|$)/i);
      const reden = redenMatch ? redenMatch[1].trim() : '';

      // Extract the suggested action (Voeg toe, Vervang, etc.)
      const actionMatch = sectionBlock.match(/\n\s*(Voeg[^:]*:|Vervang[^:]*:|Verwijder[^:]*:)\s*([\s\S]+?)$/i);
      const action = actionMatch ? actionMatch[2].trim() : '';

      // Determine severity
      let severity: ChangeProposal['severity'] = 'suggestion';
      if (sectionBlock.toLowerCase().includes('kritiek') || sectionBlock.toLowerCase().includes('cruciaal') || sectionBlock.toLowerCase().includes('red flag')) {
        severity = 'critical';
      } else if (sectionBlock.toLowerCase().includes('belangrijk')) {
        severity = 'important';
      }

      const proposal = finalizeProposal({
        section: sectionTitle.substring(0, 150),
        proposed: action || reden || sectionBlock,
        original: '',
        reasoning: reden || sectionTitle,
        changeType: 'modify',
        severity
      }, specialist, stageId, i);

      if (proposal && proposal.proposed.length > 20) {
        proposals.push(proposal);
        console.log(`[parseFeedbackToProposals] Created proposal from Sectie block #${i + 1}: "${sectionTitle.substring(0, 50)}..."`);
      }
    }

    // Also look for meta-sections like "### Toe te voegen Impliciete Aannames"
    const metaSectionPattern = /^###\s+(?:Toe te voegen|Het Grootste Risico|Impliciete Aannames)[^\n]*$/gm;
    const metaSectionMatches = Array.from(rawFeedback.matchAll(metaSectionPattern));

    for (let i = 0; i < metaSectionMatches.length; i++) {
      const startIndex = metaSectionMatches[i].index!;
      const endIndex = i < metaSectionMatches.length - 1
        ? metaSectionMatches[i + 1].index!
        : rawFeedback.length;
      const metaBlock = rawFeedback.substring(startIndex, endIndex).trim();

      // Get title
      const titleMatch = metaBlock.match(/^###\s+(.+?)$/m);
      const title = titleMatch ? titleMatch[1].trim() : `Aanvullend ${i + 1}`;

      // Get content after title
      const contentStart = metaBlock.indexOf('\n');
      const content = contentStart > -1 ? metaBlock.substring(contentStart).trim() : metaBlock;

      // These are usually important
      let severity: ChangeProposal['severity'] = 'important';
      if (title.toLowerCase().includes('grootste risico') || title.toLowerCase().includes('blinde vlek')) {
        severity = 'critical';
      }

      const proposal = finalizeProposal({
        section: title.substring(0, 150),
        proposed: content,
        original: '',
        reasoning: title,
        changeType: 'add',
        severity
      }, specialist, stageId, proposals.length);

      if (proposal && proposal.proposed.length > 30) {
        proposals.push(proposal);
        console.log(`[parseFeedbackToProposals] Created proposal from meta-section: "${title.substring(0, 50)}..."`);
      }
    }

    if (proposals.length > 0) {
      console.log(`[parseFeedbackToProposals] Extracted ${proposals.length} Sectie blocks`);
      return proposals;
    }
  }

  // STRATEGY 1: Look for numbered section blocks (### 1. ... ### 2. ...) - used by 4c ScenarioGatenAnalist
  const numberedSectionPattern = /^###\s*(\d+)\.\s*/gm;
  const numberedSectionMatches = Array.from(rawFeedback.matchAll(numberedSectionPattern));

  if (numberedSectionMatches.length >= 2) {
    console.log(`[parseFeedbackToProposals] Found ${numberedSectionMatches.length} numbered section blocks`);

    for (let i = 0; i < numberedSectionMatches.length; i++) {
      const startIndex = numberedSectionMatches[i].index!;
      const endIndex = i < numberedSectionMatches.length - 1
        ? numberedSectionMatches[i + 1].index!
        : rawFeedback.length;
      const sectionBlock = rawFeedback.substring(startIndex, endIndex);

      // Extract section title (first line after ###)
      const titleMatch = sectionBlock.match(/^###\s*\d+\.\s*(.+?)(?:\n|$)/);
      const title = titleMatch ? titleMatch[1].trim() : `Item ${i + 1}`;

      // Look for severity indicators
      let severity: ChangeProposal['severity'] = 'suggestion';
      if (sectionBlock.toLowerCase().includes('kritiek') || sectionBlock.toLowerCase().includes('critical') || sectionBlock.toLowerCase().includes('cruciaal')) {
        severity = 'critical';
      } else if (sectionBlock.toLowerCase().includes('belangrijk') || sectionBlock.toLowerCase().includes('important')) {
        severity = 'important';
      }

      // Get the full content (excluding the title line)
      const contentStart = sectionBlock.indexOf('\n');
      const fullContent = contentStart > -1 ? sectionBlock.substring(contentStart).trim() : sectionBlock;

      const proposal = finalizeProposal({
        section: title.substring(0, 150),
        proposed: fullContent,
        original: '',
        reasoning: title,
        changeType: 'modify',
        severity
      }, specialist, stageId, i);

      if (proposal && proposal.proposed.length > 20) {
        proposals.push(proposal);
        console.log(`[parseFeedbackToProposals] Created proposal from numbered section #${i + 1}`);
      }
    }

    if (proposals.length > 0) {
      console.log(`[parseFeedbackToProposals] Extracted ${proposals.length} numbered sections`);
      return proposals;
    }
  }

  // STRATEGY 2: Look for "Bevinding #N" or "### Bevinding #N" or "**Bevinding #N:**" blocks with complete structure
  // Only create a proposal if we have ALL required fields

  // Updated pattern to match both markdown headers (### Bevinding #1) and bold text (**Bevinding #1:**)
  const bevindingPattern = /(?:###?\s*|^\*\*\s*)Bevinding\s+#(\d+)/gim;
  const bevindingMatches = Array.from(rawFeedback.matchAll(bevindingPattern));

  if (bevindingMatches.length > 0) {
    console.log(`[parseFeedbackToProposals] Found ${bevindingMatches.length} "Bevinding" blocks`);

    // Split feedback into bevinding blocks
    for (let i = 0; i < bevindingMatches.length; i++) {
      const startIndex = bevindingMatches[i].index!;
      const endIndex = i < bevindingMatches.length - 1 ? bevindingMatches[i + 1].index! : rawFeedback.length;
      const bevindingBlock = rawFeedback.substring(startIndex, endIndex);

      // Extract structured fields using markdown bold patterns (more flexible)
      const locatieMatch = bevindingBlock.match(/\*\*Locatie[^:]*:\*\*\s*([\s\S]+?)(?=\n+\*\*|$)/);
      const typeMatch = bevindingBlock.match(/\*\*Type\s+Fout[^:]*:\*\*\s*(.+?)(?=\n+\*\*|$)/);
      const probleemMatch = bevindingBlock.match(/\*\*Probleem[^:]*:\*\*\s*([\s\S]+?)(?=\n+\*\*|$)/);
      const correctieMatch = bevindingBlock.match(/\*\*Correctie[^:]*:\*\*\s*([\s\S]+?)(?=\n+---|\n+\*\*Bevinding|$)/i);

      // Only create proposal if we have substantive content
      if (locatieMatch && (probleemMatch || correctieMatch)) {
        const locatie = locatieMatch[1].trim();
        const probleem = probleemMatch ? probleemMatch[1].trim() : '';
        const correctie = correctieMatch ? correctieMatch[1].trim() : '';
        const typeFout = typeMatch ? typeMatch[1].trim().toLowerCase() : '';

        // Determine severity based on type
        let severity: ChangeProposal['severity'] = 'suggestion';
        if (typeFout.includes('regel') || typeFout.includes('critical') || typeFout.includes('kritiek')) {
          severity = 'critical';
        } else if (typeFout.includes('cijfer') || typeFout.includes('important') || typeFout.includes('belangrijk') || typeFout.includes('onnauwkeurig')) {
          severity = 'important';
        }

        const proposal = finalizeProposal({
          section: locatie.substring(0, 100), // Use location as section
          proposed: correctie || probleem, // Use correction as proposed change
          original: '', // We don't have "old" text in this format
          reasoning: probleem, // Use problem description as reasoning
          changeType: 'modify',
          severity
        }, specialist, stageId, i);

        if (proposal) {
          proposals.push(proposal);
          console.log(`[parseFeedbackToProposals] Created proposal from Bevinding #${i + 1}`);
        }
      } else {
        console.log(`[parseFeedbackToProposals] Skipping incomplete Bevinding block #${i + 1}`);
      }
    }

    if (proposals.length > 0) {
      console.log(`[parseFeedbackToProposals] Extracted ${proposals.length} complete bevindingen`);
      return proposals;
    }
  }

  // FALLBACK: Original text parsing for other formats
  const lines = rawFeedback.split('\n');
  let currentProposal: Partial<ChangeProposal> | null = null;
  let proposalCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      if (currentProposal && currentProposal.proposed && currentProposal.proposed.length >= 10) {
        proposals.push(finalizeProposal(currentProposal, specialist, stageId, proposalCounter++));
        currentProposal = null;
      }
      continue;
    }

    // Skip status lines and markdown headers that aren't real proposals
    if (trimmed.startsWith('**Status:') || trimmed.startsWith('*Status:') ||
        trimmed.startsWith('**Overige') || trimmed.startsWith('**Locatie') ||
        trimmed.startsWith('**Type') || trimmed.startsWith('**Probleem') ||
        trimmed.startsWith('**Correctie') || trimmed.startsWith('Hieronder volgen')) {
      continue;
    }

    // Detect numbered items (1., 2., etc.) - but only if they look like real changes
    const numberedMatch = trimmed.match(/^(\d+)\.\s*(.+)/);
    if (numberedMatch && !trimmed.includes('Bevinding')) {
      const content = numberedMatch[2];
      // Only treat as proposal if it's substantial and looks like a change
      if (content.length > 20 && (content.includes('wijzig') || content.includes('vervang') || content.includes('update') || content.includes('toevoeg'))) {
        if (currentProposal && currentProposal.proposed && currentProposal.proposed.length >= 10) {
          proposals.push(finalizeProposal(currentProposal, specialist, stageId, proposalCounter++));
        }
        currentProposal = {
          section: 'Algemeen',
          proposed: content,
          original: '',
          reasoning: '',
          changeType: 'modify',
          severity: 'suggestion'
        };
      }
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
): ChangeProposal | null {
  // VALIDATION: Only accept objects that have the essential fields for a real change proposal
  // Filter out status text, headers, and other non-change content

  // Check if this looks like a real change proposal
  const hasChangeIdentifier = data.bevinding_id || data.change_type || data.changeType || data.type;
  const hasContentFields = data.suggestie_tekst || data.proposed || data.new || data.suggestion || data.instructie || data.herschreven_tekst;
  const hasLocationOrSection = data.locatie_origineel || data.section;

  // Reject if it's missing critical fields (likely status text or other content)
  if (!hasChangeIdentifier && !hasContentFields) {
    console.log('[normalizeProposal] Skipping non-change content:', JSON.stringify(data).substring(0, 100));
    return null;
  }

  // Map various field name formats to our standard format
  const changeType = (data.change_type || data.changeType || data.type || 'REPLACE').toUpperCase();
  const mappedChangeType: ChangeProposal['changeType'] =
    changeType === 'ADD' || changeType === 'TOEVOEGEN' ? 'add' :
    changeType === 'DELETE' || changeType === 'VERWIJDER' ? 'delete' :
    changeType === 'RESTRUCTURE' || changeType === 'HERSTRUCTUREER' ? 'restructure' :
    'modify';

  // Map severity - support both old and new field names
  const severityStr = (data.bevinding_categorie || data.probleem_categorie || data.severity || data.priority || 'suggestion').toLowerCase();
  const mappedSeverity: ChangeProposal['severity'] =
    severityStr.includes('verouderd') || severityStr.includes('critical') || severityStr.includes('kritiek') ? 'critical' :
    severityStr.includes('onnauwkeurig') || severityStr.includes('important') || severityStr.includes('belangrijk') || severityStr.includes('toon') ? 'important' :
    'suggestion';

  // Extract the actual suggestion/change text - support multiple field names
  const proposed = data.herschreven_tekst || data.suggestie_tekst || data.proposed || data.new || data.suggestion || data.instructie || '';

  // VALIDATION: Skip if the proposal is too short (likely noise)
  if (proposed.length < 10) {
    console.log('[normalizeProposal] Skipping proposal with content too short:', proposed);
    return null;
  }

  return {
    id: data.bevinding_id || data.id || `${stageId}-${index}`,
    specialist: data.validator_naam || data.specialist || specialist,
    changeType: mappedChangeType,
    section: data.locatie_origineel || data.section || 'Algemeen',
    original: data.locatie_origineel || data.original || data.old || '',
    proposed,
    reasoning: data.analyse || data.instructie || data.reasoning || data.reason || data.rationale || 'Geen reden opgegeven',
    severity: mappedSeverity,
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
 * Convert change proposals with user decisions to filtered JSON for Editor
 * Only returns accepted and modified proposals (rejects are filtered out)
 */
export function serializeProposalsToJSON(proposals: ChangeProposal[]): string {
  // Filter to only accepted and modified proposals
  const filteredProposals = proposals
    .filter(p => p.userDecision === 'accept' || p.userDecision === 'modify')
    .map(p => ({
      id: p.id,
      type: p.changeType,
      section: p.section,
      oude_tekst: p.original || '',
      nieuwe_tekst: p.userDecision === 'modify' && p.userNote ? p.userNote : p.proposed,
      rationale: p.reasoning,
      severity: p.severity,
      userModified: p.userDecision === 'modify' ? p.userNote : undefined
    }));

  return JSON.stringify(filteredProposals, null, 2);
}

/**
 * Convert change proposals with user decisions back to text format for API
 * LEGACY: Used for text mode or debugging
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
