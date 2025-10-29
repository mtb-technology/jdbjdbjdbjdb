import { useState, useRef } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Upload,
  FileText,
  Play,
  Download,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  Package
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface BatchItem {
  id: string;
  clientName: string;
  rawText: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  currentStage?: string;
  progress?: number;
  reportId?: string;
  error?: string;
}

export default function BatchProcessing() {
  const { toast } = useToast();
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentlyProcessing, setCurrentlyProcessing] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manual entry form state
  const [manualClientName, setManualClientName] = useState("");
  const [manualRawText, setManualRawText] = useState("");

  const handleAddManualCase = () => {
    if (!manualClientName.trim() || !manualRawText.trim()) {
      toast({
        title: "Invoer ontbreekt",
        description: "Vul zowel client naam als tekst in",
        variant: "destructive",
      });
      return;
    }

    const newItem: BatchItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      clientName: manualClientName.trim(),
      rawText: manualRawText.trim(),
      status: 'pending',
    };

    setBatchItems(prev => [...prev, newItem]);
    setManualClientName("");
    setManualRawText("");

    toast({
      title: "Case Toegevoegd",
      description: `${newItem.clientName} toegevoegd aan batch`,
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newItems: BatchItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Only accept text files
      if (!file.name.endsWith('.txt') && !file.type.startsWith('text/')) {
        toast({
          title: "Bestandstype niet ondersteund",
          description: `${file.name} moet een tekstbestand zijn`,
          variant: "destructive",
        });
        continue;
      }

      try {
        const content = await file.text();
        const clientName = file.name.replace(/\.(txt|text)$/i, '');

        newItems.push({
          id: `item-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`,
          clientName,
          rawText: content,
          status: 'pending',
        });
      } catch (error) {
        toast({
          title: "Fout bij lezen bestand",
          description: `Kon ${file.name} niet lezen`,
          variant: "destructive",
        });
      }
    }

    if (newItems.length > 0) {
      setBatchItems(prev => [...prev, ...newItems]);
      toast({
        title: "Bestanden Geupload",
        description: `${newItems.length} case(s) toegevoegd aan batch`,
      });
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveItem = (id: string) => {
    setBatchItems(prev => prev.filter(item => item.id !== id));
  };

  const handleClearAll = () => {
    setBatchItems([]);
    setCurrentlyProcessing(0);
  };

  const processItem = async (item: BatchItem): Promise<void> => {
    // Update item status to processing
    setBatchItems(prev =>
      prev.map(i => i.id === item.id ? { ...i, status: 'processing', progress: 0 } : i)
    );

    try {
      // Step 1: Create report
      const report = await apiRequest("/api/reports/create", {
        method: "POST",
        body: JSON.stringify({
          clientName: item.clientName,
          title: `Fiscaal Advies - ${item.clientName}`,
          dossierData: { rawText: item.rawText },
        }),
      });

      const reportId = report.id;

      // Update with report ID
      setBatchItems(prev =>
        prev.map(i => i.id === item.id ? { ...i, reportId, progress: 10 } : i)
      );

      // Step 2: Execute all pipeline stages
      const stages = [
        '1_informatiecheck',
        '2_complexiteitscheck',
        '3_generatie',
        '4a_BronnenSpecialist',
        '4b_FiscaalTechnischSpecialist',
        '4c_ScenarioGatenAnalist',
        '4d_DeVertaler',
        '4e_DeAdvocaat',
        '4f_DeKlantpsycholoog',
        '4g_ChefEindredactie',
        '5_feedback_verwerker',
        '6_change_summary',
      ];

      for (let i = 0; i < stages.length; i++) {
        const stageKey = stages[i];
        const progress = Math.round(((i + 1) / stages.length) * 90) + 10;

        // Update current stage
        setBatchItems(prev =>
          prev.map(it => it.id === item.id ? { ...it, currentStage: stageKey, progress } : it)
        );

        // Execute stage (non-streaming for batch)
        await apiRequest(`/api/reports/${reportId}/execute-stage`, {
          method: "POST",
          body: JSON.stringify({
            stageKey,
            streamingMode: false,
          }),
        });
      }

      // Mark as completed
      setBatchItems(prev =>
        prev.map(i => i.id === item.id ? { ...i, status: 'completed', progress: 100 } : i)
      );

    } catch (error: any) {
      console.error(`Error processing ${item.clientName}:`, error);
      setBatchItems(prev =>
        prev.map(i => i.id === item.id ? {
          ...i,
          status: 'error',
          error: error.message || 'Onbekende fout'
        } : i)
      );
    }
  };

  const handleStartBatch = async () => {
    if (batchItems.length === 0) {
      toast({
        title: "Geen cases",
        description: "Voeg eerst cases toe aan de batch",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setCurrentlyProcessing(0);

    // Process items with max concurrency of 2
    const maxConcurrent = 2;
    const pendingItems = batchItems.filter(item => item.status === 'pending');

    for (let i = 0; i < pendingItems.length; i += maxConcurrent) {
      const batch = pendingItems.slice(i, Math.min(i + maxConcurrent, pendingItems.length));
      setCurrentlyProcessing(i + batch.length);

      await Promise.all(batch.map(item => processItem(item)));
    }

    setIsProcessing(false);

    const completedCount = batchItems.filter(i => i.status === 'completed').length;
    const errorCount = batchItems.filter(i => i.status === 'error').length;

    toast({
      title: "Batch Voltooid",
      description: `${completedCount} succesvol, ${errorCount} fouten`,
    });
  };

  const handleExportAll = async () => {
    const completedItems = batchItems.filter(item => item.status === 'completed' && item.reportId);

    if (completedItems.length === 0) {
      toast({
        title: "Geen rapporten",
        description: "Er zijn geen voltooide rapporten om te exporteren",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Exporteren...",
      description: `${completedItems.length} rapport(en) worden gedownload`,
    });

    // Download each report individually
    for (const item of completedItems) {
      try {
        const response = await fetch(`/api/cases/${item.reportId}/export/pdf`);

        if (!response.ok) continue;

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `Rapport_${item.clientName.replace(/[^a-zA-Z0-9]/g, '-')}_${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        // Small delay between downloads
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error exporting ${item.clientName}:`, error);
      }
    }

    toast({
      title: "Export Voltooid",
      description: `${completedItems.length} PDF(s) gedownload`,
    });
  };

  const getStatusIcon = (status: BatchItem['status']) => {
    switch (status) {
      case 'pending':
        return <FileText className="h-5 w-5 text-gray-500" />;
      case 'processing':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
    }
  };

  const getStatusBadge = (status: BatchItem['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Wachtend</Badge>;
      case 'processing':
        return <Badge className="bg-blue-100 text-blue-800">Verwerken</Badge>;
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">Voltooid</Badge>;
      case 'error':
        return <Badge variant="destructive">Fout</Badge>;
    }
  };

  const overallProgress = batchItems.length > 0
    ? Math.round((batchItems.filter(i => i.status === 'completed').length / batchItems.length) * 100)
    : 0;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/cases">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Terug naar Cases
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Package className="h-8 w-8" />
              Batch Verwerking
            </h1>
            <p className="text-muted-foreground mt-1">
              Verwerk meerdere cases tegelijk en exporteer alle rapporten
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
        {/* Left Column: Input Controls */}
        <div className="space-y-6">
          {/* Manual Entry */}
          <Card>
            <CardHeader>
              <CardTitle>Handmatige Invoer</CardTitle>
              <CardDescription>Voeg individuele cases toe</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="clientName">Client Naam</Label>
                <Input
                  id="clientName"
                  value={manualClientName}
                  onChange={(e) => setManualClientName(e.target.value)}
                  placeholder="Bijv. Jan de Vries"
                  disabled={isProcessing}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rawText">Case Tekst</Label>
                <Textarea
                  id="rawText"
                  value={manualRawText}
                  onChange={(e) => setManualRawText(e.target.value)}
                  placeholder="Plak hier de case informatie..."
                  rows={6}
                  disabled={isProcessing}
                />
              </div>
              <Button
                onClick={handleAddManualCase}
                className="w-full"
                disabled={isProcessing}
              >
                <FileText className="mr-2 h-4 w-4" />
                Toevoegen aan Batch
              </Button>
            </CardContent>
          </Card>

          {/* File Upload */}
          <Card>
            <CardHeader>
              <CardTitle>Bestand Upload</CardTitle>
              <CardDescription>Upload meerdere tekstbestanden</CardDescription>
            </CardHeader>
            <CardContent>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.text"
                multiple
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
                disabled={isProcessing}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="w-full"
                disabled={isProcessing}
              >
                <Upload className="mr-2 h-4 w-4" />
                Selecteer Bestanden (.txt)
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                Bestandsnaam = Client naam
              </p>
            </CardContent>
          </Card>

          {/* Batch Controls */}
          <Card>
            <CardHeader>
              <CardTitle>Batch Controles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                onClick={handleStartBatch}
                disabled={isProcessing || batchItems.length === 0}
                className="w-full"
                size="lg"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verwerken... ({currentlyProcessing}/{batchItems.length})
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Start Batch ({batchItems.length})
                  </>
                )}
              </Button>

              <Button
                onClick={handleExportAll}
                disabled={isProcessing || batchItems.filter(i => i.status === 'completed').length === 0}
                variant="outline"
                className="w-full"
              >
                <Download className="mr-2 h-4 w-4" />
                Exporteer Alle PDF's
              </Button>

              <Button
                onClick={handleClearAll}
                disabled={isProcessing}
                variant="outline"
                className="w-full"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Wis Lijst
              </Button>
            </CardContent>
          </Card>

          {/* Overall Progress */}
          {batchItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Totale Voortgang</CardTitle>
              </CardHeader>
              <CardContent>
                <Progress value={overallProgress} className="mb-2" />
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{batchItems.filter(i => i.status === 'completed').length} voltooid</span>
                  <span>{overallProgress}%</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Batch Queue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Batch Wachtrij ({batchItems.length})</span>
              {batchItems.length > 0 && (
                <Badge variant="outline">
                  {batchItems.filter(i => i.status === 'completed').length} / {batchItems.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Overzicht van alle cases in de batch
            </CardDescription>
          </CardHeader>
          <CardContent>
            {batchItems.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Nog geen cases toegevoegd</p>
                <p className="text-sm mt-2">Voeg cases toe via handmatige invoer of bestand upload</p>
              </div>
            ) : (
              <div className="space-y-3">
                {batchItems.map((item) => (
                  <div
                    key={item.id}
                    className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3 flex-1">
                        {getStatusIcon(item.status)}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium truncate">{item.clientName}</h3>
                          {item.currentStage && (
                            <p className="text-xs text-muted-foreground">
                              {item.currentStage}
                            </p>
                          )}
                          {item.error && (
                            <p className="text-xs text-red-600 mt-1">{item.error}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(item.status)}
                        {item.status === 'pending' && !isProcessing && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveItem(item.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                        {item.status === 'completed' && item.reportId && (
                          <Link href={`/cases/${item.reportId}`}>
                            <Button size="sm" variant="ghost">
                              <FileText className="h-4 w-4" />
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>

                    {item.status === 'processing' && item.progress !== undefined && (
                      <Progress value={item.progress} className="mt-2" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
