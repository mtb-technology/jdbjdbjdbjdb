import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Copy, CheckCircle2, XCircle, ChevronDown, ChevronUp, AlertTriangle, Mail, Loader2, Building2, Landmark, TrendingUp, FileText, Calendar, ArrowRightLeft, Receipt, FolderOpen } from "lucide-react";
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

/**
 * Format currency with proper locale
 */
function formatCurrency(amount: number | null | undefined, currency = "EUR"): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Renders the vermogensoverzicht per peildatum as a clear table
 */
function VermogensoverzichtTable({ data }: { data: Record<string, any> }) {
  const peildata = Object.keys(data).sort();
  const [expandedYear, setExpandedYear] = useState<string | null>(peildata[peildata.length - 1] || null);

  if (peildata.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Vermogensoverzicht per Peildatum
        </h4>
        <Badge variant="secondary" className="text-xs">{peildata.length} jaren</Badge>
      </div>

      <div className="space-y-2">
        {peildata.map((peildatum) => {
          const yearData = data[peildatum];
          const isExpanded = expandedYear === peildatum;
          const displayDate = peildatum.replace(/-/g, "/");

          // Calculate totals for summary
          const vastgoedTotal = (yearData.vastgoed || []).reduce((sum: number, v: any) =>
            sum + (v.marktwaarde_EUR || 0), 0);
          const bankTotal = (yearData.bankrekeningen || []).reduce((sum: number, b: any) =>
            sum + (b.saldo_EUR || 0), 0);
          const totaal = vastgoedTotal + bankTotal;

          return (
            <Collapsible key={peildatum} open={isExpanded} onOpenChange={() => setExpandedYear(isExpanded ? null : peildatum)}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono">{displayDate}</Badge>
                    <span className="text-sm font-medium">Totaal: {formatCurrency(totaal)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                      {vastgoedTotal > 0 && (
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {formatCurrency(vastgoedTotal)}
                        </span>
                      )}
                      {bankTotal > 0 && (
                        <span className="flex items-center gap-1">
                          <Landmark className="h-3 w-3" />
                          {formatCurrency(bankTotal)}
                        </span>
                      )}
                    </div>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 ml-2 border-l-2 border-muted pl-4 space-y-4 pb-2">
                  {/* Vastgoed */}
                  {yearData.vastgoed && yearData.vastgoed.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Building2 className="h-4 w-4" />
                        Vastgoed
                      </div>
                      <div className="grid gap-2">
                        {yearData.vastgoed.map((item: any, idx: number) => (
                          <div key={idx} className="p-3 rounded-lg bg-muted/30 text-sm space-y-1">
                            <div className="font-medium">{item.omschrijving}</div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                              {item.marktwaarde_EUR !== null && item.marktwaarde_EUR !== undefined && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Marktwaarde:</span>
                                  <span className="font-mono font-semibold text-green-600">{formatCurrency(item.marktwaarde_EUR)}</span>
                                </div>
                              )}
                              {item.lokale_waarde && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">{item.lokale_waarde.type || "Lokale waarde"}:</span>
                                  <span className="font-mono">{formatCurrency(item.lokale_waarde.bedrag, item.lokale_waarde.valuta)}</span>
                                </div>
                              )}
                              {item.eigendomspercentage && item.eigendomspercentage !== 100 && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Eigendom:</span>
                                  <span className="font-mono">{item.eigendomspercentage}%</span>
                                </div>
                              )}
                              {item.bron_waardering && (
                                <div className="flex justify-between col-span-2">
                                  <span className="text-muted-foreground">Bron:</span>
                                  <span className="text-right">{item.bron_waardering}</span>
                                </div>
                              )}
                            </div>
                            {item.opmerking && (
                              <p className="text-xs text-muted-foreground italic mt-1">{item.opmerking}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Bankrekeningen */}
                  {yearData.bankrekeningen && yearData.bankrekeningen.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Landmark className="h-4 w-4" />
                        Bankrekeningen
                      </div>
                      <div className="grid gap-2">
                        {yearData.bankrekeningen.map((item: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-2 rounded bg-muted/30 text-sm">
                            <span>{item.omschrijving}</span>
                            <div className="flex items-center gap-3">
                              <span className="font-mono font-semibold text-green-600">{formatCurrency(item.saldo_EUR)}</span>
                              {item.saldo_lokaal && (
                                <span className="text-xs text-muted-foreground font-mono">
                                  ({formatCurrency(item.saldo_lokaal.bedrag, item.saldo_lokaal.valuta)})
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Effecten */}
                  {yearData.effecten && yearData.effecten.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <TrendingUp className="h-4 w-4" />
                        Effecten
                      </div>
                      <div className="grid gap-2">
                        {yearData.effecten.map((item: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-2 rounded bg-muted/30 text-sm">
                            <span>{item.omschrijving}</span>
                            <span className="font-mono font-semibold">{formatCurrency(item.waarde_EUR)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Schulden */}
                  {yearData.schulden && yearData.schulden.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-red-600">
                        <ArrowRightLeft className="h-4 w-4" />
                        Schulden
                      </div>
                      <div className="grid gap-2">
                        {yearData.schulden.map((item: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-2 rounded bg-red-50 dark:bg-red-950/20 text-sm">
                            <span>{item.omschrijving}</span>
                            <span className="font-mono font-semibold text-red-600">-{formatCurrency(item.bedrag_EUR)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Renders transacties list
 */
function TransactiesTable({ data }: { data: any[] }) {
  if (!data || data.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Transacties
        </h4>
        <Badge variant="secondary" className="text-xs">{data.length}</Badge>
      </div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Omschrijving</th>
              <th className="px-3 py-2 text-left font-medium">Datum</th>
              <th className="px-3 py-2 text-right font-medium">Bedrag</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.map((tx, idx) => (
              <tr key={idx} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Badge variant={tx.type?.toLowerCase().includes("verkoop") ? "default" : "outline"} className="text-xs">
                    {tx.type}
                  </Badge>
                </td>
                <td className="px-3 py-2">{tx.omschrijving}</td>
                <td className="px-3 py-2 font-mono text-xs">{tx.datum}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {tx.bedrag_EUR ? formatCurrency(tx.bedrag_EUR) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Renders inkomsten buitenland
 */
function InkomstenBuitenlandTable({ data }: { data: any[] }) {
  if (!data || data.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Receipt className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Inkomsten Buitenland
        </h4>
      </div>
      <div className="space-y-3">
        {data.map((item, idx) => (
          <div key={idx} className="p-3 rounded-lg border bg-card">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-sm">{item.type}</span>
              {item.reeds_aangegeven && (
                <Badge variant="secondary" className="text-xs">Reeds aangegeven</Badge>
              )}
            </div>
            {item.bedragen_per_jaar && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {Object.entries(item.bedragen_per_jaar).map(([jaar, bedragen]: [string, any]) => (
                  <div key={jaar} className="p-2 rounded bg-muted/30">
                    <div className="font-medium">{jaar}</div>
                    <div className="font-mono text-green-600">
                      {formatCurrency(bedragen.bruto_EUR || bedragen.netto_EUR)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {item.toelichting && (
              <p className="text-xs text-muted-foreground mt-2 italic">{item.toelichting}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders beschikbare documenten overview
 */
function BeschikbareDocumentenTable({ data }: { data: any }) {
  if (!data) return null;

  const { aangiftes, aanslagen, overige } = data;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Beschikbare Documenten
        </h4>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {/* Aangiftes */}
        {aangiftes && Object.keys(aangiftes).length > 0 && (
          <div className="p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-blue-500" />
              <span className="font-medium text-sm">Aangiftes</span>
            </div>
            <div className="space-y-1">
              {Object.entries(aangiftes).map(([jaar, info]: [string, any]) => (
                <div key={jaar} className="flex items-center justify-between text-xs">
                  <span className="font-mono">{jaar}</span>
                  {info.aanwezig ? (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {info.type || "Aanwezig"}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-red-600 border-red-300">
                      <XCircle className="h-3 w-3 mr-1" />
                      Ontbreekt
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Aanslagen */}
        {aanslagen && Object.keys(aanslagen).length > 0 && (
          <div className="p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-purple-500" />
              <span className="font-medium text-sm">Aanslagen</span>
            </div>
            <div className="space-y-1">
              {Object.entries(aanslagen).map(([jaar, info]: [string, any]) => (
                <div key={jaar} className="flex items-center justify-between text-xs">
                  <span className="font-mono">{jaar}</span>
                  {info.aanwezig ? (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {info.type || "Aanwezig"}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300" title={info.opmerking}>
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      {info.opmerking ? "Niet beschikbaar" : "Ontbreekt"}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Overige documenten */}
      {overige && overige.length > 0 && (
        <div className="p-3 rounded-lg border bg-muted/30">
          <div className="text-xs font-medium text-muted-foreground mb-1">Overige documenten:</div>
          <div className="flex flex-wrap gap-1">
            {overige.map((doc: string, idx: number) => (
              <Badge key={idx} variant="secondary" className="text-xs">{doc}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
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
    // Cast to any because the new prompt generates a more comprehensive structure
    // than the original TypeScript schema defines
    const data = (dossier.gestructureerde_data || {}) as Record<string, any>;

    // Fields that have dedicated renderers - exclude from generic table
    const specialFields = [
      'partijen', 'fiscale_partner', 'fiscaal_partnerschap', 'relevante_jaren',
      'vermogensoverzicht_per_peildatum', 'transacties', 'inkomsten_buitenland',
      'beschikbare_documenten', 'relevante_bedragen', 'overige_info', '_validatie'
    ];

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

            {/* Basic Info Table - Partijen, Fiscaal Partner, Jaren */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Basis Gegevens
              </h4>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {/* Partijen */}
                    {data.partijen && data.partijen.length > 0 && (
                      <tr className="hover:bg-muted/50">
                        <td className="px-4 py-3 font-medium bg-muted/30 w-1/4">Partijen</td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {data.partijen.map((partij: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-2">
                                {typeof partij === 'object' ? (
                                  <>
                                    <Badge variant="outline">{partij.naam}</Badge>
                                    {partij.rol && <span className="text-xs text-muted-foreground">({partij.rol})</span>}
                                    {partij.bsn && <span className="text-xs font-mono text-muted-foreground">BSN: {partij.bsn}</span>}
                                  </>
                                ) : (
                                  <Badge variant="outline">{String(partij)}</Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Fiscaal Partnerschap */}
                    {(data.fiscaal_partnerschap !== undefined || data.fiscale_partner !== undefined) && (
                      <tr className="hover:bg-muted/50">
                        <td className="px-4 py-3 font-medium bg-muted/30">Fiscaal Partnerschap</td>
                        <td className="px-4 py-3">
                          <Badge variant={(data.fiscaal_partnerschap || data.fiscale_partner) ? "default" : "secondary"}>
                            {(data.fiscaal_partnerschap || data.fiscale_partner) ? "Ja" : "Nee"}
                          </Badge>
                        </td>
                      </tr>
                    )}

                    {/* Relevante Jaren */}
                    {data.relevante_jaren && data.relevante_jaren.length > 0 && (
                      <tr className="hover:bg-muted/50">
                        <td className="px-4 py-3 font-medium bg-muted/30">Belastingjaren</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {data.relevante_jaren.map((jaar: string, idx: number) => (
                              <Badge key={idx} variant="outline" className="font-mono">{jaar}</Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Relevante Data (kernfeiten, dossier_type etc) */}
                    {data.relevante_data && Object.keys(data.relevante_data).length > 0 && (
                      <>
                        {data.relevante_data.dossier_type && (
                          <tr className="hover:bg-muted/50">
                            <td className="px-4 py-3 font-medium bg-muted/30">Dossier Type</td>
                            <td className="px-4 py-3">
                              <Badge>{data.relevante_data.dossier_type}</Badge>
                            </td>
                          </tr>
                        )}
                        {data.relevante_data.kernfeiten && (
                          <tr className="hover:bg-muted/50">
                            <td className="px-4 py-3 font-medium bg-muted/30 align-top">Kernfeiten</td>
                            <td className="px-4 py-3">
                              <div className="space-y-1 text-sm">
                                {Object.entries(data.relevante_data.kernfeiten).map(([key, value]: [string, any]) => (
                                  <div key={key} className="flex gap-2">
                                    <span className="text-muted-foreground">{key.replace(/_/g, ' ')}:</span>
                                    <span className="font-medium">{String(value)}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Vermogensoverzicht per Peildatum - NEW dedicated component */}
            {data.vermogensoverzicht_per_peildatum && (
              <VermogensoverzichtTable data={data.vermogensoverzicht_per_peildatum} />
            )}

            {/* Transacties - NEW dedicated component */}
            {data.transacties && data.transacties.length > 0 && (
              <TransactiesTable data={data.transacties} />
            )}

            {/* Inkomsten Buitenland - NEW dedicated component */}
            {data.inkomsten_buitenland && data.inkomsten_buitenland.length > 0 && (
              <InkomstenBuitenlandTable data={data.inkomsten_buitenland} />
            )}

            {/* Beschikbare Documenten - NEW dedicated component */}
            {data.beschikbare_documenten && (
              <BeschikbareDocumentenTable data={data.beschikbare_documenten} />
            )}

            {/* Legacy: Relevante Bedragen (for backward compatibility with old format) */}
            {data.relevante_bedragen && Object.keys(data.relevante_bedragen).length > 0 && !data.vermogensoverzicht_per_peildatum && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Relevante Bedragen
                </h4>
                <div className="border rounded-lg p-4 space-y-2 text-sm">
                  {Object.entries(data.relevante_bedragen).map(([key, value]) => {
                    if (typeof value === 'object' && value !== null) {
                      return (
                        <div key={key} className="space-y-1">
                          <div className="font-semibold text-muted-foreground">{key}:</div>
                          <div className="pl-4 space-y-1 bg-muted/30 p-2 rounded text-xs">
                            {Object.entries(value as Record<string, any>).map(([subKey, subValue]) => (
                              <div key={subKey} className="flex justify-between gap-2">
                                <span className="text-muted-foreground">{subKey}:</span>
                                <span className="font-semibold">{String(subValue)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={key} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{key}:</span>
                        <span className="font-semibold font-mono">{String(value)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Overige Sleutelinformatie */}
            {data.overige_sleutelinformatie && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Overige Sleutelinformatie
                </h4>
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-sm">
                  {data.overige_sleutelinformatie}
                </div>
              </div>
            )}

            {/* Validation info (if present) */}
            {data._validatie && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Validatie
                </h4>
                <div className="p-3 rounded-lg bg-muted/30 text-xs space-y-2">
                  {data._validatie.aannames && data._validatie.aannames.length > 0 && (
                    <div>
                      <span className="font-medium">Aannames:</span>
                      <ul className="list-disc list-inside mt-1 space-y-0.5">
                        {data._validatie.aannames.map((a: any, idx: number) => (
                          <li key={idx}>{a.aanname} <span className="text-muted-foreground">({a.bron})</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {data._validatie.ontbrekende_data_geaccepteerd && data._validatie.ontbrekende_data_geaccepteerd.length > 0 && (
                    <div>
                      <span className="font-medium">Geaccepteerd ontbrekend:</span>
                      <ul className="list-disc list-inside mt-1 space-y-0.5">
                        {data._validatie.ontbrekende_data_geaccepteerd.map((o: any, idx: number) => (
                          <li key={idx}>{o.item} <span className="text-muted-foreground">({o.reden_acceptatie})</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Any remaining fields not handled above */}
            {Object.entries(data)
              .filter(([key]) => !specialFields.includes(key) && !['relevante_data', 'overige_sleutelinformatie'].includes(key))
              .length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Overige Gegevens
                </h4>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody className="divide-y">
                      {Object.entries(data)
                        .filter(([key]) => !specialFields.includes(key) && !['relevante_data', 'overige_sleutelinformatie'].includes(key))
                        .map(([key, value]) => {
                          const formattedKey = key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                          return (
                            <tr key={key} className="hover:bg-muted/50">
                              <td className="px-4 py-3 font-medium bg-muted/30 w-1/4 align-top">{formattedKey}</td>
                              <td className="px-4 py-3">
                                {typeof value === 'object' && value !== null ? (
                                  <pre className="whitespace-pre-wrap text-xs bg-muted/30 p-2 rounded font-mono">
                                    {JSON.stringify(value, null, 2)}
                                  </pre>
                                ) : (
                                  <span>{String(value)}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
