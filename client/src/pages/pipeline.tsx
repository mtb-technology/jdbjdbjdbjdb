import { useState, useCallback, memo, useRef, DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Play, FolderOpen, Loader2, Upload, X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";
import WorkflowInterface from "@/components/workflow-interface";
import { AppHeader } from "@/components/app-header";
import { apiRequest } from "@/lib/queryClient";
import type { DossierData, BouwplanData, Report } from "@shared/schema";
import DOMPurify from "isomorphic-dompurify";
import imageCompression from "browser-image-compression";
import { UPLOAD_LIMITS, getOversizedFilesMessage } from "@/constants/upload.constants";

// Type for pending file uploads (stored in memory until case is created)
interface PendingFile {
  file: File;
  name: string;
  size: number;
  type: string;
  originalSize?: number; // Track original size before compression
  wasCompressed?: boolean;
}

// Compress images before upload (maintains quality while reducing file size)
async function compressImageFile(file: File): Promise<{ file: File; wasCompressed: boolean; originalSize: number }> {
  const originalSize = file.size;
  const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(file.name);

  // Only compress images larger than 1MB
  if (!isImage || file.size < 1024 * 1024) {
    return { file, wasCompressed: false, originalSize };
  }

  try {
    const options = {
      maxSizeMB: 2, // Target max 2MB per image
      maxWidthOrHeight: 2400, // Max dimension (maintains aspect ratio)
      useWebWorker: true,
      fileType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
      initialQuality: 0.85, // Start at 85% quality
      alwaysKeepResolution: true, // Don't downscale unless needed
    };

    const compressedFile = await imageCompression(file, options);

    // Only use compressed version if it's actually smaller
    if (compressedFile.size < file.size) {
      console.log(`🗜️ Compressed ${file.name}: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB (${Math.round((1 - compressedFile.size / originalSize) * 100)}% reduction)`);

      // Create a new File object with the original name
      const newFile = new File([compressedFile], file.name, { type: compressedFile.type });
      return { file: newFile, wasCompressed: true, originalSize };
    }

    return { file, wasCompressed: false, originalSize };
  } catch (error) {
    console.warn(`⚠️ Could not compress ${file.name}:`, error);
    return { file, wasCompressed: false, originalSize };
  }
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
  const [uploadStatus, setUploadStatus] = useState<string>(''); // Status message during upload/processing
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const { toast} = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  
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

    // Validate file sizes before accepting
    const validFiles: File[] = [];
    const rejectedFiles: { name: string; size: number }[] = [];

    Array.from(files).forEach(file => {
      if (file.size > UPLOAD_LIMITS.MAX_FILE_SIZE_BYTES) {
        rejectedFiles.push({ name: file.name, size: file.size });
      } else {
        validFiles.push(file);
      }
    });

    // Show error for rejected files
    if (rejectedFiles.length > 0) {
      const rejectedNames = rejectedFiles
        .map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB)`)
        .join(', ');
      toast({
        title: "Bestand(en) te groot",
        description: getOversizedFilesMessage(rejectedNames),
        variant: "destructive",
      });
    }

    if (validFiles.length === 0) {
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    // Add valid files to pending list
    const newPendingFiles: PendingFile[] = validFiles.map(file => ({
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

  // Drag-and-drop handlers
  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the drop zone entirely
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;

    // Validate file sizes and types
    const validFiles: File[] = [];
    const rejectedFiles: { name: string; size: number; reason: string }[] = [];

    Array.from(droppedFiles).forEach(file => {
      // Check file type
      const validTypes = ['.pdf', '.txt', '.jpg', '.jpeg', '.png'];
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!validTypes.includes(ext)) {
        rejectedFiles.push({ name: file.name, size: file.size, reason: 'type' });
        return;
      }

      // Check file size
      if (file.size > UPLOAD_LIMITS.MAX_FILE_SIZE_BYTES) {
        rejectedFiles.push({ name: file.name, size: file.size, reason: 'size' });
        return;
      }

      validFiles.push(file);
    });

    // Show error for rejected files
    if (rejectedFiles.length > 0) {
      const sizeRejected = rejectedFiles.filter(f => f.reason === 'size');
      const typeRejected = rejectedFiles.filter(f => f.reason === 'type');

      if (sizeRejected.length > 0) {
        const rejectedNames = sizeRejected
          .map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB)`)
          .join(', ');
        toast({
          title: "Bestand(en) te groot",
          description: getOversizedFilesMessage(rejectedNames),
          variant: "destructive",
        });
      }

      if (typeRejected.length > 0) {
        toast({
          title: "Ongeldig bestandstype",
          description: `Alleen PDF, TXT, JPG en PNG bestanden zijn toegestaan.`,
          variant: "destructive",
        });
      }
    }

    if (validFiles.length === 0) return;

    // Add valid files to pending list
    const newPendingFiles: PendingFile[] = validFiles.map(file => ({
      file,
      name: file.name,
      size: file.size,
      type: file.type,
    }));

    setPendingFiles(prev => [...prev, ...newPendingFiles]);

    toast({
      title: "Bestanden toegevoegd",
      description: `${newPendingFiles.length} bestand(en) klaar voor upload`,
    });
  }, [toast]);

  // Upload attachments to a report (called after case is created)
  // Returns { success: boolean, needsOcr: boolean }
  const uploadAttachments = useCallback(async (reportId: string, files: PendingFile[]): Promise<{ success: boolean; needsOcr: boolean }> => {
    if (files.length === 0) return { success: true, needsOcr: false };

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatus('Bestanden voorbereiden...');

    try {
      // Compress images before upload
      console.log('🗜️ Compressing images before upload...');
      const compressedFiles: File[] = [];
      let totalSaved = 0;

      for (let i = 0; i < files.length; i++) {
        const pf = files[i];
        setUploadStatus(`Comprimeren ${i + 1}/${files.length}: ${pf.name.substring(0, 25)}...`);
        const { file: processedFile, wasCompressed, originalSize } = await compressImageFile(pf.file);
        compressedFiles.push(processedFile);
        if (wasCompressed) {
          totalSaved += originalSize - processedFile.size;
        }
      }

      if (totalSaved > 0) {
        console.log(`🗜️ Total compression savings: ${(totalSaved / 1024 / 1024).toFixed(2)}MB`);
        toast({
          title: "Bestanden gecomprimeerd",
          description: `${(totalSaved / 1024 / 1024).toFixed(1)}MB bespaard door compressie`,
        });
      }

      const formData = new FormData();
      compressedFiles.forEach((file, index) => {
        formData.append('files', file, files[index].name); // Use original filename
      });

      setUploadStatus(`Uploaden (${files.length} bestanden)...`);

      const response = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100);
            console.log(`📎 Upload progress: ${progress}%`);
            setUploadProgress(progress);
            if (progress >= 100) {
              // Upload done, server is now processing (OCR, PDF parsing)
              setUploadStatus('Server verwerkt documenten (OCR/tekst extractie)...');
            }
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
            // Map HTTP status codes to user-friendly Dutch error messages
            const getErrorMessage = (status: number, responseText: string): string => {
              switch (status) {
                case 413:
                  return 'Bestand(en) te groot. Maximum uploadgrootte is 50MB per bestand en 100MB totaal.';
                case 401:
                  return 'Sessie verlopen. Ververs de pagina en log opnieuw in.';
                case 403:
                  return 'Geen toegang tot deze functie. Neem contact op met de beheerder.';
                case 404:
                  return 'Case niet gevonden. Mogelijk is deze verwijderd.';
                case 500:
                  return 'Serverfout bij het opslaan. Probeer het opnieuw of neem contact op met support.';
                case 502:
                case 503:
                case 504:
                  return 'Server tijdelijk niet beschikbaar. Probeer het over enkele minuten opnieuw.';
                default:
                  // Try to extract message from JSON response
                  try {
                    const errorResponse = JSON.parse(responseText);
                    return errorResponse?.error?.message || errorResponse?.error?.userMessage || errorResponse?.message || `Upload mislukt (foutcode ${status})`;
                  } catch {
                    return `Upload mislukt (foutcode ${status}). Probeer het opnieuw.`;
                  }
              }
            };
            reject(new Error(getErrorMessage(xhr.status, xhr.responseText)));
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
        const { needsOcr, ocrPendingCount } = response.data;
        if (needsOcr) {
          toast({
            title: "Bijlages opgeslagen - OCR bezig",
            description: `${response.data.successful} bijlage(s) opgeslagen. ${ocrPendingCount} document(en) worden nog verwerkt (scans/afbeeldingen).`,
          });
        } else {
          toast({
            title: "Bijlages opgeslagen",
            description: `${response.data.successful} bijlage(s) succesvol opgeslagen`,
          });
        }
        // Return object with success and needsOcr flag
        return { success: true, needsOcr: needsOcr || false };
      }
      return { success: false, needsOcr: false };
    } catch (error: any) {
      toast({
        title: "Bijlage upload mislukt",
        description: error.message,
        variant: "destructive",
      });
      return { success: false, needsOcr: false };
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus('');
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

      // Invalidate cases cache so the new case appears in the list
      queryClient.invalidateQueries({ queryKey: ["/api/cases"], refetchType: 'all' });

      // Upload attachments BEFORE navigating - Stage 1 needs document data in prompt
      let needsOcr = false;
      if (pendingFiles.length > 0 && report?.id) {
        const uploadResult = await uploadAttachments(report.id, pendingFiles);

        if (!uploadResult.success) {
          toast({
            title: "Case aangemaakt, maar bijlages niet geüpload",
            description: `Case "${report.title}" is aangemaakt. Ga naar de case om bijlages handmatig toe te voegen.`,
            variant: "destructive",
          });
          // Navigate without autoStart so user can fix attachments
          setLocation(`/cases/${report.id}`);
          return;
        }
        needsOcr = uploadResult.needsOcr;
      }

      // If OCR is needed, don't auto-start workflow - user must wait for OCR to complete
      if (needsOcr) {
        toast({
          title: "Case aangemaakt - wacht op OCR",
          description: `Case "${report.title}" aangemaakt. Wacht tot de scans zijn verwerkt voordat je de analyse start.`,
        });
        // Navigate WITHOUT autoStart - user must manually start after OCR completes
        setLocation(`/cases/${report.id}`);
        return;
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
  }, [rawText, pendingFiles, dossierData, bouwplanData, toast, uploadAttachments, setLocation, queryClient]);


  return (
    <div className="min-h-screen relative">
      {/* Full-page gradient background */}
      <div className="fixed inset-0 bg-gradient-to-br from-[#F5A623]/5 via-slate-50 to-[#1E4DB7]/5 dark:via-slate-950" />
      <div className="fixed top-0 right-0 w-[600px] h-[600px] bg-[#F5A623]/10 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3" />
      <div className="fixed bottom-0 left-0 w-[600px] h-[600px] bg-[#1E4DB7]/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3" />

      <div className="relative">
        <AppHeader />

        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12">
          {/* Page Title */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              Nieuwe Analyse
            </h1>
            <p className="text-muted-foreground">
              Van ruwe input naar compleet duidingsrapport in minuten
            </p>
          </div>

          {/* Main Input Card */}
          {!showWorkflow ? (
            <Card className="border-0 shadow-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm">
              <CardContent className="p-8 space-y-6">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.jpg,.jpeg,.png"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {/* Primary: Text Input */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">
                    Beschrijf het fiscale vraagstuk
                  </label>
                  <Textarea
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder={`Voer hier de klantsituatie, vraagstelling en relevante feiten in...

Bijvoorbeeld:
• Klantnaam en situatie
• Concrete fiscale vraag
• Relevante bedragen en feiten
• Email correspondentie (copy-paste)`}
                    className="min-h-48 resize-none text-base border-slate-200 dark:border-slate-700 focus:border-[#1E4DB7] focus:ring-[#1E4DB7]/20"
                    data-testid="textarea-raw-input"
                    aria-label="Fiscale input voor analyse"
                  />
                </div>

                {/* Attachments - Always visible */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-muted-foreground">
                    Bijlages (optioneel)
                  </label>

                  {/* Drag & Drop Zone */}
                  <div
                    ref={dropZoneRef}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={() => !isUploading && fileInputRef.current?.click()}
                    className={cn(
                      "relative border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all",
                      isDragging
                        ? "border-[#1E4DB7] bg-[#1E4DB7]/5 scale-[1.01]"
                        : "border-slate-200 dark:border-slate-700 hover:border-[#1E4DB7]/50 hover:bg-[#1E4DB7]/5",
                      isUploading && "pointer-events-none opacity-60"
                    )}
                  >
                    {isDragging ? (
                      <div className="space-y-1">
                        <Upload className="h-8 w-8 mx-auto text-[#1E4DB7] animate-bounce" />
                        <p className="text-sm font-medium text-[#1E4DB7]">Laat los om te uploaden</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
                        <p className="text-sm">
                          Sleep bestanden of <span className="text-[#1E4DB7] font-medium">klik om te uploaden</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          PDF, TXT, JPG, PNG (max 50MB)
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Upload Progress */}
                  {isUploading && uploadProgress > 0 && (
                    <div className="space-y-2">
                      <Progress value={uploadProgress} className="h-2" />
                      <p className="text-xs text-muted-foreground text-center">
                        {uploadStatus || `${uploadProgress}% geüpload`}
                      </p>
                    </div>
                  )}

                  {/* Pending files badges */}
                  {pendingFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {pendingFiles.map((file) => (
                        <Badge key={file.name} variant="secondary" className="gap-2 pr-1 bg-slate-100 dark:bg-slate-800">
                          <FileText className="h-3 w-3" />
                          <span className="text-xs max-w-[150px] truncate">{file.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({Math.round(file.size / 1024)}KB)
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFile(file.name);
                            }}
                            className="ml-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-sm p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Button
                    onClick={startWorkflow}
                    disabled={!rawText.trim() || isCreatingCase || isUploading}
                    data-testid="button-start-workflow"
                    className="flex-1 h-12 text-base font-semibold bg-[#1E4DB7] hover:bg-[#1E4DB7]/90 shadow-lg shadow-[#1E4DB7]/20"
                    size="lg"
                  >
                    {isCreatingCase || isUploading ? (
                      <><Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        {isUploading
                          ? (uploadStatus || `Uploaden ${uploadProgress}%...`)
                          : 'Case aanmaken...'}
                      </>
                    ) : (
                      <><Play className="mr-2 h-5 w-5" /> Start Analyse</>
                    )}
                  </Button>
                  <Link href="/cases">
                    <Button
                      variant="outline"
                      className="h-12 w-full sm:w-auto border-slate-300 dark:border-slate-600 hover:bg-white/50 dark:hover:bg-slate-800/50"
                    >
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Bekijk Cases
                    </Button>
                  </Link>
                </div>
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
            <Card className="mt-6 border-0 shadow-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm">
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
    </div>
  );
});

export default Pipeline;