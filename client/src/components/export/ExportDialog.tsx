import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Download, FileDown, Loader2, CheckCircle, Eye, FileText, Globe, File } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface ExportDialogProps {
  reportId: string;
  reportTitle: string;
  clientName: string;
}

type ExportFormat = "pdf" | "word" | "html";

interface ExportSettings {
  format: ExportFormat;
  includeTOC: boolean;
  includeSources: boolean;
  includeFooter: boolean;
  useCompanyBranding: boolean;
}

export function ExportDialog({ reportId, reportTitle, clientName }: ExportDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Default export settings
  const [settings, setSettings] = useState<ExportSettings>({
    format: "pdf",
    includeTOC: true,
    includeSources: true,
    includeFooter: true,
    useCompanyBranding: true,
  });

  const handleExport = async (isClientVersion: boolean) => {
    setIsExporting(true);
    setExportSuccess(false);

    try {
      // Use dedicated export endpoints for PDF and Word formats
      let response: Response;

      if (settings.format === "pdf") {
        response = await fetch(`/api/reports/${reportId}/export-pdf`);
      } else if (settings.format === "word") {
        response = await fetch(`/api/reports/${reportId}/export-docx`);
      } else {
        // Fallback to old endpoint for other formats (HTML)
        const queryParams = new URLSearchParams({
          includeTOC: settings.includeTOC.toString(),
          includeSources: settings.includeSources.toString(),
          includeFooter: settings.includeFooter.toString(),
          useCompanyBranding: settings.useCompanyBranding.toString(),
          clientVersion: isClientVersion.toString(),
        });
        response = await fetch(`/api/cases/${reportId}/export/${settings.format}?${queryParams}`);
      }

      if (!response.ok) {
        throw new Error("Export mislukt");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;

      // Smart filename generation
      const sanitizedClient = clientName.replace(/[^a-zA-Z0-9]/g, "-");
      const date = new Date().toISOString().split("T")[0];
      const versionSuffix = isClientVersion ? "client" : "werk";
      const extension = settings.format === "word" ? "docx" : settings.format;

      a.download = `Rapport_${sanitizedClient}_${date}_${versionSuffix}.${extension}`;

      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setExportSuccess(true);
      toast({
        title: "✅ Export Succesvol",
        description: `${isClientVersion ? "Client versie" : "Werk versie"} gedownload`,
      });

      // Auto-close after 2 seconds on success
      setTimeout(() => {
        setOpen(false);
        setExportSuccess(false);
      }, 2000);
    } catch (error: any) {
      console.error("Export error:", error);
      toast({
        title: "Export Mislukt",
        description: error.message || "Er ging iets mis bij het exporteren",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handlePreview = () => {
    // Open preview in new tab
    window.open(`/api/reports/${reportId}/preview-pdf`, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" size="sm">
          <FileDown className="mr-2 h-4 w-4" />
          Exporteer
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Rapport
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Export Format - Clickable buttons */}
          <div className="space-y-2">
            <Label>Formaat</Label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSettings({ ...settings, format: "pdf" })}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all",
                  settings.format === "pdf"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/50 hover:bg-muted/50"
                )}
              >
                <File className="h-6 w-6" />
                <span className="text-xs font-medium">PDF</span>
              </button>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, format: "word" })}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all",
                  settings.format === "word"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/50 hover:bg-muted/50"
                )}
              >
                <FileText className="h-6 w-6" />
                <span className="text-xs font-medium">Word</span>
              </button>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, format: "html" })}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all",
                  settings.format === "html"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/50 hover:bg-muted/50"
                )}
              >
                <Globe className="h-6 w-6" />
                <span className="text-xs font-medium">HTML</span>
              </button>
            </div>
          </div>

          {/* Export Options */}
          <div className="space-y-4">
            <Label>Opties</Label>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-normal">Inhoudsopgave</Label>
                <p className="text-xs text-muted-foreground">Met paginanummers en secties</p>
              </div>
              <Switch
                checked={settings.includeTOC}
                onCheckedChange={(checked) => setSettings({ ...settings, includeTOC: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-normal">Bronnenlijst</Label>
                <p className="text-xs text-muted-foreground">Overzicht van gebruikte bronnen</p>
              </div>
              <Switch
                checked={settings.includeSources}
                onCheckedChange={(checked) => setSettings({ ...settings, includeSources: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-normal">Footer met Contact</Label>
                <p className="text-xs text-muted-foreground">Kantoorgegevens in footer</p>
              </div>
              <Switch
                checked={settings.includeFooter}
                onCheckedChange={(checked) => setSettings({ ...settings, includeFooter: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-normal">Kantoor Branding</Label>
                <p className="text-xs text-muted-foreground">Logo, kleuren en lettertype</p>
              </div>
              <Switch
                checked={settings.useCompanyBranding}
                onCheckedChange={(checked) => setSettings({ ...settings, useCompanyBranding: checked })}
              />
            </div>
          </div>

          {/* Preview & Export Buttons */}
          <div className="space-y-3 pt-4 border-t">
            {/* Preview button - only for PDF */}
            {settings.format === "pdf" && (
              <Button
                onClick={handlePreview}
                variant="secondary"
                className="w-full"
              >
                <Eye className="mr-2 h-4 w-4" />
                Preview in Browser
              </Button>
            )}

            <Button
              onClick={() => handleExport(true)}
              disabled={isExporting}
              className="w-full"
              size="lg"
            >
              {isExporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Exporteren...
                </>
              ) : exportSuccess ? (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Geëxporteerd!
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Download voor Client
                </>
              )}
            </Button>

            <Button
              onClick={() => handleExport(false)}
              disabled={isExporting}
              variant="outline"
              className="w-full"
            >
              {isExporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Exporteren...
                </>
              ) : (
                <>
                  <FileDown className="mr-2 h-4 w-4" />
                  Download Werkversie
                </>
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              Client versie: definitief • Werkversie: met notities
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
