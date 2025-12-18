/**
 * Box 3 Settings Card
 *
 * Displays Box 3 configuration settings in the settings page:
 * - E-mail prompt for follow-up emails
 * - Reference table with forfaitaire rendementen
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RotateCcw, Info, Calculator, Mail, FileCheck } from "lucide-react";
import {
  FORFAITAIRE_RENDEMENTEN,
  BOX3_TARIEVEN,
} from "@/constants/box3.constants";
import type { Box3Config } from "@shared/schema";

// Re-export the type for convenience
export type { Box3Config } from "@shared/schema";

interface Box3SettingsCardProps {
  config: Box3Config | undefined;
  onConfigChange: (field: keyof Box3Config, value: string) => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function Box3SettingsCard({ config, onConfigChange }: Box3SettingsCardProps) {
  const [activeTab, setActiveTab] = useState("email");

  const emailPrompt = config?.emailPrompt || "";
  const isEmailConfigured = emailPrompt.trim().length > 0;

  const handleClearEmail = () => {
    onConfigChange("emailPrompt", "");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <FileCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Box 3 Validator</CardTitle>
            <CardDescription>
              Configureer de e-mail prompt en bekijk de forfaitaire rendementen referentie
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              E-mail Prompt
            </TabsTrigger>
            <TabsTrigger value="reference" className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Referentie
            </TabsTrigger>
          </TabsList>

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
                  onClick={handleClearEmail}
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
                value={emailPrompt}
                onChange={(e) => onConfigChange("emailPrompt", e.target.value)}
                className="font-mono text-sm min-h-[300px]"
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
      </CardContent>
    </Card>
  );
}
