import { ReportGenerator } from './report-generator.js';
import MarkdownIt from 'markdown-it';

export const DEFAULT_TEXT_STYLE_PROMPT = `Je bent een expert in het formatteren en stylen van teksten voor professionele documenten.

Jouw taak is om de gegeven ruwe tekst om te zetten naar een goed gestructureerde, professioneel opgemaakte tekst.

Belangrijke richtlijnen:
- Gebruik duidelijke koppen en subkoppen waar nodig
- Verdeel de tekst in logische paragrafen
- Gebruik opsommingen of genummerde lijsten waar passend
- Zorg voor een professionele, heldere schrijfstijl
- Behoud de kernboodschap en inhoud van de originele tekst
- Verbeter grammatica en spelling indien nodig
- Zorg voor goede leesbaarheid

Geef je output in Markdown formaat met:
- # voor hoofdkoppen
- ## voor subkoppen
- - voor opsommingen
- **bold** voor belangrijke termen
- *italic* voor nadruk

Antwoord alleen met de geformatteerde tekst, zonder extra uitleg.`;

export class TextStyler {
  private reportGenerator: ReportGenerator;
  private md: MarkdownIt;

  constructor(reportGenerator: ReportGenerator) {
    this.reportGenerator = reportGenerator;
    // Initialize markdown-it with proper configuration
    this.md = new MarkdownIt({
      html: false, // Disable HTML tags for security
      breaks: true, // Convert \n to <br>
      linkify: false, // Don't auto-convert URLs
      typographer: true, // Enable smart quotes and other nice typography
    });
  }

  /**
   * Style raw text using LLM with custom prompt
   */
  async styleText(params: {
    rawText: string;
    stylePrompt: string;
    model: string;
  }): Promise<string> {
    const { rawText, stylePrompt, model } = params;

    // Use the existing report generator to call the LLM
    const result = await this.reportGenerator.generateWithCustomPrompt({
      systemPrompt: stylePrompt,
      userPrompt: rawText,
      model
    });

    return result;
  }

  /**
   * Convert markdown to TipTap JSON format using markdown-it for robust parsing
   */
  markdownToTipTap(markdown: string): any {
    const tokens = this.md.parse(markdown, {});
    const content: any[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // Process block-level tokens
      if (token.type === 'heading_open') {
        const level = parseInt(token.tag.substring(1)); // h1 -> 1, h2 -> 2, etc.
        const contentToken = tokens[i + 1]; // next token is the inline content

        content.push({
          type: 'heading',
          attrs: { level },
          content: this.parseInlineTokens(contentToken.children || [])
        });
        i += 2; // Skip content and closing tokens
      }
      else if (token.type === 'paragraph_open') {
        const contentToken = tokens[i + 1];
        const parsedContent = this.parseInlineTokens(contentToken.children || []);

        // Only add paragraph if it has content
        if (parsedContent.length > 0 && parsedContent.some(node => node.text?.trim())) {
          content.push({
            type: 'paragraph',
            content: parsedContent
          });
        }
        i += 2; // Skip content and closing tokens
      }
      else if (token.type === 'bullet_list_open') {
        const listItems: any[] = [];
        i++; // Move to first list item

        while (i < tokens.length && tokens[i].type !== 'bullet_list_close') {
          if (tokens[i].type === 'list_item_open') {
            const itemContent: any[] = [];
            i++; // Move into list item

            while (i < tokens.length && tokens[i].type !== 'list_item_close') {
              if (tokens[i].type === 'paragraph_open') {
                const contentToken = tokens[i + 1];
                itemContent.push({
                  type: 'paragraph',
                  content: this.parseInlineTokens(contentToken.children || [])
                });
                i += 2; // Skip content and paragraph_close
              } else {
                i++;
              }
            }

            listItems.push({
              type: 'listItem',
              content: itemContent.length > 0 ? itemContent : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }]
            });
          }
          i++;
        }

        if (listItems.length > 0) {
          content.push({
            type: 'bulletList',
            content: listItems
          });
        }
      }
      else if (token.type === 'ordered_list_open') {
        const start = token.attrGet('start');
        const listItems: any[] = [];
        i++; // Move to first list item

        while (i < tokens.length && tokens[i].type !== 'ordered_list_close') {
          if (tokens[i].type === 'list_item_open') {
            const itemContent: any[] = [];
            i++; // Move into list item

            while (i < tokens.length && tokens[i].type !== 'list_item_close') {
              if (tokens[i].type === 'paragraph_open') {
                const contentToken = tokens[i + 1];
                itemContent.push({
                  type: 'paragraph',
                  content: this.parseInlineTokens(contentToken.children || [])
                });
                i += 2; // Skip content and paragraph_close
              } else {
                i++;
              }
            }

            listItems.push({
              type: 'listItem',
              content: itemContent.length > 0 ? itemContent : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }]
            });
          }
          i++;
        }

        if (listItems.length > 0) {
          content.push({
            type: 'orderedList',
            attrs: { start: start ? parseInt(start) : 1 },
            content: listItems
          });
        }
      }
      else if (token.type === 'hr') {
        content.push({
          type: 'horizontalRule'
        });
      }
      else if (token.type === 'code_block' || token.type === 'fence') {
        content.push({
          type: 'codeBlock',
          attrs: { language: token.info || null },
          content: [{ type: 'text', text: token.content }]
        });
      }
      else if (token.type === 'blockquote_open') {
        const blockquoteContent: any[] = [];
        i++; // Move into blockquote

        while (i < tokens.length && tokens[i].type !== 'blockquote_close') {
          if (tokens[i].type === 'paragraph_open') {
            const contentToken = tokens[i + 1];
            blockquoteContent.push({
              type: 'paragraph',
              content: this.parseInlineTokens(contentToken.children || [])
            });
            i += 2;
          } else {
            i++;
          }
        }

        if (blockquoteContent.length > 0) {
          content.push({
            type: 'blockquote',
            content: blockquoteContent
          });
        }
      }
      else if (token.type === 'hardbreak') {
        // Hard breaks are handled within inline parsing
        continue;
      }
    }

    return {
      type: 'doc',
      content: content.length > 0 ? content : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }]
    };
  }

  /**
   * Parse inline markdown tokens (bold, italic, code, etc.) into TipTap format
   */
  private parseInlineTokens(tokens: any[]): any[] {
    const result: any[] = [];
    const markStack: string[] = [];

    for (const token of tokens) {
      if (token.type === 'text') {
        // Create text node with current marks
        const textNode: any = { type: 'text', text: token.content };
        if (markStack.length > 0) {
          textNode.marks = markStack.map(mark => ({ type: mark }));
        }
        result.push(textNode);
      }
      else if (token.type === 'strong_open') {
        markStack.push('bold');
      }
      else if (token.type === 'strong_close') {
        markStack.pop();
      }
      else if (token.type === 'em_open') {
        markStack.push('italic');
      }
      else if (token.type === 'em_close') {
        markStack.pop();
      }
      else if (token.type === 'code_inline') {
        const textNode: any = { type: 'text', text: token.content };
        const marks = [...markStack, 'code'];
        textNode.marks = marks.map(mark => ({ type: mark }));
        result.push(textNode);
      }
      else if (token.type === 'softbreak' || token.type === 'hardbreak') {
        result.push({ type: 'hardBreak' });
      }
      else if (token.type === 's_open') {
        markStack.push('strike');
      }
      else if (token.type === 's_close') {
        markStack.pop();
      }
    }

    // Ensure we have at least an empty text node
    return result.length > 0 ? result : [{ type: 'text', text: '' }];
  }
}
