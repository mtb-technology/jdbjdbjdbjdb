import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextStyler } from '../text-styler';
import { ReportGenerator } from '../report-generator';

describe('TextStyler', () => {
  let textStyler: TextStyler;
  let mockReportGenerator: ReportGenerator;

  beforeEach(() => {
    mockReportGenerator = {} as ReportGenerator;
    textStyler = new TextStyler(mockReportGenerator);
  });

  describe('markdownToTipTap', () => {
    it('should parse basic markdown headings', () => {
      const markdown = '# Heading 1\n## Heading 2\n### Heading 3';
      const result = textStyler.markdownToTipTap(markdown);

      expect(result.type).toBe('doc');
      expect(result.content).toHaveLength(3);
      expect(result.content[0].type).toBe('heading');
      expect(result.content[0].attrs.level).toBe(1);
      expect(result.content[1].type).toBe('heading');
      expect(result.content[1].attrs.level).toBe(2);
      expect(result.content[2].type).toBe('heading');
      expect(result.content[2].attrs.level).toBe(3);
    });

    it('should parse paragraphs', () => {
      const markdown = 'This is a paragraph.\n\nThis is another paragraph.';
      const result = textStyler.markdownToTipTap(markdown);

      expect(result.type).toBe('doc');
      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe('paragraph');
      expect(result.content[1].type).toBe('paragraph');
    });

    it('should parse bold and italic marks', () => {
      const markdown = 'This is **bold** and this is *italic* text.';
      const result = textStyler.markdownToTipTap(markdown);

      expect(result.type).toBe('doc');
      expect(result.content[0].type).toBe('paragraph');

      const content = result.content[0].content;
      const boldNode = content.find((n: any) =>
        n.marks && n.marks.some((m: any) => m.type === 'bold')
      );
      const italicNode = content.find((n: any) =>
        n.marks && n.marks.some((m: any) => m.type === 'italic')
      );

      expect(boldNode).toBeDefined();
      expect(boldNode.text).toContain('bold');
      expect(italicNode).toBeDefined();
      expect(italicNode.text).toContain('italic');
    });

    it('should parse bullet lists', () => {
      const markdown = '- Item 1\n- Item 2\n- Item 3';
      const result = textStyler.markdownToTipTap(markdown);

      expect(result.type).toBe('doc');
      expect(result.content[0].type).toBe('bulletList');
      expect(result.content[0].content).toHaveLength(3);
      expect(result.content[0].content[0].type).toBe('listItem');
    });

    it('should parse ordered lists', () => {
      const markdown = '1. First\n2. Second\n3. Third';
      const result = textStyler.markdownToTipTap(markdown);

      expect(result.type).toBe('doc');
      expect(result.content[0].type).toBe('orderedList');
      expect(result.content[0].content).toHaveLength(3);
      expect(result.content[0].attrs.start).toBe(1);
    });

    it('should parse code blocks', () => {
      const markdown = '```javascript\nconst x = 42;\n```';
      const result = textStyler.markdownToTipTap(markdown);

      expect(result.type).toBe('doc');
      expect(result.content[0].type).toBe('codeBlock');
      expect(result.content[0].attrs.language).toBe('javascript');
      expect(result.content[0].content[0].text).toContain('const x = 42;');
    });

    it('should parse inline code', () => {
      const markdown = 'Use `const` keyword for constants.';
      const result = textStyler.markdownToTipTap(markdown);

      expect(result.type).toBe('doc');
      const content = result.content[0].content;
      const codeNode = content.find((n: any) =>
        n.marks && n.marks.some((m: any) => m.type === 'code')
      );

      expect(codeNode).toBeDefined();
      expect(codeNode.text).toBe('const');
    });

    it('should parse blockquotes', () => {
      const markdown = '> This is a quote\n> with multiple lines';
      const result = textStyler.markdownToTipTap(markdown);

      expect(result.type).toBe('doc');
      expect(result.content[0].type).toBe('blockquote');
      expect(result.content[0].content[0].type).toBe('paragraph');
    });

    it('should parse horizontal rules', () => {
      const markdown = 'Before\n\n---\n\nAfter';
      const result = textStyler.markdownToTipTap(markdown);

      expect(result.type).toBe('doc');
      expect(result.content[1].type).toBe('horizontalRule');
    });

    it('should handle complex nested structures', () => {
      const markdown = `# Main Title

This is a paragraph with **bold** and *italic* text.

## Subsection

- List item 1 with **bold**
- List item 2 with *italic*
- List item 3

1. Numbered item
2. Another item

\`\`\`javascript
const example = true;
\`\`\`

> A wise quote`;

      const result = textStyler.markdownToTipTap(markdown);

      expect(result.type).toBe('doc');
      expect(result.content.length).toBeGreaterThan(5);

      // Check heading
      expect(result.content[0].type).toBe('heading');
      expect(result.content[0].attrs.level).toBe(1);

      // Check that we have various node types
      const types = result.content.map((node: any) => node.type);
      expect(types).toContain('heading');
      expect(types).toContain('paragraph');
      expect(types).toContain('bulletList');
      expect(types).toContain('orderedList');
      expect(types).toContain('codeBlock');
      expect(types).toContain('blockquote');
    });

    it('should handle empty markdown gracefully', () => {
      const result = textStyler.markdownToTipTap('');

      expect(result.type).toBe('doc');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('paragraph');
    });

    it('should handle markdown with only whitespace', () => {
      const result = textStyler.markdownToTipTap('   \n\n   ');

      expect(result.type).toBe('doc');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('paragraph');
    });
  });
});
