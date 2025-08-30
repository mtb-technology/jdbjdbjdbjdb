import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import InputPanel from "./input-panel";
import ReportPreview from "./report-preview";
import WorkflowInterface from "./workflow-interface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DossierData, BouwplanData, Report } from "@shared/schema";

export default function ReportGenerator() {
  const [dossierData, setDossierData] = useState<string>("");
  const [bouwplanData, setBouwplanData] = useState<string>("");
  const [currentReport, setCurrentReport] = useState<Report | null>(null);
  const [activeTab, setActiveTab] = useState("workflow");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const generateReportMutation = useMutation({
    mutationFn: async (data: { dossier: DossierData; bouwplan: BouwplanData; clientName: string }) => {
      const response = await apiRequest("POST", "/api/reports/generate", data);
      return response.json();
    },
    onSuccess: (report: Report) => {
      setCurrentReport(report);
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      toast({
        title: "Rapport gegenereerd",
        description: "Het fiscaal duidingsrapport is succesvol aangemaakt.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Fout bij genereren",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleGenerateReport = () => {
    try {
      const parsedDossier = JSON.parse(dossierData) as DossierData;
      const parsedBouwplan = JSON.parse(bouwplanData) as BouwplanData;
      
      generateReportMutation.mutate({
        dossier: parsedDossier,
        bouwplan: parsedBouwplan,
        clientName: parsedDossier.klant.naam,
      });
    } catch (error) {
      toast({
        title: "Ongeldige JSON",
        description: "Controleer de JSON-structuur van uw invoer.",
        variant: "destructive",
      });
    }
  };

  const handleWorkflowComplete = (report: Report) => {
    setCurrentReport(report);
    setActiveTab("preview");
    queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
  };

  const isDataValid = () => {
    try {
      const parsedDossier = JSON.parse(dossierData) as DossierData;
      const parsedBouwplan = JSON.parse(bouwplanData) as BouwplanData;
      return parsedDossier.klant?.naam && parsedBouwplan.taal;
    } catch {
      return false;
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Input Panel */}
      <InputPanel
        dossierData={dossierData}
        bouwplanData={bouwplanData}
        onDossierChange={setDossierData}
        onBouwplanChange={setBouwplanData}
        onGenerate={handleGenerateReport}
        isGenerating={generateReportMutation.isPending}
      />

      {/* Generation Method Tabs */}
      {isDataValid() && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="workflow" data-testid="tab-workflow">
              Workflow Proces
            </TabsTrigger>
            <TabsTrigger value="quick" data-testid="tab-quick">
              Snelle Generatie
            </TabsTrigger>
            <TabsTrigger value="preview" data-testid="tab-preview">
              Rapport Weergave
            </TabsTrigger>
          </TabsList>

          <TabsContent value="workflow" className="mt-6">
            <WorkflowInterface
              dossier={JSON.parse(dossierData) as DossierData}
              bouwplan={JSON.parse(bouwplanData) as BouwplanData}
              clientName={(JSON.parse(dossierData) as DossierData).klant.naam}
              onComplete={handleWorkflowComplete}
            />
          </TabsContent>

          <TabsContent value="quick" className="mt-6">
            <div className="lg:grid lg:grid-cols-12 lg:gap-8">
              <div className="lg:col-span-12">
                <ReportPreview
                  report={currentReport}
                  isGenerating={generateReportMutation.isPending}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-6">
            <ReportPreview
              report={currentReport}
              isGenerating={false}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
