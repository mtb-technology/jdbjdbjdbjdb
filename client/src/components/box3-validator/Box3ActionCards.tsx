/**
 * Box3ActionCards Component
 *
 * Inline cards for Box3 Case Detail showing:
 * 1. Next Best Action - what needs to be done
 * 2. Email to client - generated email preview
 *
 * Returns a Fragment with two cards for use in a grid layout.
 */

import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Target,
  Mail,
  AlertTriangle,
  CheckCircle2,
  Info,
  FileText,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  Settings,
  Building2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { Box3Dossier } from "@shared/schema";

interface MissingItem {
  year: string;
  description: string;
}

interface NextStep {
  action: string;
  description: string;
  banksNeeded?: string[];
}

interface GeneratedEmail {
  emailType: string;
  subject: string;
  body: string;
  metadata?: {
    yearRange?: string;
    totalIndicativeRefund?: number;
    minimumProfitableAmount?: number;
    missingItemsCount?: number;
  };
}

interface Box3ActionCardsProps {
  dossier: Box3Dossier;
  nextStep: NextStep;
  missingItems: MissingItem[];
  isProfitable: boolean;
  totalRefund: number;
  hasMissingReturnData?: boolean;
  onGenerateEmail: (customPrompt?: string) => void;
  isGeneratingEmail: boolean;
  generatedEmail: GeneratedEmail | null;
  onShowEmailPreview?: () => void;
}

interface EmailPromptData {
  prompt: string;
  placeholders: Array<{ key: string; description: string }>;
  emailTypes: Array<{ key: string; description: string }>;
}

