/**
 * Shared feedback parser for both client and server
 * Extracts structured change proposals from AI reviewer feedback
 */

// ===== TYPES =====

export interface ChangeProposal {
  id: string;
  specialist: string;
  changeType: 'add' | 'modify' | 'delete' | 'restructure';
  section: string;
  original: string;
  proposed: string;
  reasoning: string;
  severity: 'critical' | 'important' | 'suggestion';
  userDecision?: 'accept' | 'reject' | 'modify';
  userNote?: string;
}

// ===== MAIN PARSER =====

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

  // Try multiple patterns for code blocks (order matters - most specific first)
  const codeBlockPatterns = [
    /```json\s*([\s\S]*?)```/,     // ```json ... ```
    /```\s*json\s*([\s\S]*?)```/,  // ``` json ... ``` (space before json)
    /```\s*([\s\S]*?)```/,          // ``` ... ```
    /`json\s*([\s\S]*?)`/,          // `json ... `
  ];

  for (const pattern of codeBlockPatterns) {
    const match = jsonContent.match(pattern);
    if (match) {
      jsonContent = match[1].trim();
      // Remove any leading "json" text that might have been captured
      if (jsonContent.toLowerCase().startsWith('json')) {
        jsonContent = jsonContent.substring(4).trim();
      }
      break;
    }
  }

  // Also try to find JSON object/array anywhere in the content if not found yet
  if (!jsonContent.startsWith('{') && !jsonContent.startsWith('[')) {
    // Look for first { or [ and extract from there to matching closing bracket
    const jsonStartBrace = rawFeedback.indexOf('{');
    const jsonStartBracket = rawFeedback.indexOf('[');

    let jsonStart = -1;
    if (jsonStartBrace >= 0 && jsonStartBracket >= 0) {
      jsonStart = Math.min(jsonStartBrace, jsonStartBracket);
    } else if (jsonStartBrace >= 0) {
      jsonStart = jsonStartBrace;
    } else if (jsonStartBracket >= 0) {
      jsonStart = jsonStartBracket;
    }

    if (jsonStart >= 0) {
      // Find the matching closing bracket/brace
      const startChar = rawFeedback[jsonStart];
      const endChar = startChar === '{' ? '}' : ']';
      let depth = 0;
      let jsonEnd = -1;

      for (let i = jsonStart; i < rawFeedback.length; i++) {
        if (rawFeedback[i] === startChar) depth++;
        if (rawFeedback[i] === endChar) depth--;
        if (depth === 0) {
          jsonEnd = i + 1;
          break;
        }
      }

      if (jsonEnd > jsonStart) {
        jsonContent = rawFeedback.substring(jsonStart, jsonEnd).trim();
      }
    }
  }

  // Try to detect if feedback is already structured (JSON)
  if (jsonContent.startsWith('{') || jsonContent.startsWith('[')) {
    try {
      const parsed = JSON.parse(jsonContent);

      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((p, idx) => normalizeProposal(p, specialist, stageId, idx))
          .filter((p): p is ChangeProposal => p !== null);
        return normalized;
      } else if (parsed.proposals && Array.isArray(parsed.proposals)) {
        const normalized = parsed.proposals
          .map((p: any, idx: number) => normalizeProposal(p, specialist, stageId, idx))
          .filter((p: ChangeProposal | null): p is ChangeProposal => p !== null);
        return normalized;
      } else if (parsed.bevindingen && Array.isArray(parsed.bevindingen)) {
        const normalized = parsed.bevindingen
          .map((p: any, idx: number) => normalizeProposal(p, specialist, stageId, idx))
          .filter((p: ChangeProposal | null): p is ChangeProposal => p !== null);
        return normalized;
      } else if (parsed.fiscaal_technische_validatie?.bevindingen && Array.isArray(parsed.fiscaal_technische_validatie.bevindingen)) {
        // 4c ScenarioGatenAnalist nested format
        const bevindingen = parsed.fiscaal_technische_validatie.bevindingen;
        const proposals: ChangeProposal[] = [];

        // Parse bevindingen
        bevindingen.forEach((b: any, idx: number) => {
          const severity: ChangeProposal['severity'] =
            b.type_fout?.toLowerCase().includes('kritiek') || b.type_fout?.toLowerCase().includes('regel') ? 'critical' :
            b.type_fout?.toLowerCase().includes('cijfer') || b.type_fout?.toLowerCase().includes('hallucinatie') ? 'important' :
            'suggestion';

          proposals.push({
            id: `${stageId}-bevinding-${idx}`,
            specialist,
            changeType: 'modify',
            section: b.locatie?.substring(0, 100) || `Bevinding ${b.nummer || idx + 1}`,
            original: '',
            proposed: b.correctie_aanbeveling || b.probleem || '',
            reasoning: b.probleem || '',
            severity
          });
        });

        // Parse impliciete_aannames if present
        if (parsed.impliciete_aannames && Array.isArray(parsed.impliciete_aannames)) {
          parsed.impliciete_aannames.forEach((aanname: string, idx: number) => {
            proposals.push({
              id: `${stageId}-aanname-${idx}`,
              specialist,
              changeType: 'add',
              section: 'Impliciete Aannames',
              original: '',
              proposed: aanname,
              reasoning: 'Impliciete aanname geïdentificeerd door specialist',
              severity: 'important'
            });
          });
        }

        // Parse grootste_risico if present
        if (parsed.grootste_risico) {
          proposals.push({
            id: `${stageId}-risico`,
            specialist,
            changeType: 'add',
            section: parsed.grootste_risico.titel || 'Grootste Risico',
            original: '',
            proposed: parsed.grootste_risico.omschrijving || '',
            reasoning: 'Kritiek risico geïdentificeerd door specialist',
            severity: 'critical'
          });
        }

        return proposals;
      }
    } catch (e) {
      // Not JSON, continue with text parsing
    }
  }

  // STRATEGY 0: Look for "Sectie:" blocks - used by some reviewers (4c ScenarioGatenAnalist)
  const sectiePattern = /^Sectie:\s*(.+?)$/gm;
  const sectieMatches = Array.from(rawFeedback.matchAll(sectiePattern));

  if (sectieMatches.length >= 1) {
    for (let i = 0; i < sectieMatches.length; i++) {
      const startIndex = sectieMatches[i].index!;
      let endIndex = rawFeedback.length;

      if (i < sectieMatches.length - 1) {
        endIndex = sectieMatches[i + 1].index!;
      }

      // Also check for "***" followed by "### " which indicates a meta-section
      const metaSectionMatch = rawFeedback.substring(startIndex, endIndex).match(/\n\*\*\*\n+###\s+/);
      if (metaSectionMatch && metaSectionMatch.index) {
        endIndex = startIndex + metaSectionMatch.index;
      }

      const sectionBlock = rawFeedback.substring(startIndex, endIndex).trim();
      const sectionTitle = sectieMatches[i][1].trim();

      // Extract "Reden:" if present
      const redenMatch = sectionBlock.match(/\n\s*Reden:\s*([\s\S]+?)(?=\n\s*(?:Voeg|Vervang|Verwijder)|$)/i);
      const reden = redenMatch ? redenMatch[1].trim() : '';

      // Extract the suggested action
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

      const titleMatch = metaBlock.match(/^###\s+(.+?)$/m);
      const title = titleMatch ? titleMatch[1].trim() : `Aanvullend ${i + 1}`;

      const contentStart = metaBlock.indexOf('\n');
      const content = contentStart > -1 ? metaBlock.substring(contentStart).trim() : metaBlock;

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
      }
    }

    if (proposals.length > 0) {
      return proposals;
    }
  }

  // STRATEGY 1: Look for numbered section blocks (### 1. ... ### 2. ...)
  const numberedSectionPattern = /^###\s*(\d+)\.\s*/gm;
  const numberedSectionMatches = Array.from(rawFeedback.matchAll(numberedSectionPattern));

  if (numberedSectionMatches.length >= 2) {
    for (let i = 0; i < numberedSectionMatches.length; i++) {
      const startIndex = numberedSectionMatches[i].index!;
      const endIndex = i < numberedSectionMatches.length - 1
        ? numberedSectionMatches[i + 1].index!
        : rawFeedback.length;
      const sectionBlock = rawFeedback.substring(startIndex, endIndex);

      const titleMatch = sectionBlock.match(/^###\s*\d+\.\s*(.+?)(?:\n|$)/);
      const title = titleMatch ? titleMatch[1].trim() : `Item ${i + 1}`;

      let severity: ChangeProposal['severity'] = 'suggestion';
      if (sectionBlock.toLowerCase().includes('kritiek') || sectionBlock.toLowerCase().includes('critical') || sectionBlock.toLowerCase().includes('cruciaal')) {
        severity = 'critical';
      } else if (sectionBlock.toLowerCase().includes('belangrijk') || sectionBlock.toLowerCase().includes('important')) {
        severity = 'important';
      }

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
      }
    }

    if (proposals.length > 0) {
      return proposals;
    }
  }

  // STRATEGY 2: Look for "Bevinding #N" blocks
  const bevindingPattern = /(?:###?\s*|^\*\*\s*)Bevinding\s+#(\d+)/gim;
  const bevindingMatches = Array.from(rawFeedback.matchAll(bevindingPattern));

  if (bevindingMatches.length > 0) {
    for (let i = 0; i < bevindingMatches.length; i++) {
      const startIndex = bevindingMatches[i].index!;
      const endIndex = i < bevindingMatches.length - 1 ? bevindingMatches[i + 1].index! : rawFeedback.length;
      const bevindingBlock = rawFeedback.substring(startIndex, endIndex);

      const locatieMatch = bevindingBlock.match(/\*\*Locatie[^:]*:\*\*\s*([\s\S]+?)(?=\n+\*\*|$)/);
      const typeMatch = bevindingBlock.match(/\*\*Type\s+Fout[^:]*:\*\*\s*(.+?)(?=\n+\*\*|$)/);
      const probleemMatch = bevindingBlock.match(/\*\*Probleem[^:]*:\*\*\s*([\s\S]+?)(?=\n+\*\*|$)/);
      const correctieMatch = bevindingBlock.match(/\*\*Correctie[^:]*:\*\*\s*([\s\S]+?)(?=\n+---|\n+\*\*Bevinding|$)/i);

      if (locatieMatch && (probleemMatch || correctieMatch)) {
        const locatie = locatieMatch[1].trim();
        const probleem = probleemMatch ? probleemMatch[1].trim() : '';
        const correctie = correctieMatch ? correctieMatch[1].trim() : '';
        const typeFout = typeMatch ? typeMatch[1].trim().toLowerCase() : '';

        let severity: ChangeProposal['severity'] = 'suggestion';
        if (typeFout.includes('regel') || typeFout.includes('critical') || typeFout.includes('kritiek')) {
          severity = 'critical';
        } else if (typeFout.includes('cijfer') || typeFout.includes('important') || typeFout.includes('belangrijk') || typeFout.includes('onnauwkeurig')) {
          severity = 'important';
        }

        const proposal = finalizeProposal({
          section: locatie.substring(0, 100),
          proposed: correctie || probleem,
          original: '',
          reasoning: probleem,
          changeType: 'modify',
          severity
        }, specialist, stageId, i);

        if (proposal) {
          proposals.push(proposal);
        }
      }
    }

    if (proposals.length > 0) {
      return proposals;
    }
  }

  // FALLBACK: Original text parsing for other formats
  const lines = rawFeedback.split('\n');
  let currentProposal: Partial<ChangeProposal> | null = null;
  let proposalCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (currentProposal && currentProposal.proposed && currentProposal.proposed.length >= 10) {
        proposals.push(finalizeProposal(currentProposal, specialist, stageId, proposalCounter++));
        currentProposal = null;
      }
      continue;
    }

    // Skip status lines and markdown headers
    if (trimmed.startsWith('**Status:') || trimmed.startsWith('*Status:') ||
        trimmed.startsWith('**Overige') || trimmed.startsWith('**Locatie') ||
        trimmed.startsWith('**Type') || trimmed.startsWith('**Probleem') ||
        trimmed.startsWith('**Correctie') || trimmed.startsWith('Hieronder volgen')) {
      continue;
    }

    // Detect numbered items
    const numberedMatch = trimmed.match(/^(\d+)\.\s*(.+)/);
    if (numberedMatch && !trimmed.includes('Bevinding')) {
      const content = numberedMatch[2];
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

    // Detect bullet points
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

    // Append to current proposal
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

// ===== HELPER FUNCTIONS =====

function normalizeProposal(
  data: any,
  specialist: string,
  stageId: string,
  index: number
): ChangeProposal | null {
  // Check if this looks like a real change proposal
  const hasChangeIdentifier = data.bevinding_id || data.change_type || data.changeType || data.type;
  const hasContentFields = data.suggestie_tekst || data.proposed || data.new || data.suggestion || data.instructie || data.herschreven_tekst;
  const hasLocationOrSection = data.locatie_origineel || data.section;

  // Reject if it's missing critical fields
  if (!hasChangeIdentifier && !hasContentFields) {
    return null;
  }

  // Map change type
  const changeType = (data.change_type || data.changeType || data.type || 'REPLACE').toUpperCase();
  const mappedChangeType: ChangeProposal['changeType'] =
    changeType === 'ADD' || changeType === 'TOEVOEGEN' ? 'add' :
    changeType === 'DELETE' || changeType === 'VERWIJDER' ? 'delete' :
    changeType === 'RESTRUCTURE' || changeType === 'HERSTRUCTUREER' ? 'restructure' :
    'modify';

  // Map severity
  const severityStr = (data.bevinding_categorie || data.probleem_categorie || data.severity || data.priority || 'suggestion').toLowerCase();
  const mappedSeverity: ChangeProposal['severity'] =
    severityStr.includes('verouderd') || severityStr.includes('critical') || severityStr.includes('kritiek') ? 'critical' :
    severityStr.includes('onnauwkeurig') || severityStr.includes('important') || severityStr.includes('belangrijk') || severityStr.includes('toon') ? 'important' :
    'suggestion';

  // Extract proposed text
  const proposed = data.herschreven_tekst || data.suggestie_tekst || data.proposed || data.new || data.suggestion || data.instructie || '';

  // Skip if proposal is too short
  if (proposed.length < 10) {
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

// ===== SERIALIZATION FUNCTIONS =====

/**
 * Convert change proposals with user decisions to filtered JSON for Editor
 * Only returns accepted and modified proposals (rejects are filtered out)
 */
export function serializeProposalsToJSON(proposals: ChangeProposal[]): string {
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
