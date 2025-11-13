/**
 * ## TESTS: Workflow Parsers - De "Vertalers" van AI Output
 *
 * **Critical Component**: Deze parsers zijn de ENIGE manier waarop we AI output begrijpen.
 * Als deze falen, crasht de hele pipeline.
 *
 * ### Wat wordt getest:
 * 1. Perfect formatted JSON (happy path)
 * 2. Markdown-wrapped JSON (```json ... ```)
 * 3. JSON embedded in text
 * 4. Malformed JSON (edge cases)
 * 5. Stage 1 blocking logic (COMPLEET vs INCOMPLEET)
 * 6. Backward compatibility
 */

import { describe, it, expect } from 'vitest';
import {
  parseInformatieCheckOutput,
  parseBouwplanData,
  isInformatieCheckComplete,
  getStage2BlockReason,
  getSamenvattingFromStage1
} from '../workflowParsers';
import type { InformatieCheckOutput, BouwplanData } from '@shared/schema';

describe('Workflow Parsers - JSON Extraction', () => {
  describe('parseInformatieCheckOutput - Stage 1 Parser', () => {
    it('should parse perfect JSON (happy path)', () => {
      const perfectJSON = JSON.stringify({
        status: 'COMPLEET',
        dossier: {
          samenvatting_onderwerp: 'Test onderwerp',
          klantvraag_verbatim: ['Vraag 1'],
          gestructureerde_data: {
            partijen: ['Klant A'],
            fiscale_partner: true,
            relevante_bedragen: { vermogen: 100000 },
            overige_info: []
          }
        }
      });

      const result = parseInformatieCheckOutput(perfectJSON);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('COMPLEET');
      expect(result!.dossier?.samenvatting_onderwerp).toBe('Test onderwerp');
    });

    it('should extract JSON from markdown code blocks', () => {
      const markdownWrapped = `
Here is the analysis:

\`\`\`json
{
  "status": "INCOMPLEET",
  "email_subject": "Aanvullende informatie nodig",
  "email_body": "<p>We missen informatie</p>"
}
\`\`\`

This completes the check.
      `;

      const result = parseInformatieCheckOutput(markdownWrapped);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('INCOMPLEET');
      expect(result!.email_subject).toBe('Aanvullende informatie nodig');
    });

    it('should extract JSON embedded in text using pattern matching', () => {
      const embeddedJSON = `
Based on my analysis, here are the results:

{"status":"COMPLEET","dossier":{"samenvatting_onderwerp":"Embedded test","klantvraag_verbatim":["Q1"],"gestructureerde_data":{"partijen":["P1"],"fiscale_partner":false,"relevante_bedragen":{},"overige_info":[]}}}

Hope this helps!
      `;

      const result = parseInformatieCheckOutput(embeddedJSON);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('COMPLEET');
    });

    it('should return null for completely malformed JSON', () => {
      const malformed = 'This is not JSON at all { broken';

      const result = parseInformatieCheckOutput(malformed);

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseInformatieCheckOutput('');
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      const result = parseInformatieCheckOutput('   \n  \t  ');
      expect(result).toBeNull();
    });

    it('should handle JSON with extra whitespace', () => {
      const jsonWithWhitespace = `


        {
          "status": "COMPLEET",
          "dossier": {
            "samenvatting_onderwerp": "Test",
            "klantvraag_verbatim": ["Q"],
            "gestructureerde_data": {
              "partijen": ["P"],
              "fiscale_partner": true,
              "relevante_bedragen": {},
              "overige_info": []
            }
          }
        }


      `;

      const result = parseInformatieCheckOutput(jsonWithWhitespace);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('COMPLEET');
    });
  });

  describe('parseBouwplanData - Stage 2 Parser', () => {
    it('should parse Stage 2 output with fiscal themes', () => {
      const bouwplanJSON = JSON.stringify({
        fiscale_kernthemas: ['Box 3 vermogen', 'Emigratie'],
        geidentificeerde_risicos: ['Heffing bij vertrek'],
        bouwplan_voor_rapport: {
          '1_inleiding': {
            koptekst: 'Inleiding',
            subdoelen: ['Context schetsen']
          },
          '2_analyse': {
            koptekst: 'Fiscale Analyse',
            subdoelen: ['Box 3 behandelen', 'Emigratie bespreken']
          }
        }
      });

      const result = parseBouwplanData(bouwplanJSON);

      expect(result).not.toBeNull();
      expect(result!.fiscale_kernthemas).toHaveLength(2);
      expect(result!.fiscale_kernthemas).toContain('Box 3 vermogen');
      expect(result!.geidentificeerde_risicos).toContain('Heffing bij vertrek');
    });

    it('should extract bouwplan from markdown wrapper', () => {
      const markdown = `
\`\`\`json
{
  "fiscale_kernthemas": ["Thema 1"],
  "geidentificeerde_risicos": ["Risico 1"],
  "bouwplan_voor_rapport": {}
}
\`\`\`
      `;

      const result = parseBouwplanData(markdown);

      expect(result).not.toBeNull();
      expect(result!.fiscale_kernthemas).toContain('Thema 1');
    });

    it('should use regex pattern to find bouwplan in text', () => {
      const textWithJSON = `
Analysis complete. The fiscal themes are:

{"fiscale_kernthemas":["Schenking"],"geidentificeerde_risicos":[],"bouwplan_voor_rapport":{}}

End of analysis.
      `;

      const result = parseBouwplanData(textWithJSON);

      expect(result).not.toBeNull();
      expect(result!.fiscale_kernthemas).toContain('Schenking');
    });

    it('should return null for text without fiscal themes key', () => {
      const noThemes = '{"some_other_key": "value"}';

      const result = parseBouwplanData(noThemes);

      expect(result).toBeNull();
    });
  });

  describe('Stage 1 Blocking Logic - CRITICAL', () => {
    describe('isInformatieCheckComplete', () => {
      it('should return true for COMPLEET status', () => {
        const compleetOutput = JSON.stringify({
          status: 'COMPLEET',
          dossier: {
            samenvatting_onderwerp: 'Complete',
            klantvraag_verbatim: ['Q'],
            gestructureerde_data: {
              partijen: ['P'],
              fiscale_partner: false,
              relevante_bedragen: {},
              overige_info: []
            }
          }
        });

        const result = isInformatieCheckComplete(compleetOutput);

        expect(result).toBe(true);
      });

      it('should return false for INCOMPLEET status', () => {
        const incompletOutput = JSON.stringify({
          status: 'INCOMPLEET',
          email_subject: 'Info nodig',
          email_body: 'Email body'
        });

        const result = isInformatieCheckComplete(incompletOutput);

        expect(result).toBe(false);
      });

      it('should return false when stage 1 has not been executed', () => {
        const result = isInformatieCheckComplete(undefined);

        expect(result).toBe(false);
      });

      it('should return false for empty string', () => {
        const result = isInformatieCheckComplete('');

        expect(result).toBe(false);
      });

      it('should return true for unparseable output (backward compatibility)', () => {
        // Old format that can't be parsed as InformatieCheckOutput
        const oldFormat = 'Some old text format that is not JSON';

        const result = isInformatieCheckComplete(oldFormat);

        // Should assume old format and allow progression
        expect(result).toBe(true);
      });

      it('should extract COMPLEET status from markdown-wrapped JSON', () => {
        const markdown = `\`\`\`json
{
  "status": "COMPLEET",
  "dossier": {
    "samenvatting_onderwerp": "Test",
    "klantvraag_verbatim": ["Q"],
    "gestructureerde_data": {
      "partijen": [],
      "fiscale_partner": false,
      "relevante_bedragen": {},
      "overige_info": []
    }
  }
}
\`\`\``;

        const result = isInformatieCheckComplete(markdown);

        expect(result).toBe(true);
      });
    });

    describe('getStage2BlockReason', () => {
      it('should return null when stage 1 is COMPLEET (not blocked)', () => {
        const compleetOutput = JSON.stringify({
          status: 'COMPLEET',
          dossier: {
            samenvatting_onderwerp: 'Test',
            klantvraag_verbatim: ['Q'],
            gestructureerde_data: {
              partijen: [],
              fiscale_partner: false,
              relevante_bedragen: {},
              overige_info: []
            }
          }
        });

        const result = getStage2BlockReason(compleetOutput);

        expect(result).toBeNull();
      });

      it('should return block message when stage 1 is INCOMPLEET', () => {
        const incompletOutput = JSON.stringify({
          status: 'INCOMPLEET',
          email_subject: 'Info',
          email_body: 'Body'
        });

        const result = getStage2BlockReason(incompletOutput);

        expect(result).not.toBeNull();
        expect(result).toContain('INCOMPLEET');
        expect(result).toContain('e-mail');
      });

      it('should return block message when stage 1 not executed', () => {
        const result = getStage2BlockReason(undefined);

        expect(result).toBe('Stage 1 moet eerst worden uitgevoerd');
      });

      it('should return block message for empty string', () => {
        const result = getStage2BlockReason('');

        expect(result).toBe('Stage 1 moet eerst worden uitgevoerd');
      });

      it('should return null for unparseable output (backward compatibility)', () => {
        const oldFormat = 'Old format text';

        const result = getStage2BlockReason(oldFormat);

        // Can't parse, assume OK
        expect(result).toBeNull();
      });
    });

    describe('getSamenvattingFromStage1', () => {
      it('should extract samenvatting from COMPLEET output', () => {
        const output = JSON.stringify({
          status: 'COMPLEET',
          dossier: {
            samenvatting_onderwerp: 'Dit is de samenvatting van de klant vraag',
            klantvraag_verbatim: ['Q'],
            gestructureerde_data: {
              partijen: [],
              fiscale_partner: false,
              relevante_bedragen: {},
              overige_info: []
            }
          }
        });

        const result = getSamenvattingFromStage1(output);

        expect(result).toBe('Dit is de samenvatting van de klant vraag');
      });

      it('should return null for INCOMPLEET output', () => {
        const output = JSON.stringify({
          status: 'INCOMPLEET',
          email_subject: 'Info',
          email_body: 'Body'
        });

        const result = getSamenvattingFromStage1(output);

        expect(result).toBeNull();
      });

      it('should return null when stage 1 not executed', () => {
        const result = getSamenvattingFromStage1(undefined);

        expect(result).toBeNull();
      });

      it('should return null for unparseable output', () => {
        const result = getSamenvattingFromStage1('not json');

        expect(result).toBeNull();
      });
    });
  });

  describe('Edge Cases - Resilience Testing', () => {
    it('should handle JSON with unicode characters', () => {
      const unicodeJSON = JSON.stringify({
        status: 'COMPLEET',
        dossier: {
          samenvatting_onderwerp: 'Vraag met émigré en €100.000',
          klantvraag_verbatim: ['Hoe werkt box 3 héffing?'],
          gestructureerde_data: {
            partijen: ['François'],
            fiscale_partner: false,
            relevante_bedragen: {},
            overige_info: []
          }
        }
      });

      const result = parseInformatieCheckOutput(unicodeJSON);

      expect(result).not.toBeNull();
      expect(result!.dossier?.samenvatting_onderwerp).toContain('émigré');
    });

    it('should handle JSON with escaped characters', () => {
      const escapedJSON = `{
        "status": "COMPLEET",
        "dossier": {
          "samenvatting_onderwerp": "Text with \\"quotes\\" and \\n newlines",
          "klantvraag_verbatim": ["Q"],
          "gestructureerde_data": {
            "partijen": [],
            "fiscale_partner": false,
            "relevante_bedragen": {},
            "overige_info": []
          }
        }
      }`;

      const result = parseInformatieCheckOutput(escapedJSON);

      expect(result).not.toBeNull();
      expect(result!.dossier?.samenvatting_onderwerp).toContain('quotes');
    });

    it('should handle very long JSON strings (>10k chars)', () => {
      const longString = 'A'.repeat(10000);
      const longJSON = JSON.stringify({
        status: 'COMPLEET',
        dossier: {
          samenvatting_onderwerp: longString,
          klantvraag_verbatim: ['Q'],
          gestructureerde_data: {
            partijen: [],
            fiscale_partner: false,
            relevante_bedragen: {},
            overige_info: []
          }
        }
      });

      const result = parseInformatieCheckOutput(longJSON);

      expect(result).not.toBeNull();
      expect(result!.dossier?.samenvatting_onderwerp).toHaveLength(10000);
    });

    it('should handle JSON with nested markdown blocks', () => {
      const nestedMarkdown = `
Some text before

\`\`\`json
{
  "status": "INCOMPLEET",
  "email_subject": "Info",
  "email_body": "<p>Email with \`code\` in it</p>"
}
\`\`\`

More text after
      `;

      const result = parseInformatieCheckOutput(nestedMarkdown);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('INCOMPLEET');
      expect(result!.email_body).toContain('code');
    });

    it('should prioritize first valid JSON when multiple JSON objects present', () => {
      const multipleJSON = `
First one:
{"status":"COMPLEET","dossier":{"samenvatting_onderwerp":"First","klantvraag_verbatim":["Q"],"gestructureerde_data":{"partijen":[],"fiscale_partner":false,"relevante_bedragen":{},"overige_info":[]}}}

Second one:
{"status":"INCOMPLEET","email_subject":"Second","email_body":"Body"}
      `;

      const result = parseInformatieCheckOutput(multipleJSON);

      expect(result).not.toBeNull();
      // Should parse the first valid match
      expect(result!.status).toBe('COMPLEET');
    });

    it('should handle JSON with trailing commas (common AI mistake)', () => {
      // Note: Standard JSON.parse will fail on this, but markdown extraction might help
      const trailingComma = `\`\`\`json
{
  "status": "COMPLEET",
  "dossier": {
    "samenvatting_onderwerp": "Test",
    "klantvraag_verbatim": ["Q"],
    "gestructureerde_data": {
      "partijen": [],
      "fiscale_partner": false,
      "relevante_bedragen": {},
      "overige_info": [],
    }
  }
}
\`\`\``;

      // This might fail (depending on parser strictness), but we test it anyway
      const result = parseInformatieCheckOutput(trailingComma);

      // If parser is strict, it will return null (which is acceptable)
      // If parser is lenient or we clean it, it might work
      // Either behavior is acceptable for this edge case
      if (result !== null) {
        expect(result.status).toBe('COMPLEET');
      }
    });
  });

  describe('Real-world AI Output Examples', () => {
    it('should handle Gemini-style markdown output', () => {
      const geminiOutput = `
Based on the provided information, here is my analysis:

\`\`\`json
{
  "status": "COMPLEET",
  "dossier": {
    "samenvatting_onderwerp": "Client emigrating to Spain with questions about Box 3 taxation",
    "klantvraag_verbatim": [
      "What are the fiscal consequences when I move to Spain?",
      "Do I still need to pay Dutch wealth tax?"
    ],
    "gestructureerde_data": {
      "partijen": ["Client (emigrating to Spain)"],
      "fiscale_partner": false,
      "relevante_bedragen": {
        "vermogen": "€500,000",
        "jaarinkomen": "€75,000"
      },
      "overige_info": [
        "Plans to maintain property in Netherlands",
        "Moving date: Q2 2025"
      ]
    }
  }
}
\`\`\`

This information appears complete and sufficient to proceed with the analysis.
      `;

      const result = parseInformatieCheckOutput(geminiOutput);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('COMPLEET');
      expect(result!.dossier?.klantvraag_verbatim).toHaveLength(2);
    });

    it('should handle GPT-style verbose output', () => {
      const gptOutput = `
I've analyzed the client information and determined the following:

The information provided is **COMPLETE**. Here's the structured output:

\`\`\`json
{
  "status": "COMPLEET",
  "dossier": {
    "samenvatting_onderwerp": "Estate planning for business owner",
    "klantvraag_verbatim": ["How can I transfer my business to my children tax-efficiently?"],
    "gestructureerde_data": {
      "partijen": ["Business owner", "Two children"],
      "fiscale_partner": true,
      "relevante_bedragen": {
        "business_value": 2000000
      },
      "overige_info": ["Family business", "Succession planning"]
    }
  }
}
\`\`\`

**Next steps**: Proceed with complexity analysis in Stage 2.
      `;

      const result = parseInformatieCheckOutput(gptOutput);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('COMPLEET');
    });
  });
});
