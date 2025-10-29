import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle,
  Download,
  Eye,
  FileText,
  Sparkles,
  ArrowRight
} from "lucide-react";
import { ExportDialog } from "@/components/export/ExportDialog";

interface FinalizeStepProps {
  reportId: string;
  reportTitle: string;
  clientName: string;
  finalContent: string;
  onComplete: () => void;
  onViewReport: () => void;
}

export function FinalizeStep({
  reportId,
  reportTitle,
  clientName,
  finalContent,
  onComplete,
  onViewReport,
}: FinalizeStepProps) {
  const wordCount = finalContent.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <div className="bg-green-100 p-4 rounded-full">
            <Sparkles className="h-8 w-8 text-green-600" />
          </div>
        </div>
        <h3 className="text-2xl font-bold mb-2">Rapport Voltooid! 🎉</h3>
        <p className="text-muted-foreground">
          Je fiscaal adviesrapport is succesvol gegenereerd en klaar voor gebruik
        </p>
      </div>

      {/* Success Alert */}
      <Alert className="bg-green-50 border-green-200">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <AlertTitle className="text-green-900">Alle stappen voltooid</AlertTitle>
        <AlertDescription className="text-green-800">
          Het rapport is door alle review stappen gegaan en is nu gereed voor export of verdere bewerking.
        </AlertDescription>
      </Alert>

      {/* Report Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-primary mb-1">{wordCount}</div>
          <div className="text-sm text-muted-foreground">Woorden</div>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-primary mb-1">12</div>
          <div className="text-sm text-muted-foreground">Pipeline Stappen</div>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-primary mb-1">7</div>
          <div className="text-sm text-muted-foreground">AI Reviewers</div>
        </div>
      </div>

      {/* Preview Tabs */}
      <Tabs defaultValue="preview" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="preview">
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </TabsTrigger>
          <TabsTrigger value="metadata">
            <FileText className="mr-2 h-4 w-4" />
            Details
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preview" className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Rapport Preview</span>
            <Button variant="outline" size="sm" onClick={onViewReport}>
              <Eye className="mr-2 h-4 w-4" />
              Volledig Scherm
            </Button>
          </div>
          <ScrollArea className="h-[500px] w-full rounded-md border bg-muted/30 p-6">
            <div className="prose prose-sm max-w-none">
              <div className="space-y-4">
                {finalContent.split('\n\n').map((paragraph, index) => (
                  <p key={index} className="text-sm leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="metadata" className="space-y-4">
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Client</span>
              <Badge variant="outline">{clientName}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Rapport Titel</span>
              <span className="text-sm">{reportTitle}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Report ID</span>
              <code className="text-xs bg-muted px-2 py-1 rounded">{reportId}</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Status</span>
              <Badge className="bg-green-100 text-green-800">Voltooid</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Datum</span>
              <span className="text-sm">{new Date().toLocaleDateString('nl-NL')}</span>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Action Buttons */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <ExportDialog
            reportId={reportId}
            reportTitle={reportTitle}
            clientName={clientName}
          />
          <Button variant="outline" onClick={onViewReport} className="flex-1">
            <Eye className="mr-2 h-4 w-4" />
            Bekijk Volledig Rapport
          </Button>
        </div>

        <Button onClick={onComplete} size="lg" className="w-full">
          Voltooien & Naar Cases
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </div>

      {/* Next Steps Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold text-blue-900 mb-2">📋 Volgende Stappen:</h4>
        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li>Exporteer het rapport als PDF voor je client</li>
          <li>Download een werkversie met notities voor intern gebruik</li>
          <li>Bekijk het volledige rapport in de case detail pagina</li>
          <li>Start een nieuwe case of verwerk een batch</li>
        </ul>
      </div>
    </div>
  );
}
