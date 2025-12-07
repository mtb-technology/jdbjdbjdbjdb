import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Copy, CheckCircle2, XCircle, ChevronDown, ChevronUp, AlertTriangle, Mail, Loader2 } from "lucide-react";
import type { InformatieCheckOutput } from "@shared/schema";
import { parseInformatieCheckOutput } from "@/lib/workflowParsers";
import DOMPurify from "isomorphic-dompurify";

/**
 * Collapsible item for missing information - shows title + short reason,
 * expands to show full action for client
 */
function MissingInfoItem({ item, index }: { item: any; index: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const title = item.onderwerp || item.item || "Ontbrekend item";
  const reason = item.reden;
  const action = item.actie_voor_klant;

  // If no action, don't make it collapsible
  if (!action) {
    return (
      <div className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-medium flex items-center justify-center mt-0.5">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm">{title}</span>
          {reason && (
            <p className="text-xs text-muted-foreground mt-0.5">{reason}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors text-left">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-medium flex items-center justify-center mt-0.5">
            {index + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{title}</span>
              {isOpen ? (
                <ChevronUp className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              )}
            </div>
            {reason && !isOpen && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{reason}</p>
            )}
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-8 pl-3 border-l-2 border-muted pb-2 space-y-1">
          {reason && (
            <p className="text-xs text-muted-foreground">{reason}</p>
          )}
          <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1">
            <span className="font-semibold">→</span>
            <span>{action}</span>
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface InformatieCheckViewerProps {
  /** Raw AI output from Stage 1a (Informatiecheck) */
  rawOutput: string;
  /** Raw AI output from Stage 1b (Email generation) - shown inline when INCOMPLEET */
  emailOutput?: string;
  /** Whether email generation is in progress */
  isGeneratingEmail?: boolean;
}

/**
 * Displays structured output for Stage 1 (Informatiecheck)
 * Shows either:
 * - Missing info + email interface for INCOMPLEET status
 * - Dossier summary for COMPLEET status (complete information)
 */
export function InformatieCheckViewer({ rawOutput, emailOutput, isGeneratingEmail }: InformatieCheckViewerProps) {
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  const parsedOutput = parseInformatieCheckOutput(rawOutput);

  if (!parsedOutput) {
    // Fallback: show raw output if parsing fails
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <p className="font-semibold mb-2">Fout bij het parsen van de informatiecheck output</p>
          <p className="text-xs mb-3">De AI heeft geen geldig JSON formaat geretourneerd. Hieronder de ruwe output:</p>
          <pre className="whitespace-pre-wrap break-all text-xs bg-black/10 p-3 rounded mt-2 max-h-[400px] overflow-y-auto" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
            {rawOutput}
          </pre>
        </AlertDescription>
      </Alert>
    );
  }

  // Copy email to clipboard as rich HTML (preserves bold, formatting) for mail clients
  const copyEmailToClipboard = async (htmlText: string) => {
    try {
      // Create plain text fallback
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlText;
      let plainText = tempDiv.innerText || tempDiv.textContent || '';
      plainText = plainText.replace(/\n{3,}/g, '\n\n').trim();

      // Use clipboard API to write both HTML and plain text
      // This allows mail clients to paste rich formatted content
      const htmlBlob = new Blob([htmlText], { type: 'text/html' });
      const textBlob = new Blob([plainText], { type: 'text/plain' });

      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob,
        }),
      ]);

      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    } catch (err) {
      // Fallback to plain text if clipboard API fails
      console.error('Rich copy failed, falling back to plain text:', err);
      try {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlText;
        const plainText = tempDiv.innerText || '';
        await navigator.clipboard.writeText(plainText);
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 2000);
      } catch (fallbackErr) {
        console.error('Copy failed:', fallbackErr);
      }
    }
  };

  // INTERFACE_INCOMPLEET: Show missing information and prompt to generate email
  if (parsedOutput.status === "INCOMPLEET") {
    // Support both field names for backwards compatibility
    const ontbrekendeInfo = (parsedOutput as any).ontbrekende_informatie || (parsedOutput as any).ontbrekende_info || [];

    return (
      <div className="space-y-4">
        {/* Status Header - Subtle amber accent */}
        <div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <XCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <h3 className="font-semibold text-amber-900 dark:text-amber-100">
              Stap 1a: Informatie Analyse - INCOMPLEET
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              De AI heeft vastgesteld dat er informatie ontbreekt. Bekijk hieronder wat er mist.
            </p>
          </div>
        </div>

        {/* Missing Information Block - Clean white/neutral design */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-base">Ontbrekende Informatie</CardTitle>
              <Badge variant="secondary" className="text-xs">
                {ontbrekendeInfo.length} items
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {ontbrekendeInfo.map((item: any, idx: number) => (
                <MissingInfoItem key={idx} item={item} index={idx} />
              ))}
            </div>

            {/* Fallback: Show old email fields if present (backward compat) */}
            {ontbrekendeInfo.length === 0 && parsedOutput.email_body && (
              <div className="pt-3 border-t">
                <p className="text-xs text-muted-foreground mb-2">Geen gestructureerde ontbrekende info gevonden:</p>
                <div
                  className="p-3 bg-muted/50 border border-input rounded text-sm"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(parsedOutput.email_body || "", {
                      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li'],
                      ALLOWED_ATTR: []
                    })
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Email Section - Generated from 1b */}
        {isGeneratingEmail && (
          <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                <div>
                  <p className="font-medium text-blue-900 dark:text-blue-100">Email wordt gegenereerd...</p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">Een concept email voor de klant wordt automatisch opgesteld.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {emailOutput && !isGeneratingEmail && (() => {
          // Clean up email output - handle various AI output formats
          let cleanedEmail = emailOutput;
          let emailSubject = "";

          // Try to parse as JSON first (format: {"email_subject": "...", "email_body": "..."})
          try {
            // Strip markdown code fences if present
            const jsonCandidate = emailOutput
              .replace(/^```json\s*/i, '')
              .replace(/^```\s*/gm, '')
              .replace(/```\s*$/g, '')
              .trim();

            // Check if it looks like JSON
            if (jsonCandidate.startsWith('{')) {
              const parsed = JSON.parse(jsonCandidate);
              if (parsed.email_body) {
                cleanedEmail = parsed.email_body;
                emailSubject = parsed.email_subject || "";
              }
            }
          } catch {
            // Not JSON, continue with string cleanup
          }

          // If still contains markdown fences, strip them
          cleanedEmail = cleanedEmail
            .replace(/^```html\s*/i, '')
            .replace(/^```\s*/gm, '')
            .replace(/```\s*$/g, '')
            .trim();

          return (
          <Card className="border-blue-200 dark:border-blue-800">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-600" />
                Concept Email naar Klant
              </CardTitle>
              <CardDescription>
                Kopieer deze email en verstuur naar de klant om de ontbrekende informatie op te vragen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {emailSubject && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-700">
                  <p className="text-sm">
                    <span className="font-medium text-blue-700 dark:text-blue-300">Onderwerp:</span>{" "}
                    <span className="text-blue-900 dark:text-blue-100">{emailSubject}</span>
                  </p>
                </div>
              )}
              <div
                className="p-4 bg-white dark:bg-gray-900 border border-input rounded-lg max-h-[300px] overflow-y-auto text-sm prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(cleanedEmail, {
                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3'],
                    ALLOWED_ATTR: []
                  })
                }}
              />
              <Button
                onClick={() => copyEmailToClipboard(cleanedEmail)}
                variant="outline"
                className="w-full"
              >
                {copiedEmail ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
                    Gekopieerd!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Kopieer Email
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        );
        })()}

        {!emailOutput && !isGeneratingEmail && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <p>
                <strong>Wachten op email generatie...</strong> De concept email wordt automatisch gegenereerd.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Raw JSON Toggle */}
        <Card className="border-dashed">
          <CardContent className="pt-4">
            <button
              onClick={() => setShowRawJson(!showRawJson)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              {showRawJson ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              <span className="font-medium">Geavanceerd: {showRawJson ? 'Verberg' : 'Toon'} ruwe JSON</span>
            </button>

            {showRawJson && (
              <div className="mt-3">
                <pre className="p-4 bg-muted rounded-lg text-xs overflow-x-auto max-h-[400px] overflow-y-auto break-all whitespace-pre-wrap">
                  <code className="break-all">{JSON.stringify(parsedOutput, null, 2)}</code>
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // INTERFACE_COMPLEET: Show generated dossier
  if (parsedOutput.status === "COMPLEET" && parsedOutput.dossier) {
    const { dossier } = parsedOutput;

    return (
      <div className="space-y-4">
        {/* Status Header */}
        <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
          <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
          <div className="flex-1">
            <h3 className="font-semibold text-green-900 dark:text-green-100">
              Stap 1a: Informatie Analyse - COMPLEET
            </h3>
            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
              De AI heeft een volledig dossier opgebouwd. Het dossier is klaar voor de volgende stap.
            </p>
          </div>
        </div>

        {/* Generated Dossier */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Gegenereerd Dossier</CardTitle>
            <CardDescription>
              Gestructureerde data opgebouwd uit de klantvraag
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Dossier Subject Summary */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Onderwerp Samenvatting
              </h4>
              <p className="text-base font-medium">
                {dossier.samenvatting_onderwerp}
              </p>
            </div>

            {/* Verbatim Client Questions */}
            {dossier.klantvraag_verbatim && dossier.klantvraag_verbatim.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Letterlijke Klantvra(a)g(en)
                </h4>
                <div className="space-y-2">
                  {dossier.klantvraag_verbatim.map((vraag, idx) => (
                    <blockquote
                      key={idx}
                      className="border-l-4 border-primary pl-4 py-2 italic text-sm bg-muted/30"
                    >
                      "{typeof vraag === 'object' ? JSON.stringify(vraag) : String(vraag)}"
                    </blockquote>
                  ))}
                </div>
              </div>
            )}

            {/* Structured Data Table */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Gestructureerde Dossiergegevens
              </h4>
              <div className="border rounded-lg overflow-hidden overflow-x-auto">
                <table className="w-full text-sm table-auto">
                  <tbody className="divide-y">
                    {/* Partijen */}
                    {dossier.gestructureerde_data.partijen && dossier.gestructureerde_data.partijen.length > 0 && (
                      <tr className="hover:bg-muted/50">
                        <td className="px-4 py-3 font-medium bg-muted/30 w-1/3 min-w-[120px]">
                          Partijen
                        </td>
                        <td className="px-4 py-3 break-words">
                          <div className="flex flex-wrap gap-1">
                            {dossier.gestructureerde_data.partijen.map((partij, idx) => (
                              <Badge key={idx} variant="outline" className="break-all max-w-full">
                                {typeof partij === 'object' ? JSON.stringify(partij) : String(partij)}
                              </Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Fiscale Partner */}
                    <tr className="hover:bg-muted/50">
                      <td className="px-4 py-3 font-medium bg-muted/30 min-w-[120px]">
                        Fiscale Partner
                      </td>
                      <td className="px-4 py-3 break-words">
                        <Badge variant={dossier.gestructureerde_data.fiscale_partner ? "default" : "secondary"}>
                          {dossier.gestructureerde_data.fiscale_partner ? "Ja" : "Nee"}
                        </Badge>
                      </td>
                    </tr>

                    {/* Relevante Bedragen */}
                    {dossier.gestructureerde_data.relevante_bedragen && Object.keys(dossier.gestructureerde_data.relevante_bedragen).length > 0 && (
                      <tr className="hover:bg-muted/50">
                        <td className="px-4 py-3 font-medium bg-muted/30 align-top min-w-[120px]">
                          Relevante Bedragen
                        </td>
                        <td className="px-4 py-3 break-words max-w-0">
                          <div className="space-y-2 text-xs">
                            {Object.entries(dossier.gestructureerde_data.relevante_bedragen).map(([key, value]) => {
                              // Handle nested objects by expanding them
                              if (typeof value === 'object' && value !== null) {
                                return (
                                  <div key={key} className="space-y-1">
                                    <div className="font-semibold text-muted-foreground">{key}:</div>
                                    <div className="pl-4 space-y-1 bg-muted/30 p-2 rounded">
                                      {Object.entries(value as Record<string, any>).map(([subKey, subValue]) => (
                                        <div key={subKey} className="flex justify-between gap-2 text-xs">
                                          <span className="text-muted-foreground break-all">{subKey}:</span>
                                          <span className="font-semibold text-right break-all">{String(subValue)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              }
                              // Simple value
                              return (
                                <div key={key} className="flex justify-between gap-2">
                                  <span className="text-muted-foreground break-all">{key}:</span>
                                  <span className="font-semibold font-mono text-right break-all">{String(value)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Overige Info */}
                    {dossier.gestructureerde_data.overige_info && dossier.gestructureerde_data.overige_info.length > 0 && (
                      <tr className="hover:bg-muted/50">
                        <td className="px-4 py-3 font-medium bg-muted/30 align-top min-w-[120px]">
                          Overige Informatie
                        </td>
                        <td className="px-4 py-3 break-words max-w-0">
                          <ul className="space-y-1 text-xs list-disc list-inside">
                            {dossier.gestructureerde_data.overige_info.map((info, idx) => (
                              <li key={idx}>{typeof info === 'object' ? JSON.stringify(info) : String(info)}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}

                    {/* Dynamic rendering of all other fields not explicitly handled above */}
                    {Object.entries(dossier.gestructureerde_data || {})
                      .filter(([key]) => !['partijen', 'fiscale_partner', 'relevante_bedragen', 'overige_info'].includes(key))
                      .map(([key, value]) => {
                        // Format the key name
                        const formattedKey = key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

                        return (
                          <tr key={key} className="hover:bg-muted/50">
                            <td className="px-4 py-3 font-medium bg-muted/30 align-top min-w-[120px]">
                              {formattedKey}
                            </td>
                            <td className="px-4 py-3 break-words max-w-0">
                              <div className="space-y-2 text-xs">
                                {typeof value === 'object' && value !== null ? (
                                  <pre className="whitespace-pre-wrap break-all bg-muted/30 p-2 rounded font-mono">
                                    {JSON.stringify(value, null, 2)}
                                  </pre>
                                ) : (
                                  <span className="font-mono">{String(value)}</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Next Step Info */}
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            Het dossier is compleet en klaar voor de volgende stap.
            <strong> Gebruik de navigatie hierboven om naar Stap 2 (Complexiteitscheck) te gaan wanneer je klaar bent.</strong>
          </AlertDescription>
        </Alert>

        {/* Raw JSON Toggle */}
        <Card className="border-dashed">
          <CardContent className="pt-4">
            <button
              onClick={() => setShowRawJson(!showRawJson)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              {showRawJson ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              <span className="font-medium">Geavanceerd: {showRawJson ? 'Verberg' : 'Toon'} ruwe JSON</span>
            </button>

            {showRawJson && (
              <div className="mt-3">
                <pre className="p-4 bg-muted rounded-lg text-xs overflow-x-auto max-h-[400px] overflow-y-auto break-all whitespace-pre-wrap">
                  <code className="break-all">{JSON.stringify(parsedOutput, null, 2)}</code>
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fallback: Unknown state
  return (
    <Alert variant="destructive">
      <AlertDescription>
        Onbekende status: {parsedOutput.status}
      </AlertDescription>
    </Alert>
  );
}
