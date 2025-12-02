import { useState, useCallback, memo, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Play, Zap, FolderOpen, Loader2, Upload, X, FileText } from "lucide-react";
import { Link, useLocation } from "wouter";
import WorkflowInterface from "@/components/workflow-interface";
import { AppHeader } from "@/components/app-header";
import { apiRequest } from "@/lib/queryClient";
import type { DossierData, BouwplanData, Report } from "@shared/schema";
import DOMPurify from "isomorphic-dompurify";

// Type for pending file uploads (stored in memory until case is created)
interface PendingFile {
  file: File;
  name: string;
  size: number;
  type: string;
}

const Pipeline = memo(function Pipeline() {
  const [rawText, setRawText] = useState(""); // Voor extra context/notities
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [finalReport, setFinalReport] = useState<string>("");
  const [createdReport, setCreatedReport] = useState<Report | null>(null);
  const [isCreatingCase, setIsCreatingCase] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]); // Files wachten tot case is gemaakt
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast} = useToast();
  const [, setLocation] = useLocation();

  
  // Direct workflow data
  const dossierData: DossierData = { 
    klant: { naam: "Client", situatie: "Direct processing" },
    fiscale_gegevens: { vermogen: 0, inkomsten: 0 }
  };
  const bouwplanData: BouwplanData = {
    fiscale_kernthemas: ["Test kernthema"],
    geidentificeerde_risicos: ["Test risico"],
    bouwplan_voor_rapport: {
      "1_inleiding": { koptekst: "Inleiding", subdoelen: [] },
      "2_analyse": { koptekst: "Analyse", subdoelen: [] }
    }
  };

  const handleWorkflowComplete = useCallback((report: Report) => {
    setFinalReport(report.generatedContent || "");
  }, []);

  // Stage files for upload (stored in memory until case is created)
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Add new files to pending list
    const newPendingFiles: PendingFile[] = Array.from(files).map(file => ({
      file,
      name: file.name,
      size: file.size,
      type: file.type,
    }));

    setPendingFiles(prev => [...prev, ...newPendingFiles]);

    toast({
      title: "Bestanden geselecteerd",
      description: `${newPendingFiles.length} bestand(en) klaar voor upload`,
    });

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [toast]);

  const handleRemoveFile = useCallback((fileName: string) => {
    setPendingFiles(prev => prev.filter(f => f.name !== fileName));
  }, []);

  // Upload attachments to a report (called after case is created)
  const uploadAttachments = useCallback(async (reportId: string, files: PendingFile[]): Promise<boolean> => {
    if (files.length === 0) return true;

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    files.forEach(pf => formData.append('files', pf.file));

    try {
      const response = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100);
            console.log(`📎 Upload progress: ${progress}%`);
            setUploadProgress(progress);
          }
        });

        xhr.addEventListener('load', () => {
          console.log('📎 Upload response received:', {
            status: xhr.status,
            statusText: xhr.statusText,
            responseLength: xhr.responseText?.length || 0,
            responsePreview: xhr.responseText?.substring(0, 500) || '(empty)',
            headers: xhr.getAllResponseHeaders()
          });

          if (xhr.status >= 200 && xhr.status < 300) {
            if (!xhr.responseText || xhr.responseText.length === 0) {
              reject(new Error('Server returned empty response - check server logs'));
              return;
            }
            try {
              const parsed = JSON.parse(xhr.responseText);
              resolve(parsed);
            } catch (e) {
              console.error('📎 JSON parse error:', e, 'Response:', xhr.responseText);
              reject(new Error(`Invalid JSON response: ${xhr.responseText?.substring(0, 100) || '(empty)'}`));
            }
          } else {
            // Try to extract error message from response
            try {
              const errorResponse = JSON.parse(xhr.responseText);
              const errorMsg = errorResponse?.error?.message || errorResponse?.error?.userMessage || errorResponse?.message || 'Upload mislukt';
              reject(new Error(errorMsg));
            } catch {
              reject(new Error(`Upload mislukt (status ${xhr.status}): ${xhr.responseText?.substring(0, 100) || '(empty)'}`));
            }
          }
        });

        xhr.addEventListener('error', (e) => {
          console.error('📎 XHR error event:', e);
          reject(new Error('Network error - connection failed'));
        });

        xhr.addEventListener('abort', () => {
          console.warn('📎 XHR aborted');
          reject(new Error('Upload cancelled'));
        });

        xhr.addEventListener('timeout', () => {
          console.error('📎 XHR timeout');
          reject(new Error('Upload timeout - server took too long'));
        });

        // Set a reasonable timeout (5 minutes for large files)
        xhr.timeout = 300000;

        xhr.open('POST', `/api/upload/attachments/${reportId}/batch`);
        xhr.withCredentials = true;
        xhr.send(formData);
      });

      if (response.success) {
        toast({
          title: "Bijlages opgeslagen",
          description: `${response.data.successful} bijlage(s) succesvol opgeslagen bij case`,
        });
        return true;
      }
      return false;
    } catch (error: any) {
      toast({
        title: "Bijlage upload mislukt",
        description: error.message,
        variant: "destructive",
      });
      return false;
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [toast]);

  const startWorkflow = useCallback(async () => {
    // Require either files OR text input
    if (!rawText.trim() && pendingFiles.length === 0) return;

    setIsCreatingCase(true);
    try {
      // Create the case immediately when "Start Case" is clicked
      const response = await apiRequest("POST", "/api/reports/create", {
        dossier: dossierData,
        bouwplan: bouwplanData,
        clientName: "Client",
        rawText: rawText.trim() || "(Zie bijlages)", // Fallback als alleen files
      });
      const data = await response.json();
      const report = (data && typeof data === 'object' && 'success' in data && data.success === true) ? data.data : data;

      console.log("🎯 Pipeline: Report created:", { reportId: report?.id });

      // Upload pending attachments to the new case
      if (pendingFiles.length > 0 && report?.id) {
        await uploadAttachments(report.id, pendingFiles);
      }

      toast({
        title: "Case aangemaakt",
        description: `Nieuwe case "${report.title}" met ${pendingFiles.length} bijlage(s) opgeslagen`,
      });

      // Navigate to the case detail page and auto-start workflow
      if (report?.id) {
        setLocation(`/cases/${report.id}?autoStart=true`);
      }

    } catch (error: any) {
      console.error('Failed to create case:', error);
      toast({
        title: "Fout bij aanmaken",
        description: error.message || "Er ging iets mis bij het aanmaken van de case",
        variant: "destructive",
      });
    } finally {
      setIsCreatingCase(false);
    }
  }, [rawText, pendingFiles, dossierData, bouwplanData, toast, uploadAttachments, setLocation]);


  return (
    <div className="min-h-screen bg-background">

      <AppHeader />

      {/* Hero Section - Compact */}
      <div className="border-b bg-gradient-to-r from-primary/5 to-secondary/5 py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Jan de <span className="text-primary">Belastingman</span>
            </h1>
            <p className="mt-2 text-muted-foreground">
              Fiscale Pipeline — van ruwe input naar compleet duidingsrapport in minuten.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">

        {/* Input + Start */}
        {!showWorkflow ? (
          <Card className="border-2 border-primary/20 shadow-xl bg-gradient-to-br from-card to-card/80">
            <CardHeader className="bg-gradient-to-r from-primary/5 to-secondary/5 border-b">
              <CardTitle className="text-2xl flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                Start Nieuwe Fiscale Analyse
              </CardTitle>
              <CardDescription className="text-base">
                Voer je fiscale vraagstuk in om direct een gestructureerde analyse te starten. 
                Alle workflows worden automatisch opgeslagen als cases.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 p-8">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Fiscale Input</label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.txt"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="gap-2"
                    >
                      {isUploading ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Verwerken...</>
                      ) : (
                        <><Upload className="h-4 w-4" /> Upload PDF/TXT</>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Upload Progress */}
                {isUploading && uploadProgress > 0 && (
                  <div className="space-y-2">
                    <Progress value={uploadProgress} className="h-2" />
                    <p className="text-xs text-muted-foreground text-center">
                      {uploadProgress}% geüpload
                    </p>
                  </div>
                )}

                {/* Pending files badges */}
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {pendingFiles.map((file) => (
                      <Badge key={file.name} variant="secondary" className="gap-2 pr-1">
                        <FileText className="h-3 w-3" />
                        <span className="text-xs">{file.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({Math.round(file.size / 1024)}KB)
                        </span>
                        <button
                          onClick={() => handleRemoveFile(file.name)}
                          className="ml-1 hover:bg-muted rounded-sm p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                <Textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={pendingFiles.length > 0
                    ? "Optioneel: voeg hier extra context of notities toe bij de geüploade bestanden..."
                    : `Upload PDF/TXT bestanden hierboven, of plak hier tekst:

• Klantsituatie en concrete vraag
• Email correspondentie
• Relevante feiten en bedragen

De AI analyseert zowel geüploade bestanden als tekst input.`}
                  className="min-h-40 resize-none border-primary/20 focus:border-primary/40 bg-white dark:bg-slate-800"
                  data-testid="textarea-raw-input"
                  aria-label="Fiscale input voor analyse - Voer klantsituatie, email correspondentie en relevante documenten in"
                />
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  onClick={startWorkflow}
                  disabled={(!rawText.trim() && pendingFiles.length === 0) || isCreatingCase || isUploading}
                  data-testid="button-start-workflow"
                  className="flex-1 h-12 text-base font-semibold bg-primary hover:bg-primary/90 shadow-lg"
                  size="lg"
                >
                  {isCreatingCase || isUploading ? (
                    <><Loader2 className="mr-3 h-5 w-5 animate-spin" />
                      {isUploading ? `Uploaden ${uploadProgress}%...` : 'Case aanmaken...'}
                    </>
                  ) : (
                    <><Play className="mr-3 h-5 w-5" /> Start Fiscale Analyse</>
                  )}
                </Button>
                <div className="sm:w-auto w-full">
                  <Link href="/cases" asChild>
                    <Button variant="outline" data-testid="button-view-cases" className="h-12 w-full border-primary/20 hover:border-primary/40">
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Bekijk Bestaande Cases
                    </Button>
                  </Link>
                </div>
              </div>
              
              {!rawText.trim() && pendingFiles.length === 0 && (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">💡 Upload PDF bestanden of voer tekst in om te starten</p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <WorkflowInterface
            dossier={dossierData}
            bouwplan={bouwplanData}
            clientName="Client"
            rawText={rawText}
            onComplete={handleWorkflowComplete}
            existingReport={createdReport || undefined}
          />
        )}

        {/* Final Report */}
        {finalReport && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Rapport Voltooid</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(finalReport, {
                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
                    ALLOWED_ATTR: ['href', 'class', 'id']
                  })
                }}
              />
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
});

export default Pipeline;