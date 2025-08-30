import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { 
  FolderOpen, 
  FileText, 
  Settings, 
  Save, 
  Upload,
  Shield,
  Info
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface InputPanelProps {
  dossierData: string;
  bouwplanData: string;
  onDossierChange: (data: string) => void;
  onBouwplanChange: (data: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
}

export default function InputPanel({
  dossierData,
  bouwplanData,
  onDossierChange,
  onBouwplanChange,
  onGenerate,
  isGenerating,
}: InputPanelProps) {
  const handleSave = () => {
    // TODO: Implement save functionality
  };

  const handleLoad = () => {
    // TODO: Implement load functionality
  };

  return (
    <div className="lg:col-span-4">
      <Card className="shadow-sm p-6 space-y-6">
        
        {/* Status Indicator */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Rapport Generatie</h2>
          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 bg-green-500 rounded-full" data-testid="status-indicator"></div>
            <span className="text-sm text-muted-foreground">Systeem Actief</span>
          </div>
        </div>

        {/* Dossier Input */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-foreground flex items-center">
            <FolderOpen className="mr-2 h-4 w-4 text-primary" />
            Gevalideerd Dossier (JSON)
          </Label>
          <Textarea 
            value={dossierData}
            onChange={(e) => onDossierChange(e.target.value)}
            className="w-full h-32 font-mono text-sm resize-none"
            placeholder={`{
  "klant": {
    "naam": "J. van der Berg",
    "bsn": "123456789",
    "situatie": "echtscheiding"
  },
  "fiscale_gegevens": {
    "vermogen": 450000,
    "inkomsten": 85000
  }
}`}
            data-testid="input-dossier"
          />
          <div className="flex items-center space-x-2 text-xs text-muted-foreground">
            <Info className="h-3 w-3" />
            <span>JSON-validatie wordt automatisch uitgevoerd</span>
          </div>
        </div>

        {/* Bouwplan Input */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-foreground flex items-center">
            <FileText className="mr-2 h-4 w-4 text-primary" />
            Bouwplan Rapport (JSON)
          </Label>
          <Textarea 
            value={bouwplanData}
            onChange={(e) => onBouwplanChange(e.target.value)}
            className="w-full h-32 font-mono text-sm resize-none"
            placeholder={`{
  "taal": "nl",
  "structuur": {
    "inleiding": true,
    "knelpunten": ["schenkbelasting", "vermogensoverdracht"],
    "scenario_analyse": true,
    "vervolgstappen": true
  }
}`}
            data-testid="input-bouwplan"
          />
        </div>

        {/* Source Verification Panel */}
        <Card className="bg-muted p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground flex items-center">
            <Shield className="mr-2 h-4 w-4 text-accent" />
            Bronverificatie
          </h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 bg-green-500 rounded-full"></div>
              <span className="text-muted-foreground">belastingdienst.nl</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 bg-green-500 rounded-full"></div>
              <span className="text-muted-foreground">wetten.overheid.nl</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 bg-green-500 rounded-full"></div>
              <span className="text-muted-foreground">rijksoverheid.nl</span>
            </div>
          </div>
        </Card>

        {/* Action Buttons */}
        <div className="space-y-3">
          <Button 
            className="w-full"
            onClick={onGenerate}
            disabled={isGenerating || !dossierData.trim() || !bouwplanData.trim()}
            data-testid="button-generate-report"
          >
            <Settings className="mr-2 h-4 w-4" />
            {isGenerating ? "Genereren..." : "Genereer Duidingsrapport"}
          </Button>
          
          <div className="grid grid-cols-2 gap-3">
            <Button 
              variant="secondary" 
              className="text-sm"
              onClick={handleSave}
              data-testid="button-save"
            >
              <Save className="mr-1 h-3 w-3" />
              Opslaan
            </Button>
            <Button 
              variant="secondary" 
              className="text-sm"
              onClick={handleLoad}
              data-testid="button-load"
            >
              <Upload className="mr-1 h-3 w-3" />
              Laden
            </Button>
          </div>
        </div>

      </Card>
    </div>
  );
}
