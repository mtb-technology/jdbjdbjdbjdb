/**
 * Box3CaseDetail Component
 *
 * Displays the detail view of a Box 3 validation case.
 * Shows validation results without the input form.
 */

import { memo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  RefreshCw,
  RotateCcw,
  Settings as SettingsIcon,
  User,
  Mail,
  Paperclip,
  FileText,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Extracted components
import {
  GlobalStatusBadge,
  DocumentChecklist,
  KansrijkheidAnalyse,
  ConceptMailEditor,
  GevondenDataCards,
  RawOutputPanel,
} from "@/components/box3-validator";

// Utils
import {
  extractBelastingjaar,
  isNewFormat,
  getMailData,
  stripHtmlToPlainText,
} from "@/utils/box3Utils";

// Constants
import { CATEGORY_LABELS } from "@/constants/box3.constants";

// Types
import type { Box3ValidatorSession, Box3ValidationResult } from "@shared/schema";

interface Box3CaseDetailProps {
  session: Box3ValidatorSession;
  systemPrompt: string;
  isRevalidating: boolean;
  onBack: () => void;
  onRevalidate: () => void;
  onOpenSettings: () => void;
}

export const Box3CaseDetail = memo(function Box3CaseDetail({
  session,
  systemPrompt,
  isRevalidating,
  onBack,
  onRevalidate,
  onOpenSettings,
}: Box3CaseDetailProps) {
  const { toast } = useToast();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(Object.keys(CATEGORY_LABELS))
  );
  const [showInputDetails, setShowInputDetails] = useState(false);

  const validationResult = session.validationResult as Box3ValidationResult | null;
  const conceptMail = session.conceptMail as {
    onderwerp?: string;
    body?: string;
  } | null;

  const [editedConceptMail, setEditedConceptMail] = useState<{
    onderwerp: string;
    body: string;
  } | null>(
    conceptMail
      ? {
          onderwerp: stripHtmlToPlainText(conceptMail.onderwerp || ""),
          body: stripHtmlToPlainText(conceptMail.body || ""),
        }
      : null
  );

  // Derived values
  const belastingjaar = extractBelastingjaar(validationResult);
  const mailData = getMailData(validationResult);
  const showNewFormat = isNewFormat(validationResult);
  const attachments = (session.attachments as any[]) || [];

  // Category toggle
  const toggleCategory = useCallback((key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Copy mail handler
  const handleCopyMail = useCallback(() => {
    if (!editedConceptMail) return;

    const text = `Onderwerp: ${editedConceptMail.onderwerp}\n\n${editedConceptMail.body}`;
    navigator.clipboard.writeText(text);

    toast({
      title: "Gekopieerd",
      description: "Concept mail is naar het klembord gekopieerd.",
    });
  }, [editedConceptMail, toast]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Terug naar overzicht
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          <SettingsIcon className="h-4 w-4 mr-2" />
          Settings
        </Button>
      </div>

      {/* Case Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-3">
              <User className="h-5 w-5 text-muted-foreground" />
              {session.clientName || "Onbekende klant"}
              {belastingjaar && (
                <Badge variant="outline">Belastingjaar {belastingjaar}</Badge>
              )}
              {validationResult?.global_status && (
                <GlobalStatusBadge status={validationResult.global_status} />
              )}
            </CardTitle>
            <div className="flex gap-2">
              <Button
                onClick={onRevalidate}
                variant="default"
                size="sm"
                disabled={isRevalidating}
              >
                {isRevalidating ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Opnieuw valideren
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Collapsible input details */}
          <button
            onClick={() => setShowInputDetails(!showInputDetails)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {showInputDetails ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span>Oorspronkelijke input bekijken</span>
            {attachments.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                <Paperclip className="h-3 w-3 mr-1" />
                {attachments.length} bijlage(s)
              </Badge>
            )}
          </button>

          {showInputDetails && (
            <div className="mt-4 space-y-4 border-t pt-4">
              {/* Original mail text */}
              {session.inputText && (
                <div>
                  <div className="flex items-center gap-2 mb-2 text-sm font-medium">
                    <Mail className="h-4 w-4 text-blue-500" />
                    Mail van klant
                  </div>
                  <div className="bg-muted p-3 rounded-md text-sm font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {session.inputText}
                  </div>
                </div>
              )}

              {/* Attachments */}
              {attachments.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 text-sm font-medium">
                    <Paperclip className="h-4 w-4 text-green-500" />
                    Bijlages
                  </div>
                  <div className="space-y-1">
                    {attachments.map((att: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-sm text-muted-foreground"
                      >
                        <FileText className="h-4 w-4" />
                        {att.filename || att.name || `Bijlage ${idx + 1}`}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Created date */}
              <div className="text-xs text-muted-foreground">
                Aangemaakt op{" "}
                {session.createdAt ? new Date(session.createdAt).toLocaleString("nl-NL") : "Onbekend"}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results Section */}
      {validationResult && (
        <div className="grid gap-6">
          {/* Kansrijkheid Analyse */}
          <KansrijkheidAnalyse
            validationResult={validationResult}
            belastingjaar={belastingjaar}
          />

          {/* Raw Output Panel */}
          <RawOutputPanel
            validationResult={validationResult}
            lastUsedPrompt={null}
            systemPrompt={systemPrompt}
          />

          {/* New Format: Gevonden Data Dashboard */}
          {showNewFormat && validationResult.gevonden_data && (
            <GevondenDataCards validationResult={validationResult} />
          )}

          {/* Document Checklist */}
          <DocumentChecklist
            validationResult={validationResult}
            expandedCategories={expandedCategories}
            onToggleCategory={toggleCategory}
          />

          {/* Concept Mail Editor */}
          <ConceptMailEditor
            editedConceptMail={editedConceptMail}
            mailData={mailData}
            onEditConceptMail={setEditedConceptMail}
            onCopyMail={handleCopyMail}
          />
        </div>
      )}

      {!validationResult && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground">
              Geen validatie resultaat beschikbaar voor deze case.
            </p>
            <Button onClick={onRevalidate} className="mt-4" disabled={isRevalidating}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Nu valideren
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
});
