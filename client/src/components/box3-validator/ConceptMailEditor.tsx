/**
 * ConceptMailEditor Component
 *
 * Editable concept mail/response editor with copy functionality.
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

export const ConceptMailEditor = memo(function ConceptMailEditor({
  editedConceptMail,
  mailData,
  onEditConceptMail,
  onCopyMail,
}: ConceptMailEditorProps) {
  if (!editedConceptMail && !mailData) {
    return null;
  }

  const currentOnderwerp =
    editedConceptMail?.onderwerp ||
    stripHtmlToPlainText(mailData?.onderwerp || "");
  const currentBody =
    editedConceptMail?.body || stripHtmlToPlainText(mailData?.body || "");

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
          <Button onClick={onCopyMail} variant="outline" size="sm" className="gap-2 hover:bg-primary hover:text-white hover:border-primary transition-colors">
            <Copy className="h-4 w-4" />
            Kopieer
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-slate-600">Onderwerp</Label>
          <Input
            value={currentOnderwerp}
            onChange={(e) =>
              onEditConceptMail({
                onderwerp: e.target.value,
                body: currentBody,
              })
            }
            className="bg-white border-slate-200 focus:border-primary focus:ring-primary/20"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium text-slate-600">Bericht</Label>
          <Textarea
            value={currentBody}
            onChange={(e) =>
              onEditConceptMail({
                onderwerp: currentOnderwerp,
                body: e.target.value,
              })
            }
            className="min-h-80 bg-white border-slate-200 focus:border-primary focus:ring-primary/20 text-sm leading-relaxed resize-y"
          />
        </div>
      </CardContent>
    </Card>
  );
});
