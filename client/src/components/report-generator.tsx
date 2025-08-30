import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import InputPanel from "./input-panel";
import ReportPreview from "./report-preview";
import type { DossierData, BouwplanData, Report } from "@shared/schema";

export default function ReportGenerator() {
  const [dossierData, setDossierData] = useState<string>("");
  const [bouwplanData, setBouwplanData] = useState<string>("");
  const [currentReport, setCurrentReport] = useState<Report | null>(null);
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

  return (
    <div className="lg:grid lg:grid-cols-12 lg:gap-8">
      <InputPanel
        dossierData={dossierData}
        bouwplanData={bouwplanData}
        onDossierChange={setDossierData}
        onBouwplanChange={setBouwplanData}
        onGenerate={handleGenerateReport}
        isGenerating={generateReportMutation.isPending}
      />
      
      <ReportPreview
        report={currentReport}
        isGenerating={generateReportMutation.isPending}
      />
    </div>
  );
}
