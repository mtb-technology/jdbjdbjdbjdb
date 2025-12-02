import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings as SettingsIcon, FileText, Download, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/app-header";
import { TextStylerSettingsModal } from "@/components/text-styler/TextStylerSettingsModal";
import { Editor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEditor } from '@tiptap/react';

export const DEFAULT_TEXT_STYLE_PROMPT = `Je bent een expert in het formatteren en stylen van teksten voor professionele documenten.

Jouw taak is om de gegeven ruwe tekst om te zetten naar een goed gestructureerde, professioneel opgemaakte tekst.

Belangrijke richtlijnen:
- Gebruik duidelijke koppen en subkoppen waar nodig
- Verdeel de tekst in logische paragrafen
- Gebruik opsommingen of genummerde lijsten waar passend
- Zorg voor een professionele, heldere schrijfstijl
- Behoud de kernboodschap en inhoud van de originele tekst
- Verbeter grammatica en spelling indien nodig
- Zorg voor goede leesbaarheid

Geef je output in Markdown formaat met:
- # voor hoofdkoppen
- ## voor subkoppen
- - voor opsommingen
- **bold** voor belangrijke termen
- *italic* voor nadruk

Antwoord alleen met de geformatteerde tekst, zonder extra uitleg.`;

export default function TextStyler() {
  const [rawText, setRawText] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { toast } = useToast();

  // Local settings state with localStorage persistence
  const [stylePrompt, setStylePrompt] = useState(() => {
    const saved = localStorage.getItem('textStyler.stylePrompt');
    return saved || DEFAULT_TEXT_STYLE_PROMPT;
  });

  const [aiModel, setAiModel] = useState(() => {
    const saved = localStorage.getItem('textStyler.aiModel');
    return saved || "gemini-2.0-flash-exp";
  });

  // Save settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem('textStyler.stylePrompt', stylePrompt);
  }, [stylePrompt]);

  useEffect(() => {
    localStorage.setItem('textStyler.aiModel', aiModel);
  }, [aiModel]);

  // TipTap editor
  const editor = useEditor({
    extensions: [StarterKit],
    content: '',
    editable: true,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[400px] p-4',
      },
    },
  });

  const handleStyleText = async () => {
    if (!rawText.trim()) {
      toast({
        title: "Geen tekst ingevoerd",
        description: "Voer eerst ruwe tekst in om te stylen.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);

    try {
      const response = await fetch("/api/text-styler/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rawText,
          stylePrompt,
          model: aiModel,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.userMessage || "Fout bij het stylen van tekst");
      }

      const result = await response.json();

      // Set TipTap content
      if (editor && result.data.tipTapContent) {
        editor.commands.setContent(result.data.tipTapContent);
      }

      toast({
        title: "Tekst gestyled",
        description: "Je tekst is succesvol geformatteerd.",
      });
    } catch (error: any) {
      console.error("Error styling text:", error);
      toast({
        title: "Fout",
        description: error.message || "Er is een fout opgetreden bij het stylen van de tekst.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportPDF = async () => {
    if (!editor || !editor.getJSON()) {
      toast({
        title: "Geen inhoud",
        description: "Er is geen gestyled tekst om te exporteren.",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);

    try {
      const tipTapContent = editor.getJSON();

      const response = await fetch("/api/text-styler/export-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tipTapContent,
          title: documentTitle || "Document",
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.userMessage || "Fout bij het exporteren naar PDF");
      }

      // Download the PDF
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${documentTitle || 'document'}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "PDF geëxporteerd",
        description: "Je document is succesvol geëxporteerd als PDF.",
      });
    } catch (error: any) {
      console.error("Error exporting PDF:", error);
      toast({
        title: "Fout",
        description: error.message || "Er is een fout opgetreden bij het exporteren naar PDF.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const headerActions = (
    <Button
      variant="outline"
      size="icon"
      onClick={() => setSettingsOpen(true)}
      title="Instellingen"
    >
      <SettingsIcon className="h-4 w-4" />
    </Button>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Panel */}
          <Card>
            <CardHeader>
              <CardTitle>Ruwe Tekst Invoer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="documentTitle">Document Titel</Label>
                <Input
                  id="documentTitle"
                  placeholder="Bijvoorbeeld: Adviesrapport Q1 2024"
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="rawText">Ruwe Tekst</Label>
                <Textarea
                  id="rawText"
                  placeholder="Plak hier je ruwe tekst die je wilt formatteren..."
                  className="min-h-[400px] font-mono text-sm"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                />
              </div>

              <Button
                onClick={handleStyleText}
                disabled={isProcessing || !rawText.trim()}
                className="w-full"
              >
                {isProcessing ? (
                  <>
                    <Sparkles className="mr-2 h-4 w-4 animate-spin" />
                    Tekst wordt gestyled...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Style Tekst met AI
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Preview Panel */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Gestyled Preview</CardTitle>
              <Button
                onClick={handleExportPDF}
                disabled={isExporting || !editor?.getJSON().content?.length}
                size="sm"
              >
                {isExporting ? (
                  <>
                    <Download className="mr-2 h-4 w-4 animate-pulse" />
                    Exporteren...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Exporteer naar PDF
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md bg-white dark:bg-gray-900 min-h-[400px]">
                <EditorContent editor={editor} />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Je kunt de gestyled tekst hier nog handmatig aanpassen voordat je exporteert
              </p>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Settings Modal */}
      <TextStylerSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        stylePrompt={stylePrompt}
        onStylePromptChange={setStylePrompt}
        aiModel={aiModel}
        onAiModelChange={setAiModel}
      />
    </div>
  );
}
