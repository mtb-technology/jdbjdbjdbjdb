import { describe, it, expect, beforeEach } from 'vitest';
import { PDFGenerator } from '../pdf-generator';
import { jsPDF } from 'jspdf';

describe('PDFGenerator - Marks Rendering', () => {
  let pdfGenerator: PDFGenerator;

  beforeEach(() => {
    pdfGenerator = new PDFGenerator();
  });

  it('should handle TipTap content with bold marks', async () => {
    const tipTapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This is ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' text.' }
          ]
        }
      ]
    };

    const pdfBuffer = await pdfGenerator.generateFromTipTap({
      content: tipTapContent,
      title: 'Test Document',
      clientName: 'Test Client'
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
  });

  it('should handle TipTap content with italic marks', async () => {
    const tipTapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This is ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' text.' }
          ]
        }
      ]
    };

    const pdfBuffer = await pdfGenerator.generateFromTipTap({
      content: tipTapContent,
      title: 'Test Document',
      clientName: 'Test Client'
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
  });

  it('should handle TipTap content with mixed marks', async () => {
    const tipTapContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [
            { type: 'text', text: 'Main ' },
            { type: 'text', text: 'Heading', marks: [{ type: 'bold' }] }
          ]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Regular text with ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' mixed.' }
          ]
        }
      ]
    };

    const pdfBuffer = await pdfGenerator.generateFromTipTap({
      content: tipTapContent,
      title: 'Test Document',
      clientName: 'Test Client'
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
  });

  it('should handle headings with marks', async () => {
    const tipTapContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [
            { type: 'text', text: 'Important' },
            { type: 'text', text: ' Title', marks: [{ type: 'italic' }] }
          ]
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [
            { type: 'text', text: 'Subtitle with ' },
            { type: 'text', text: 'emphasis', marks: [{ type: 'italic' }] }
          ]
        }
      ]
    };

    const pdfBuffer = await pdfGenerator.generateFromTipTap({
      content: tipTapContent,
      title: 'Test Document',
      clientName: 'Test Client'
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
  });

  it('should handle lists with marks', async () => {
    const tipTapContent = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Item with ' },
                    { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }
                  ]
                }
              ]
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Item with ' },
                    { type: 'text', text: 'italic', marks: [{ type: 'italic' }] }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const pdfBuffer = await pdfGenerator.generateFromTipTap({
      content: tipTapContent,
      title: 'Test Document',
      clientName: 'Test Client'
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
  });

  it('should handle code marks', async () => {
    const tipTapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Use the ' },
            { type: 'text', text: 'console.log()', marks: [{ type: 'code' }] },
            { type: 'text', text: ' function.' }
          ]
        }
      ]
    };

    const pdfBuffer = await pdfGenerator.generateFromTipTap({
      content: tipTapContent,
      title: 'Test Document',
      clientName: 'Test Client'
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
  });

  it('should handle hardBreak nodes', async () => {
    const tipTapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Line 1' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Line 2' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Line 3' }
          ]
        }
      ]
    };

    const pdfBuffer = await pdfGenerator.generateFromTipTap({
      content: tipTapContent,
      title: 'Test Document',
      clientName: 'Test Client'
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
  });

  it('should handle complex document with all features', async () => {
    const tipTapContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [
            { type: 'text', text: 'Comprehensive ' },
            { type: 'text', text: 'Test', marks: [{ type: 'bold' }] }
          ]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This document tests ' },
            { type: 'text', text: 'multiple', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' features including ' },
            { type: 'text', text: 'italics', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'code', marks: [{ type: 'code' }] },
            { type: 'text', text: '.' }
          ]
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Lists' }]
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'First ' },
                    { type: 'text', text: 'item', marks: [{ type: 'bold' }] }
                  ]
                }
              ]
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Second ' },
                    { type: 'text', text: 'item', marks: [{ type: 'italic' }] }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const pdfBuffer = await pdfGenerator.generateFromTipTap({
      content: tipTapContent,
      title: 'Comprehensive Test',
      clientName: 'Test Client'
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);

    // Verify it's a valid PDF (starts with PDF header)
    const pdfHeader = pdfBuffer.slice(0, 4).toString('utf-8');
    expect(pdfHeader).toBe('%PDF');
  });
});
