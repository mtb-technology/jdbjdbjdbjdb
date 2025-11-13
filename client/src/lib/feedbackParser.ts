/**
 * Feedback Parser - Split AI feedback into discrete selectable items
 *
 * Deze parser analyseert de AI feedback output en split het in discrete items
 * die individueel geselecteerd kunnen worden door de fiscalist.
 *
 * Ondersteunt meerdere formaten:
 * - Genummerde lijsten (1. 2. 3.)
 * - Bullet points (- * •)
 * - Markdown headings (### ####)
 */

export interface FeedbackItem {
  id: string;
  number: number;
  text: string;
  selected: boolean;
  type: 'numbered' | 'bullet' | 'heading' | 'paragraph';
  indentLevel: number;
}

/**
 * Parse feedback into selectable items
 *
 * Strategy:
 * 1. Try numbered list first (most common for structured feedback)
 * 2. Fall back to bullet points
 * 3. Fall back to paragraphs
 */
export function parseFeedback(rawFeedback: string): FeedbackItem[] {
  const items: FeedbackItem[] = [];

  // Clean the feedback
  const cleaned = rawFeedback.trim();

  // Strategy 1: Try numbered list (1. 2. 3. or 1) 2) 3))
  const numberedMatches = cleaned.match(/^\d+[\.)]\s+.+$/gm);
  if (numberedMatches && numberedMatches.length >= 2) {
    numberedMatches.forEach((match, index) => {
      const text = match.replace(/^\d+[\.)]\s+/, '').trim();
      items.push({
        id: `item-${index}`,
        number: index + 1,
        text,
        selected: true, // Default: all selected
        type: 'numbered',
        indentLevel: 0
      });
    });
    return items;
  }

  // Strategy 2: Try bullet points (- * •)
  const bulletMatches = cleaned.match(/^[-*•]\s+.+$/gm);
  if (bulletMatches && bulletMatches.length >= 2) {
    bulletMatches.forEach((match, index) => {
      const text = match.replace(/^[-*•]\s+/, '').trim();
      items.push({
        id: `item-${index}`,
        number: index + 1,
        text,
        selected: true,
        type: 'bullet',
        indentLevel: 0
      });
    });
    return items;
  }

  // Strategy 3: Try markdown headings (### ####)
  const headingMatches = cleaned.match(/^#{1,4}\s+.+$/gm);
  if (headingMatches && headingMatches.length >= 2) {
    headingMatches.forEach((match, index) => {
      const level = (match.match(/^#+/) || [''])[0].length;
      const text = match.replace(/^#+\s+/, '').trim();
      items.push({
        id: `item-${index}`,
        number: index + 1,
        text,
        selected: true,
        type: 'heading',
        indentLevel: level - 1
      });
    });
    return items;
  }

  // Strategy 4: Fall back to paragraphs (split by double newline)
  const paragraphs = cleaned.split(/\n\n+/).filter(p => p.trim().length > 0);
  if (paragraphs.length >= 2) {
    paragraphs.forEach((paragraph, index) => {
      items.push({
        id: `item-${index}`,
        number: index + 1,
        text: paragraph.trim(),
        selected: true,
        type: 'paragraph',
        indentLevel: 0
      });
    });
    return items;
  }

  // Strategy 5: Single item (no splitting possible)
  return [{
    id: 'item-0',
    number: 1,
    text: cleaned,
    selected: true,
    type: 'paragraph',
    indentLevel: 0
  }];
}

/**
 * Reconstruct feedback from selected items
 *
 * Returns a string with only the selected feedback items,
 * maintaining the original format.
 */
export function reconstructFeedback(items: FeedbackItem[]): string {
  const selected = items.filter(item => item.selected);

  if (selected.length === 0) {
    return '';
  }

  // Maintain original format
  return selected.map((item, index) => {
    switch (item.type) {
      case 'numbered':
        return `${index + 1}. ${item.text}`;
      case 'bullet':
        return `- ${item.text}`;
      case 'heading':
        const hashes = '#'.repeat(item.indentLevel + 1);
        return `${hashes} ${item.text}`;
      case 'paragraph':
      default:
        return item.text;
    }
  }).join('\n\n');
}

/**
 * Get summary of selection
 */
export function getSelectionSummary(items: FeedbackItem[]): string {
  const selected = items.filter(item => item.selected).length;
  const total = items.length;

  if (selected === total) {
    return `Alle ${total} feedback items geselecteerd`;
  }

  if (selected === 0) {
    return 'Geen feedback items geselecteerd';
  }

  return `${selected} van ${total} feedback items geselecteerd`;
}
