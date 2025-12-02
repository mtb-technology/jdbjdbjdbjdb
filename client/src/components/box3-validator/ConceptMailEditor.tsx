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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center">
            <Mail className="h-5 w-5 mr-2 text-primary" />
            Concept Reactie Mail
          </span>
          <Button onClick={onCopyMail} variant="outline" size="sm">
            <Copy className="h-4 w-4 mr-2" />
            Kopieer
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Onderwerp</Label>
          <Input
            value={currentOnderwerp}
            onChange={(e) =>
              onEditConceptMail({
                onderwerp: e.target.value,
                body: currentBody,
              })
            }
            className="mt-1"
          />
        </div>
        <div>
          <Label>Bericht</Label>
          <Textarea
            value={currentBody}
            onChange={(e) =>
              onEditConceptMail({
                onderwerp: currentOnderwerp,
                body: e.target.value,
              })
            }
            className="mt-1 min-h-64 font-mono text-sm"
          />
        </div>
      </CardContent>
    </Card>
  );
});