export const Box3ActionCards = memo(function Box3ActionCards({
  dossier,
  nextStep,
  missingItems,
  isProfitable,
  totalRefund,
  hasMissingReturnData = false,
  onGenerateEmail,
  isGeneratingEmail,
  generatedEmail,
  onShowEmailPreview,
}: Box3ActionCardsProps) {
  const { toast } = useToast();
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [promptData, setPromptData] = useState<EmailPromptData | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);

  // Load prompt template when dialog opens
  const handleOpenPromptDialog = async () => {
    setShowPromptDialog(true);
    if (!promptData) {
      setIsLoadingPrompt(true);
      try {
        const response = await fetch('/api/box3-validator/email-prompt');
        if (response.ok) {
          const result = await response.json();
          setPromptData(result.data);
          setCustomPrompt(result.data.prompt);
        }
      } catch (error) {
        toast({ title: "Fout", description: "Kon prompt niet laden", variant: "destructive" });
      } finally {
        setIsLoadingPrompt(false);
      }
    }
  };

  // Generate with custom prompt
  const handleGenerateWithCustomPrompt = () => {
    setShowPromptDialog(false);
    onGenerateEmail(customPrompt);
  };

  // Reset to default prompt
  const handleResetPrompt = () => {
    if (promptData) {
      setCustomPrompt(promptData.prompt);
    }
  };

  // Determine status - also consider missing return data
  const hasMissingDocs = missingItems.length > 0 || hasMissingReturnData;
  const StatusIcon = hasMissingDocs ? AlertTriangle : isProfitable ? CheckCircle2 : Info;
  const statusColor = hasMissingDocs
    ? "text-amber-600"
    : isProfitable
    ? "text-green-600"
    : "text-gray-500";

  // Copy email to clipboard
  const handleCopyEmail = async () => {
    if (!generatedEmail) return;

    const plainText =
      generatedEmail.subject +
      "\n\n" +
      generatedEmail.body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");

    await navigator.clipboard.writeText(plainText);
    setCopiedEmail(true);
    toast({ title: "Gekopieerd", description: "Email inhoud gekopieerd naar klembord" });
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  // Open in mail app
  const handleOpenInMailApp = () => {
    if (!generatedEmail) return;

    const plainBody = generatedEmail.body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
    const mailto = `mailto:${dossier.clientEmail || ""}?subject=${encodeURIComponent(
      generatedEmail.subject
    )}&body=${encodeURIComponent(plainBody)}`;
    window.open(mailto, "_blank");
  };

  // Get email type badge
  const getEmailTypeBadge = (type: string) => {
    switch (type) {
      case "profitable":
        return <Badge className="bg-green-600">Kansrijk</Badge>;
      case "request_docs":
        return <Badge className="bg-amber-500">Docs nodig</Badge>;
      case "not_profitable":
        return <Badge variant="outline">Niet kansrijk</Badge>;
      default:
        return null;
    }
  };

  return (
    <>
      {/* Next Best Action Card - Modern minimal */}
      <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Target className="h-4 w-4" />
          Volgende stap
        </div>

        {/* Status + action */}
        <div className="flex items-start gap-2.5">
          <StatusIcon className={`h-4 w-4 mt-0.5 ${statusColor}`} />
          <div className="space-y-0.5">
            <p className="font-medium text-sm">{nextStep.action}</p>
            <p className="text-xs text-muted-foreground">{nextStep.description}</p>
          </div>
        </div>

        {/* Missing items - compact list */}
        {hasMissingDocs && (
          <div className="pt-2 border-t space-y-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {nextStep.banksNeeded && nextStep.banksNeeded.length > 0
                ? 'Jaaroverzichten nodig van'
                : 'Ontbrekende documenten'}
            </p>
            {nextStep.banksNeeded && nextStep.banksNeeded.length > 0 ? (
              // Show specific banks that need documents
              <div className="flex flex-wrap gap-1.5">
                {nextStep.banksNeeded.map((bank, idx) => (
                  <Badge
                    key={idx}
                    variant="outline"
                    className="text-xs bg-amber-50 border-amber-200 text-amber-700"
                  >
                    <Building2 className="h-3 w-3 mr-1" />
                    {bank}
                  </Badge>
                ))}
              </div>
            ) : missingItems.length > 0 ? (
              <ul className="space-y-1">
                {missingItems.slice(0, 4).map((item, idx) => (
                  <li key={idx} className="flex items-start gap-1.5 text-xs">
                    <FileText className="h-3 w-3 mt-0.5 text-amber-500 flex-shrink-0" />
                    <span className="text-muted-foreground">
                      {item.description}
                      <span className="opacity-60 ml-1">({item.year})</span>
                    </span>
                  </li>
                ))}
                {missingItems.length > 4 && (
                  <li className="text-[10px] text-muted-foreground pl-4">
                    + {missingItems.length - 4} meer...
                  </li>
                )}
              </ul>
            ) : hasMissingReturnData ? (
              <ul className="space-y-1">
                <li className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3 mt-0.5 text-amber-500 flex-shrink-0" />
                  Jaaroverzichten bank (rente)
                </li>
                <li className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3 mt-0.5 text-amber-500 flex-shrink-0" />
                  Jaaroverzichten beleggingen (dividend)
                </li>
              </ul>
            ) : null}
          </div>
        )}

        {/* Profitable summary */}
        {!hasMissingDocs && isProfitable && totalRefund > 0 && (
          <div className="p-2.5 bg-green-50 rounded-md">
            <p className="text-xs text-green-700">
              <span className="font-medium">Indicatieve teruggave:</span>{" "}
              <span className="font-semibold">
                {new Intl.NumberFormat("nl-NL", {
                  style: "currency",
                  currency: "EUR",
                }).format(totalRefund)}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* Email Card - Modern minimal */}
      <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Mail className="h-4 w-4" />
            Email naar klant
          </div>
          <button
            onClick={handleOpenPromptDialog}
            className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            title="Email prompt aanpassen"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
        {!generatedEmail ? (
          // Generate button - centered, elegant
          <div className="flex justify-center items-center py-6">
            <button
              onClick={() => onGenerateEmail()}
              disabled={isGeneratingEmail}
              className="group flex items-center gap-2 px-5 py-2.5 rounded-full border border-slate-200 bg-white text-slate-600 text-sm font-medium shadow-sm hover:shadow-md hover:border-slate-300 hover:text-slate-900 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGeneratingEmail ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Genereren...</span>
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 group-hover:scale-110 transition-transform" />
                  <span>Genereer email</span>
                </>
              )}
            </button>
          </div>
        ) : (
          // Email preview - compact
          <div className="space-y-2.5">
            {/* Type + subject */}
            <div className="flex items-center gap-2">
              {getEmailTypeBadge(generatedEmail.emailType)}
              <span className="text-xs text-muted-foreground truncate flex-1" title={generatedEmail.subject}>
                {generatedEmail.subject}
              </span>
            </div>

            {/* Body preview - shorter */}
            <div
              className="text-[11px] text-muted-foreground bg-muted/40 rounded p-2 max-h-20 overflow-hidden"
              style={{
                maskImage: "linear-gradient(to bottom, black 50%, transparent 100%)",
                WebkitMaskImage: "linear-gradient(to bottom, black 50%, transparent 100%)",
              }}
            >
              <div
                dangerouslySetInnerHTML={{
                  __html: generatedEmail.body.slice(0, 300),
                }}
              />
            </div>

            {/* Actions - compact */}
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={handleCopyEmail}>
                {copiedEmail ? (
                  <><Check className="h-3 w-3 mr-1" />Gekopieerd</>
                ) : (
                  <><Copy className="h-3 w-3 mr-1" />Kopieer</>
                )}
              </Button>
              <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={onShowEmailPreview}>
                <FileText className="h-3 w-3 mr-1" />
                Bekijk
              </Button>
            </div>

            {/* Regenerate - text link style */}
            <button
              onClick={() => onGenerateEmail()}
              disabled={isGeneratingEmail}
              className="w-full text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1 py-1"
            >
              <RefreshCw className={`h-2.5 w-2.5 ${isGeneratingEmail ? 'animate-spin' : ''}`} />
              Opnieuw genereren
            </button>
          </div>
        )}
      </div>

      {/* Prompt Configuration Dialog */}
      <Dialog open={showPromptDialog} onOpenChange={setShowPromptDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Email Generatie Prompt</DialogTitle>
            <DialogDescription>
              Pas de AI prompt aan voor het genereren van klant emails. De prompt bepaalt de toon, structuur en inhoud.
            </DialogDescription>
          </DialogHeader>

          {isLoadingPrompt ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col gap-4">
              {/* Placeholders reference */}
              {promptData && (
                <div className="bg-slate-50 rounded-lg p-3 text-xs">
                  <p className="font-medium text-slate-700 mb-2">Beschikbare placeholders:</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {promptData.placeholders.map(p => (
                      <div key={p.key} className="flex gap-2">
                        <code className="bg-slate-200 px-1 rounded text-slate-700">{p.key}</code>
                        <span className="text-slate-500 truncate">{p.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Prompt editor */}
              <div className="flex-1 min-h-0">
                <Textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  className="h-full min-h-[300px] font-mono text-xs resize-none"
                  placeholder="Email generatie prompt..."
                />
              </div>

              {/* Actions */}
              <div className="flex justify-between pt-2 border-t">
                <Button variant="ghost" size="sm" onClick={handleResetPrompt}>
                  Reset naar standaard
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowPromptDialog(false)}>
                    Annuleren
                  </Button>
                  <Button size="sm" onClick={handleGenerateWithCustomPrompt} disabled={isGeneratingEmail}>
                    {isGeneratingEmail ? (
                      <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Genereren...</>
                    ) : (
                      <>Genereer met deze prompt</>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});
