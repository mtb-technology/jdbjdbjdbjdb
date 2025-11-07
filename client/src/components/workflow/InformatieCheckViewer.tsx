import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Copy, CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import type { InformatieCheckOutput } from "@shared/schema";
import { parseInformatieCheckOutput } from "@/lib/workflowParsers";

interface InformatieCheckViewerProps {
  /** Raw AI output from Stage 1 (Informatiecheck) */
  rawOutput: string;
}

/**
 * Displays structured output for Stage 1 (Informatiecheck)
 * Shows either:
 * - Email interface for INCOMPLEET status (missing information)
 * - Dossier summary for COMPLEET status (complete information)
 */
export function InformatieCheckViewer({ rawOutput }: InformatieCheckViewerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);

  const parsedOutput = parseInformatieCheckOutput(rawOutput);

  if (!parsedOutput) {
    // Fallback: show raw output if parsing fails
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <p className="font-semibold mb-2">Fout bij het parsen van de informatiecheck output</p>
          <p className="text-xs mb-3">De AI heeft geen geldig JSON formaat geretourneerd. Hieronder de ruwe output:</p>
          <pre className="whitespace-pre-wrap text-xs bg-black/10 p-3 rounded mt-2 max-h-[400px] overflow-y-auto">
            {rawOutput}
          </pre>
        </AlertDescription>
      </Alert>
    );
  }

  // Copy to clipboard with HTML support
  const copyToClipboard = async (text: string, field: string, isHtml: boolean = false) => {
    try {
      if (isHtml && navigator.clipboard.write) {
        // Rich text copy (HTML) - for email body
        const htmlBlob = new Blob([text], { type: 'text/html' });
        const plainBlob = new Blob([text.replace(/<[^>]*>/g, '')], { type: 'text/plain' });
        const clipboardItem = new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': plainBlob
        });
        await navigator.clipboard.write([clipboardItem]);
      } else {
        // Plain text copy
        await navigator.clipboard.writeText(text);
      }
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      // Fallback: plain text only
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  // INTERFACE_INCOMPLEET: Show email action
  if (parsedOutput.status === "INCOMPLEET") {
    return (
      <div className="space-y-4">
        {/* Status Header */}
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
          <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
          <div className="flex-1">
            <h3 className="font-semibold text-red-900 dark:text-red-100">
              Stap 1: Informatiecheck - INCOMPLEET
            </h3>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              De AI heeft vastgesteld dat er informatie ontbreekt. De workflow is gepauzeerd.
              Verstuur de onderstaande e-mail naar de klant.
            </p>
          </div>
        </div>

        {/* Email Action Block */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Verstuur E-mail naar Klant</CardTitle>
            <CardDescription>
              Kopieer het onderwerp en de body naar je e-mailclient (Gmail, Outlook, etc.)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Email Subject */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                E-mail Onderwerp
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 px-3 py-2 bg-muted/50 border border-input rounded-md text-sm font-mono"
                  value={parsedOutput.email_subject || ""}
                  readOnly
                  disabled
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(parsedOutput.email_subject || "", "subject")}
                  className="shrink-0"
                >
                  {copiedField === "subject" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Gekopieerd
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-1" />
                      Kopieer
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Email Body Preview */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                E-mail Inhoud (Preview)
              </label>
              <div
                className="p-4 bg-white dark:bg-gray-900 border border-input rounded-lg max-h-[400px] overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: parsedOutput.email_body || "" }}
              />
            </div>

            {/* Copy Email Body Button */}
            <Button
              variant="default"
              className="w-full"
              onClick={() => copyToClipboard(parsedOutput.email_body || "", "body", true)}
            >
              {copiedField === "body" ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  E-mail Body Gekopieerd (met opmaak)
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Kopieer E-mail Body (met opmaak)
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              De opmaak (vet, bullets, etc.) blijft behouden wanneer je plakt in Gmail of Outlook
            </p>
          </CardContent>
        </Card>

        {/* Navigation Blocked */}
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertDescription>
            De volgende stap (2. Complexiteitscheck) is geblokkeerd totdat de klant de ontbrekende informatie aanlevert.
            Voer deze stap opnieuw uit nadat je de informatie hebt ontvangen.
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
                <pre className="p-4 bg-muted rounded-lg text-xs overflow-x-auto max-h-[400px] overflow-y-auto">
                  <code>{JSON.stringify(parsedOutput, null, 2)}</code>
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
              Stap 1: Informatiecheck - COMPLEET
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
                      "{vraag}"
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
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {/* Partijen */}
                    {dossier.gestructureerde_data.partijen && dossier.gestructureerde_data.partijen.length > 0 && (
                      <tr className="hover:bg-muted/50">
                        <td className="px-4 py-3 font-medium bg-muted/30 w-1/3">
                          Partijen
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {dossier.gestructureerde_data.partijen.map((partij, idx) => (
                              <Badge key={idx} variant="outline">{partij}</Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Fiscale Partner */}
                    <tr className="hover:bg-muted/50">
                      <td className="px-4 py-3 font-medium bg-muted/30">
                        Fiscale Partner
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={dossier.gestructureerde_data.fiscale_partner ? "default" : "secondary"}>
                          {dossier.gestructureerde_data.fiscale_partner ? "Ja" : "Nee"}
                        </Badge>
                      </td>
                    </tr>

                    {/* Relevante Bedragen */}
                    {dossier.gestructureerde_data.relevante_bedragen && Object.keys(dossier.gestructureerde_data.relevante_bedragen).length > 0 && (
                      <tr className="hover:bg-muted/50">
                        <td className="px-4 py-3 font-medium bg-muted/30">
                          Relevante Bedragen
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1 text-xs font-mono">
                            {Object.entries(dossier.gestructureerde_data.relevante_bedragen).map(([key, value]) => (
                              <div key={key} className="flex justify-between">
                                <span className="text-muted-foreground">{key}:</span>
                                <span className="font-semibold">{value}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Overige Info */}
                    {dossier.gestructureerde_data.overige_info && dossier.gestructureerde_data.overige_info.length > 0 && (
                      <tr className="hover:bg-muted/50">
                        <td className="px-4 py-3 font-medium bg-muted/30 align-top">
                          Overige Informatie
                        </td>
                        <td className="px-4 py-3">
                          <ul className="space-y-1 text-xs list-disc list-inside">
                            {dossier.gestructureerde_data.overige_info.map((info, idx) => (
                              <li key={idx}>{info}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
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
                <pre className="p-4 bg-muted rounded-lg text-xs overflow-x-auto max-h-[400px] overflow-y-auto">
                  <code>{JSON.stringify(parsedOutput, null, 2)}</code>
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
