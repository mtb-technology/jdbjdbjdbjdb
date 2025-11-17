import { describe, it, expect, beforeEach } from 'vitest';
import { TextStyler } from '../text-styler';
import { PDFGenerator } from '../pdf-generator';
import { ReportGenerator } from '../report-generator';

describe('Text Styler Integration - Markdown to PDF', () => {
  let textStyler: TextStyler;
  let pdfGenerator: PDFGenerator;

  beforeEach(() => {
    const mockReportGenerator = {} as ReportGenerator;
    textStyler = new TextStyler(mockReportGenerator);
    pdfGenerator = new PDFGenerator();
  });

  it('should convert markdown with marks to PDF', async () => {
    const markdown = `# Main Title

This is a paragraph with **bold text** and *italic text*.

## Subtitle

Here's a list:
- First item with **bold**
- Second item with *italic*
- Third item with \`code\`

And a numbered list:
1. Item one
2. Item two
3. Item three

> A blockquote with **important** information.

Some inline \`code example\` in text.`;

    // Step 1: Convert markdown to TipTap
    const tipTapContent = textStyler.markdownToTipTap(markdown);

    // Verify TipTap structure
    expect(tipTapContent.type).toBe('doc');
    expect(tipTapContent.content.length).toBeGreaterThan(0);

    // Verify we have headings
    const headings = tipTapContent.content.filter((n: any) => n.type === 'heading');
    expect(headings.length).toBeGreaterThanOrEqual(2);

    // Verify we have lists
    const bulletList = tipTapContent.content.find((n: any) => n.type === 'bulletList');
    expect(bulletList).toBeDefined();
    expect(bulletList.content).toHaveLength(3);

    const orderedList = tipTapContent.content.find((n: any) => n.type === 'orderedList');
    expect(orderedList).toBeDefined();
    expect(orderedList.content).toHaveLength(3);

    // Verify we have blockquote
    const blockquote = tipTapContent.content.find((n: any) => n.type === 'blockquote');
    expect(blockquote).toBeDefined();

    // Verify marks are present
    let hasBoldMark = false;
    let hasItalicMark = false;
    let hasCodeMark = false;

    const checkMarks = (node: any) => {
      if (node.content && Array.isArray(node.content)) {
        for (const child of node.content) {
          if (child.marks) {
            const markTypes = child.marks.map((m: any) => m.type);
            if (markTypes.includes('bold')) hasBoldMark = true;
            if (markTypes.includes('italic')) hasItalicMark = true;
            if (markTypes.includes('code')) hasCodeMark = true;
          }
          checkMarks(child);
        }
      }
    };

    tipTapContent.content.forEach(checkMarks);

    expect(hasBoldMark).toBe(true);
    expect(hasItalicMark).toBe(true);
    expect(hasCodeMark).toBe(true);

    // Step 2: Convert TipTap to PDF
    const pdfBuffer = await pdfGenerator.generateFromTipTap({
      content: tipTapContent,
      title: 'Integration Test Document',
      clientName: 'Test Client'
    });

    // Verify PDF was generated
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);

    // Verify it's a valid PDF
    const pdfHeader = pdfBuffer.slice(0, 4).toString('utf-8');
    expect(pdfHeader).toBe('%PDF');

    // Verify PDF has reasonable size (not empty, not too small)
    expect(pdfBuffer.length).toBeGreaterThan(1000); // At least 1KB
  });

  it('should handle complex nested markdown structures', async () => {
    const markdown = `# Document Title

## Section 1

This section has **bold**, *italic*, and \`code\` formatting.

### Subsection 1.1

- Nested list item 1
- Nested list item 2 with **bold**
  - Would be nested deeper (not supported by basic markdown-it)

## Section 2

1. First numbered item
2. Second numbered item with *emphasis*
3. Third item

\`\`\`javascript
const example = {
  key: "value"
};
\`\`\`

---

> Important note with **bold** text
> spanning multiple lines

Final paragraph.`;

    const tipTapContent = textStyler.markdownToTipTap(markdown);
    const pdfBuffer = await pdfGenerator.generateFromTipTap({
      content: tipTapContent,
      title: 'Complex Document',
      clientName: 'Test Client'
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(2000); // More complex document

    // Verify PDF structure
    const pdfHeader = pdfBuffer.slice(0, 4).toString('utf-8');
    expect(pdfHeader).toBe('%PDF');

    // Verify we have various content types
    const contentTypes = new Set(tipTapContent.content.map((n: any) => n.type));
    expect(contentTypes.has('heading')).toBe(true);
    expect(contentTypes.has('paragraph')).toBe(true);
    expect(contentTypes.has('bulletList')).toBe(true);
    expect(contentTypes.has('orderedList')).toBe(true);
    expect(contentTypes.has('codeBlock')).toBe(true);
    expect(contentTypes.has('horizontalRule')).toBe(true);
    expect(contentTypes.has('blockquote')).toBe(true);
  });

  it('should preserve mark integrity through the pipeline', async () => {
    // Create a document specifically testing mark preservation
    const markdown = `**Bold at start** and middle **bold** and end **bold**

*Italic everywhere* **mixed bold** *and italic*

Inline \`code.here()\` and \`another.code()\` example.`;

    const tipTapContent = textStyler.markdownToTipTap(markdown);

    // Count marks in TipTap
    let boldCount = 0;
    let italicCount = 0;
    let codeCount = 0;

    const countMarks = (node: any) => {
      if (node.content && Array.isArray(node.content)) {
        for (const child of node.content) {
          if (child.marks) {
            const markTypes = child.marks.map((m: any) => m.type);
            if (markTypes.includes('bold')) boldCount++;
            if (markTypes.includes('italic')) italicCount++;
            if (markTypes.includes('code')) codeCount++;
          }
          countMarks(child);
        }
      }
    };

    tipTapContent.content.forEach(countMarks);

    // Verify marks were parsed
    expect(boldCount).toBeGreaterThan(0);
    expect(italicCount).toBeGreaterThan(0);
    expect(codeCount).toBeGreaterThan(0);

    // Generate PDF (should not throw)
    const pdfBuffer = await pdfGenerator.generateFromTipTap({
      content: tipTapContent,
      title: 'Marks Test',
      clientName: 'Test Client'
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(500);
  });

  it('should handle edge cases gracefully', async () => {
    const edgeCases = [
      '', // Empty
      '   \n\n   ', // Whitespace only
      '# Only a heading', // Single heading
      'Just plain text', // Plain text
      '**bold****more bold**', // Consecutive marks
      '*nested **bold** in italic*', // Nested marks (may not work perfectly)
    ];

    for (const markdown of edgeCases) {
      const tipTapContent = textStyler.markdownToTipTap(markdown);
      expect(tipTapContent.type).toBe('doc');
      expect(tipTapContent.content).toBeDefined();

      const pdfBuffer = await pdfGenerator.generateFromTipTap({
        content: tipTapContent,
        title: 'Edge Case Test',
        clientName: 'Test Client'
      });

      expect(pdfBuffer).toBeInstanceOf(Buffer);
      expect(pdfBuffer.length).toBeGreaterThan(0);
    }
  });
});
