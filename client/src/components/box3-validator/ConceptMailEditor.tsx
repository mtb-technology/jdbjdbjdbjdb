/**
 * ConceptMailEditor Component
 *
 * Concept mail viewer with HTML rendering for readability and clean copy functionality.
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Mail, Copy } from "lucide-react";
import { stripHtmlToPlainText } from "@/utils/box3Utils";
import type { EditedConceptMail } from "@/types/box3Validator.types";

interface ConceptMailEditorProps {
  editedConceptMail: EditedConceptMail | null;
  mailData: { onderwerp?: string; body?: string } | null;
  onEditConceptMail: (mail: EditedConceptMail) => void;
  onCopyMail: () => void;
}

/**
 * Convert HTML to display-friendly HTML (preserve structure, sanitize)
 */
const sanitizeHtml = (html: string): string => {
  if (!html) return "";
  return html
    // Keep only safe tags
    .replace(/<(?!\/?(?:strong|b|em|i|p|br|ul|ol|li|div)\b)[^>]*>/gi, "")
    // Ensure line breaks render properly
    .replace(/<br\s*\/?>/gi, "<br/>")
    .trim();
};

export const ConceptMailEditor = memo(function ConceptMailEditor({
  editedConceptMail,
  mailData,
  onCopyMail,
}: ConceptMailEditorProps) {
  if (!editedConceptMail && !mailData) {
    return null;
  }

  // For display: use HTML if available (from mailData), or plain text if edited
  const displayOnderwerp = editedConceptMail?.onderwerp || stripHtmlToPlainText(mailData?.onderwerp || "");
  const displayBody = editedConceptMail?.body
    ? editedConceptMail.body
    : sanitizeHtml(mailData?.body || "");

  // Check if we have HTML content to render
  const hasHtmlContent = !editedConceptMail?.body && mailData?.body?.includes("<");

  return (
    <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-slate-50/50">
      <CardHeader className="pb-4 border-b border-slate-100">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <span className="text-lg font-semibold text-slate-800">Concept Reactie Mail</span>
          </span>
          <Button
            onClick={onCopyMail}
            variant="outline"
            size="sm"
            className="gap-2 hover:bg-primary hover:text-white hover:border-primary transition-colors"
          >
            <Copy className="h-4 w-4" />
            Kopieer
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-slate-600">Onderwerp</Label>
          <div className="p-3 bg-white border border-slate-200 rounded-md text-sm">
            {displayOnderwerp}
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium text-slate-600">Bericht</Label>
          {hasHtmlContent ? (
            <div
              className="p-4 bg-white border border-slate-200 rounded-md text-sm leading-relaxed min-h-80 prose prose-sm max-w-none prose-strong:font-semibold"
              dangerouslySetInnerHTML={{ __html: displayBody }}
            />
          ) : (
            <div className="p-4 bg-white border border-slate-200 rounded-md text-sm leading-relaxed min-h-80 whitespace-pre-wrap">
              {displayBody}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
