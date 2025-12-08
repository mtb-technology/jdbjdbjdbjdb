import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RotateCcw, Info, Calculator, FileInput, RefreshCw, Mail } from "lucide-react";
import {
  FORFAITAIRE_RENDEMENTEN,
  BOX3_TARIEVEN,
} from "@/constants/box3.constants";

// =============================================================================
// NO DEFAULT PROMPTS - User must configure via UI
// =============================================================================

// Empty defaults - prompts MUST be configured by user via settings UI
export const DEFAULT_INTAKE_PROMPT = "";
export const DEFAULT_YEAR_VALIDATION_PROMPT = "";
export const DEFAULT_EMAIL_PROMPT = "";

// Legacy export for backwards compatibility (also empty)
export const DEFAULT_BOX3_SYSTEM_PROMPT = "";

// =============================================================================
// TYPES
// =============================================================================

export interface Box3Prompts {
  intake: string;
  yearValidation: string;
  email: string;
}

interface Box3SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompts: Box3Prompts;
  onPromptsChange: (prompts: Box3Prompts) => void;
  // Legacy support
  systemPrompt?: string;
  onSystemPromptChange?: (prompt: string) => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function Box3SettingsModal({
  open,
  onOpenChange,
  prompts,
  onPromptsChange,
  // Legacy props - if provided, use them for backwards compatibility
  systemPrompt,
  onSystemPromptChange,
}: Box3SettingsModalProps) {
  // If using legacy props, convert to new format
  const effectivePrompts: Box3Prompts = prompts || {
    intake: systemPrompt || DEFAULT_INTAKE_PROMPT,
    yearValidation: DEFAULT_YEAR_VALIDATION_PROMPT,
    email: DEFAULT_EMAIL_PROMPT,
  };

  const [localPrompts, setLocalPrompts] = useState<Box3Prompts>(effectivePrompts);
  const [activeTab, setActiveTab] = useState("intake");

  useEffect(() => {
    if (prompts) {
      setLocalPrompts(prompts);
    } else if (systemPrompt) {
      setLocalPrompts((prev) => ({ ...prev, intake: systemPrompt }));
    }
  }, [prompts, systemPrompt]);

  const handleSave = () => {
    if (onPromptsChange) {
      onPromptsChange(localPrompts);
    }
    // Legacy support
    if (onSystemPromptChange && !onPromptsChange) {
      onSystemPromptChange(localPrompts.intake);
    }
    onOpenChange(false);
  };

  const handleClear = (promptType: keyof Box3Prompts) => {
    setLocalPrompts((prev) => ({ ...prev, [promptType]: "" }));
  };

  const handleClearAll = () => {
    setLocalPrompts({
      intake: "",
      yearValidation: "",
      email: "",
    });
  };

  // Check if prompts are configured
  const isIntakeConfigured = localPrompts.intake.trim().length > 0;
  const isYearValidationConfigured = localPrompts.yearValidation.trim().length > 0;
  const isEmailConfigured = localPrompts.email.trim().length > 0;

  const updatePrompt = (key: keyof Box3Prompts, value: string) => {
    setLocalPrompts((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Box 3 Validator Instellingen</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="intake" className="flex items-center gap-2">
              <FileInput className="h-4 w-4" />
              Intake
            </TabsTrigger>
            <TabsTrigger value="yearValidation" className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Jaar Validatie
            </TabsTrigger>
            <TabsTrigger value="email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              E-mail
            </TabsTrigger>
            <TabsTrigger value="reference" className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Referentie
            </TabsTrigger>
          </TabsList>

          {/* Intake Prompt Tab */}
          <TabsContent value="intake" className="space-y-4 mt-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="intake-prompt" className="text-base font-medium">
                    Intake Prompt
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Gebruikt bij het aanmaken van een nieuw dossier en initiële document uploads
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleClear("intake")}
                  className="h-8"
                  disabled={!isIntakeConfigured}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Wissen
                </Button>
              </div>
              {!isIntakeConfigured && (
                <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                  <p className="text-sm text-orange-700 dark:text-orange-300 font-medium">
                    Intake prompt is verplicht
                  </p>
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                    Configureer een intake prompt om nieuwe dossiers te kunnen analyseren.
                  </p>
                </div>
              )}
              <Textarea
                id="intake-prompt"
                value={localPrompts.intake}
                onChange={(e) => updatePrompt("intake", e.target.value)}
                className="font-mono text-sm min-h-[400px]"
                placeholder="Voer de intake prompt in... (verplicht)"
              />
            </div>
          </TabsContent>

          {/* Year Validation Prompt Tab */}
          <TabsContent value="yearValidation" className="space-y-4 mt-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="year-validation-prompt" className="text-base font-medium">
                    Jaar Validatie Prompt
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Gebruikt bij hervalidatie van een specifiek belastingjaar
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleClear("yearValidation")}
                  className="h-8"
                  disabled={!isYearValidationConfigured}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Wissen
                </Button>
              </div>
              {!isYearValidationConfigured && (
                <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                  <p className="text-sm text-orange-700 dark:text-orange-300 font-medium">
                    Jaar validatie prompt niet geconfigureerd
                  </p>
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                    Configureer een prompt om jaren individueel te kunnen hervalideren.
                  </p>
                </div>
              )}
              <Textarea
                id="year-validation-prompt"
                value={localPrompts.yearValidation}
                onChange={(e) => updatePrompt("yearValidation", e.target.value)}
                className="font-mono text-sm min-h-[400px]"
                placeholder="Voer de jaar validatie prompt in..."
              />
            </div>
          </TabsContent>

          {/* Email Prompt Tab */}
          <TabsContent value="email" className="space-y-4 mt-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="email-prompt" className="text-base font-medium">
                    E-mail Generatie Prompt
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Gebruikt voor het genereren van follow-up e-mails naar de klant
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleClear("email")}
                  className="h-8"
                  disabled={!isEmailConfigured}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Wissen
                </Button>
              </div>
              {!isEmailConfigured && (
                <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                  <p className="text-sm text-orange-700 dark:text-orange-300 font-medium">
                    E-mail prompt niet geconfigureerd
                  </p>
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                    Configureer een prompt om follow-up e-mails te kunnen genereren.
                  </p>
                </div>
              )}
              <Textarea
                id="email-prompt"
                value={localPrompts.email}
                onChange={(e) => updatePrompt("email", e.target.value)}
                className="font-mono text-sm min-h-[400px]"
                placeholder="Voer de e-mail prompt in..."
              />
            </div>
          </TabsContent>

          {/* Reference Tab - Forfaitaire Rendementen */}
          <TabsContent value="reference" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-primary" />
                <Label className="text-base font-medium">Forfaitaire Rendementen per Belastingjaar</Label>
                <Badge variant="outline" className="text-xs">Read-only</Badge>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 font-medium">Jaar</th>
                      <th className="text-right py-2 px-2 font-medium">Spaargeld</th>
                      <th className="text-right py-2 px-2 font-medium">Beleggingen</th>
                      <th className="text-right py-2 px-2 font-medium">Schulden</th>
                      <th className="text-right py-2 px-2 font-medium">Box 3 Tarief</th>
                      <th className="text-right py-2 px-2 font-medium">Heffingsvrij</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(FORFAITAIRE_RENDEMENTEN)
                      .sort(([a], [b]) => Number(b) - Number(a))
                      .map(([jaar, data]) => (
                        <tr key={jaar} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="py-2 px-2 font-medium">{jaar}</td>
                          <td className="text-right py-2 px-2 text-muted-foreground">{data.spaargeld.toFixed(2)}%</td>
                          <td className="text-right py-2 px-2 text-muted-foreground">{data.beleggingen.toFixed(2)}%</td>
                          <td className="text-right py-2 px-2 text-muted-foreground">{data.schulden.toFixed(2)}%</td>
                          <td className="text-right py-2 px-2 text-muted-foreground">{((BOX3_TARIEVEN[jaar] || 0) * 100).toFixed(0)}%</td>
                          <td className="text-right py-2 px-2 text-muted-foreground">
                            €{data.heffingsvrijVermogen.toLocaleString("nl-NL")}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>
                  Deze percentages worden door de Belastingdienst jaarlijks vastgesteld en worden automatisch
                  toegepast op basis van het gedetecteerde belastingjaar in de documenten.
                </span>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Actions */}
        <div className="flex justify-between items-center pt-4 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            disabled={!isIntakeConfigured && !isYearValidationConfigured && !isEmailConfigured}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Wis alle prompts
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annuleren
            </Button>
            <Button onClick={handleSave}>
              Opslaan
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
