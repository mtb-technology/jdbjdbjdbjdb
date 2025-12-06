/**
 * Server-side feedback summarizer for Express Mode
 * Extracts change summaries from reviewer feedback JSON
 */

import { STAGE_NAMES } from '@shared/constants';
import type { ExpressModeChange, ExpressModeStageSummary } from '@shared/types/api';

interface FeedbackItem {
  // Common fields across different feedback formats
  locatie?: string;
  sectie?: string;
  section?: string;
  location?: string;

  probleem?: string;
  issue?: string;
  description?: string;

  correctie_aanbeveling?: string;
  aanbeveling?: string;
  recommendation?: string;
  proposed?: string;
  nieuw?: string;

  type_fout?: string;
  type?: string;
  changeType?: string;
  actie?: string;

  bevinding_categorie?: string;
  probleem_categorie?: string;
  severity?: string;
  priority?: string;

  reasoning?: string;
  reden?: string;
  toelichting?: string;
}

/**
 * Parse raw feedback output into a stage summary
 */
export function summarizeFeedback(
  stageId: string,
  rawFeedback: string,
  processingTimeMs?: number
): ExpressModeStageSummary {
  const stageName = STAGE_NAMES[stageId] || stageId;
  const changes: ExpressModeChange[] = [];

  try {
    // Extract JSON from markdown code blocks if present
    let jsonContent = rawFeedback.trim();

    const codeBlockPatterns = [
      /```json\s*([\s\S]*?)```/,
      /```\s*([\s\S]*?)```/,
    ];

    for (const pattern of codeBlockPatterns) {
      const match = jsonContent.match(pattern);
      if (match) {
        jsonContent = match[1].trim();
        break;
      }
    }

    // Try to parse as JSON
    if (jsonContent.startsWith('{') || jsonContent.startsWith('[')) {
      const parsed = JSON.parse(jsonContent);
      const items = extractFeedbackItems(parsed);

      items.forEach((item, idx) => {
        const change = convertToChange(item, idx);
        if (change) {
          changes.push(change);
        }
      });
    }
  } catch (e) {
    // If JSON parsing fails, try to extract from plain text
    const textChanges = extractFromPlainText(rawFeedback);
    changes.push(...textChanges);
  }

  return {
    stageId,
    stageName,
    changesCount: changes.length,
    changes,
    processingTimeMs,
  };
}

/**
 * Extract feedback items from various JSON structures
 */
function extractFeedbackItems(parsed: any): FeedbackItem[] {
  // Direct array
  if (Array.isArray(parsed)) {
    return parsed;
  }

  // Common nested structures
  const possibleArrayPaths = [
    'bevindingen',
    'proposals',
    'changes',
    'wijzigingen',
    'items',
    'fiscaal_technische_validatie.bevindingen',
    'bronnen_validatie.bevindingen',
    'communicatie_review.bevindingen',
  ];

  for (const path of possibleArrayPaths) {
    const parts = path.split('.');
    let value = parsed;

    for (const part of parts) {
      value = value?.[part];
    }

    if (Array.isArray(value)) {
      return value;
    }
  }

  // Single object (wrap in array)
  if (typeof parsed === 'object' && parsed !== null) {
    return [parsed];
  }

  return [];
}

/**
 * Convert a feedback item to an ExpressModeChange
 */
function convertToChange(item: FeedbackItem, index: number): ExpressModeChange | null {
  // Extract description
  const description =
    item.correctie_aanbeveling ||
    item.aanbeveling ||
    item.recommendation ||
    item.proposed ||
    item.nieuw ||
    item.probleem ||
    item.issue ||
    item.description ||
    '';

  if (!description || description.length < 3) {
    return null;
  }

  // Determine change type
  const typeIndicators = (
    item.type_fout ||
    item.type ||
    item.changeType ||
    item.actie ||
    ''
  ).toLowerCase();

  let type: ExpressModeChange['type'] = 'modify';
  if (typeIndicators.includes('toevoeg') || typeIndicators.includes('add') || typeIndicators.includes('insert')) {
    type = 'add';
  } else if (typeIndicators.includes('verwijder') || typeIndicators.includes('delete') || typeIndicators.includes('remove')) {
    type = 'delete';
  } else if (typeIndicators.includes('herstructur') || typeIndicators.includes('restructure') || typeIndicators.includes('reorgani')) {
    type = 'restructure';
  }

  // Determine severity
  const severityIndicators = (
    item.bevinding_categorie ||
    item.probleem_categorie ||
    item.severity ||
    item.priority ||
    item.type_fout ||
    ''
  ).toLowerCase();

  let severity: ExpressModeChange['severity'] = 'suggestion';
  if (
    severityIndicators.includes('kritiek') ||
    severityIndicators.includes('critical') ||
    severityIndicators.includes('verouderd') ||
    severityIndicators.includes('fout') ||
    severityIndicators.includes('error')
  ) {
    severity = 'critical';
  } else if (
    severityIndicators.includes('belangrijk') ||
    severityIndicators.includes('important') ||
    severityIndicators.includes('onnauwkeurig') ||
    severityIndicators.includes('warning')
  ) {
    severity = 'important';
  }

  // Extract section
  const section =
    item.locatie ||
    item.sectie ||
    item.section ||
    item.location ||
    undefined;

  return {
    type,
    description: truncate(description, 200),
    severity,
    section: section ? truncate(section, 100) : undefined,
  };
}

/**
 * Extract changes from plain text feedback (fallback)
 */
function extractFromPlainText(text: string): ExpressModeChange[] {
  const changes: ExpressModeChange[] = [];
  const lines = text.split('\n').filter(l => l.trim());

  // Look for bullet points or numbered items
  const itemPattern = /^[\s]*[-•*]\s*(.+)|^[\s]*\d+[.)]\s*(.+)/;

  lines.forEach((line, idx) => {
    const match = line.match(itemPattern);
    if (match) {
      const content = match[1] || match[2];
      if (content && content.length > 10) {
        changes.push({
          type: 'modify',
          description: truncate(content.trim(), 200),
          severity: detectSeverityFromText(content),
        });
      }
    }
  });

  // If no bullet points found but text exists, create a generic summary
  if (changes.length === 0 && text.length > 50) {
    changes.push({
      type: 'modify',
      description: truncate(text, 200),
      severity: 'suggestion',
    });
  }

  return changes;
}

/**
 * Detect severity from text content
 */
function detectSeverityFromText(text: string): ExpressModeChange['severity'] {
  const lower = text.toLowerCase();

  if (
    lower.includes('kritiek') ||
    lower.includes('fout') ||
    lower.includes('incorrect') ||
    lower.includes('onjuist')
  ) {
    return 'critical';
  }

  if (
    lower.includes('belangrijk') ||
    lower.includes('aanbeveling') ||
    lower.includes('moet') ||
    lower.includes('should')
  ) {
    return 'important';
  }

  return 'suggestion';
}

/**
 * Truncate string to max length
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}
