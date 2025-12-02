import { useState, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Settings as SettingsIcon,
  Mail,
  FileText,
  Database,
  RefreshCw,
  Copy,
  RotateCcw,
  AlertCircle,
  CheckCircle,
  Sparkles,
  Save
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/app-header";
import { AssistantSettingsModal } from "@/components/assistant/AssistantSettingsModal";
import { SessionSidebar } from "@/components/assistant/SessionSidebar";
import type { FollowUpSession } from "@shared/schema";

// Default Fiscal Assistant Prompt
export const DEFAULT_FISCAL_ASSISTANT_PROMPT = `[ROL & DOEL]
Jij bent een "Senior Fiscaal Assistent". Jouw taak is het analyseren van een vervolgemail van een klant en het opstellen van een professioneel, inhoudelijk concept-antwoord. Je gebruikt hiervoor drie bronnen: [ORIGINEEL_DOSSIER], [FINAAL_RAPPORT], en [NIEUWE_EMAIL].

[ANALYSESTAPPEN]
1. Extraheer de Vraag: Identificeer de kernvraag uit de [NIEUWE_EMAIL].
2. Classificeer de Scope: Bepaal of deze vraag een \`IN_SCOPE\` verduidelijking is of \`OUT_OF_SCOPE\` nieuw advies.
    * \`IN_SCOPE\`: Een vraag over een term, een berekening, of een conclusie die *al in het rapport staat*.
    * \`OUT_OF_SCOPE\`: Een vraag die *nieuwe feiten*, een *nieuw scenario* ("Wat als..."), of een *verzoek om een nieuwe berekening* introduceert.
3. Genereer het Antwoord:
    * Indien \`IN_SCOPE\`: Genereer een *inhoudelijk antwoord*. Zoek de relevante passage in het [FINAAL_RAPPORT], citeer deze (indien nuttig) en leg het antwoord duidelijk uit. Hanteer *exact* dezelfde professionele, didactische en zorgvuldige toon als in het rapport.
    * Indien \`OUT_OF_SCOPE\`: Genereer *geen* inhoudelijk antwoord. Stel een beleefde, commerciële e-mail op die uitlegt dat dit een nieuwe adviesvraag is en bied een (standaard) vervolgtraject aan.

[OUTPUT-FORMAT (STRIKT)]
Genereer *alleen* de volgende JSON:
{
  "analyse": {
    "vraag_van_klant": "De specifieke vraag die de AI heeft gedetecteerd.",
    "scope_status": "IN_SCOPE", // of "OUT_OF_SCOPE"
    "inhoudelijke_samenvatting_antwoord": "Hier komt een 1-zins samenvatting van het antwoord dat je hebt gegeven."
                                       // of "Niet beantwoord, scope creep gedetecteerd."
  },
  "concept_email": {
    "onderwerp": "RE: [Onderwerp van de nieuwe email]",
    "body": "..." // De gegenereerde concept-e-mail in PLAIN TEXT (geen HTML tags)
  }
}

[E-MAIL TEMPLATES (INSTRUCTIES VOOR DE AI)]
* Template voor \`IN_SCOPE\` (De "Fiscaal Antwoord" e-mail):
    * (Toon: Professioneel, behulpzaam, didactisch, in de stijl van het rapport)
    * "Beste [Klantnaam],
    * Dank voor uw heldere vervolgvraag. U vraagt [herhaal de vraag].
    * Dit is een goede vraag. Zoals u kunt terugvinden in [Sectie X] van het rapport, bedoelen we hiermee dat [geef het simpele, inhoudelijke antwoord, gebaseerd op het rapport].
    * Hopelijk verduidelijkt dit uw vraag. Mocht u nogmaals een toelichting wensen, dan horen we het graag.
    * Met vriendelijke groet, ..."
* Template voor \`OUT_OF_SCOPE\` (De "Commerciële" e-mail):
    * (Toon: Zakelijk, beleefd, duidelijk)
    * "Beste [Klantnaam],
    * Dank voor uw interessante vervolgvraag. U schetst nu een nieuw scenario, namelijk [herhaal de 'wat als'-vraag].
    * Dit betreft een nieuwe analyse die buiten de scope van het oorspronkelijke adviesrapport valt. Het beantwoorden hiervan vereist een nieuwe beoordeling van uw situatie.
    * Indien u wenst dat wij dit nieuwe scenario voor u uitwerken, kunnen wij dit uiteraard doen. De kosten voor dit aanvullende advies bedragen [STANDAARPRIJS INVULLEN, bv. € 225,- incl. BTW].
    * Laat u het weten als we dit voor u in gang mogen zetten?
    * Met vriendelijke groet, ..."`;

interface AssistantResponse {
  analyse: {
    vraag_van_klant: string;
    scope_status: "IN_SCOPE" | "OUT_OF_SCOPE";
    inhoudelijke_samenvatting_antwoord: string;
  };
  concept_email: {
    onderwerp: string;
    body: string;
  };
}

const FollowUpAssistant = memo(function FollowUpAssistant() {
  const [dossierInput, setDossierInput] = useState("");
  const [rapportInput, setRapportInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [assistantResponse, setAssistantResponse] = useState<AssistantResponse | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackInput, setFeedbackInput] = useState("");
  const [isRefining, setIsRefining] = useState(false);

  // Session management state
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [clientName, setClientName] = useState("");
  const [isSavingSession, setIsSavingSession] = useState(false);

  // Local settings state (independent from main app settings)
  const [aiModel, setAiModel] = useState("gemini-3-pro-preview");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_FISCAL_ASSISTANT_PROMPT);

  const { toast } = useToast();

  const handleGenerate = async () => {
    // Validate inputs
    if (!dossierInput.trim() || !rapportInput.trim() || !emailInput.trim()) {
      toast({
        title: "Ontbrekende gegevens",
        description: "Vul alle drie de velden in voordat je een antwoord genereert.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);

    try {
      // Build the user input with clear section markers
      const userInput = `--- [DOSSIER] ---
${dossierInput}

--- [RAPPORT] ---
${rapportInput}

--- [EMAIL] ---
${emailInput}`;

      // Call the AI endpoint
      const response = await fetch("/api/assistant/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemPrompt,
          userInput,
          model: aiModel,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        console.error("Failed to parse response as JSON:", parseError);
        throw new Error("Server antwoord is niet in JSON formaat. Controleer de server logs.");
      }

      if (data.error) {
        throw new Error(data.error.message || "Er ging iets mis");
      }

      // Extract the response (handle both direct data and wrapped response)
      const result = data.success ? data.data : data;

      // Validate the result structure
      if (!result || !result.analyse || !result.concept_email) {
        console.error("Invalid response structure:", result);
        throw new Error("Server antwoord heeft niet de verwachte structuur");
      }

      setAssistantResponse(result);
      setShowOutput(true);

      toast({
        title: "Concept gegenereerd",
        description: "Het AI-antwoord is succesvol gegenereerd.",
      });
    } catch (error: any) {
      console.error("Generate failed:", error);
      toast({
        title: "Generatie mislukt",
        description: error.message || "Kon geen concept genereren. Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!assistantResponse) return;

    const textToCopy = `Onderwerp: ${assistantResponse.concept_email.onderwerp}\n\n${assistantResponse.concept_email.body}`;
    navigator.clipboard.writeText(textToCopy);

    toast({
      title: "Gekopieerd",
      description: "Onderwerp en body zijn naar het klembord gekopieerd.",
    });
  };

  const handleReset = () => {
    setDossierInput("");
    setRapportInput("");
    setEmailInput("");
    setShowOutput(false);
    setAssistantResponse(null);
    setFeedbackInput("");
  };

  const handleRefine = async () => {
    if (!feedbackInput.trim() || !assistantResponse) {
      toast({
        title: "Geen feedback",
        description: "Geef eerst feedback over hoe je de e-mail wilt aanpassen.",
        variant: "destructive",
      });
      return;
    }

    setIsRefining(true);

    try {
      // Build a refinement prompt
      const refinementPrompt = `Je hebt eerder deze e-mail gegenereerd:

ONDERWERP: ${assistantResponse.concept_email.onderwerp}

BODY:
${assistantResponse.concept_email.body}

De gebruiker wil de volgende aanpassing:
${feedbackInput}

Pas de e-mail aan op basis van deze feedback. Genereer ALLEEN de volgende JSON (zonder extra uitleg):
{
  "concept_email": {
    "onderwerp": "...",
    "body": "..."
  }
}`;

      // Call the AI endpoint with refinement prompt
      const response = await fetch("/api/assistant/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemPrompt: "Je bent een e-mail editor die aanpassingen maakt op basis van gebruikersfeedback. Genereer ALLEEN JSON zonder extra tekst.",
          userInput: refinementPrompt,
          model: aiModel,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || "Er ging iets mis");
      }

      const result = data.success ? data.data : data;

      // Update only the email part, keep the analysis
      if (result.concept_email) {
        setAssistantResponse({
          ...assistantResponse,
          concept_email: result.concept_email,
        });
        setFeedbackInput("");
        toast({
          title: "E-mail aangepast",
          description: "De e-mail is succesvol aangepast op basis van je feedback.",
        });
      } else {
        throw new Error("Geen concept_email in response");
      }
    } catch (error: any) {
      console.error("Refine failed:", error);
      toast({
        title: "Aanpassing mislukt",
        description: error.message || "Kon de e-mail niet aanpassen. Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setIsRefining(false);
    }
  };

  const handleSaveSession = async () => {
    if (!clientName.trim()) {
      toast({
        title: "Clientnaam vereist",
        description: "Vul een clientnaam in om de sessie op te slaan.",
        variant: "destructive",
      });
      return;
    }

    if (!dossierInput.trim() || !rapportInput.trim()) {
      toast({
        title: "Ontbrekende gegevens",
        description: "Dossier en rapport zijn vereist om een sessie op te slaan.",
        variant: "destructive",
      });
      return;
    }

    setIsSavingSession(true);

    try {
      let dossierJson;
      try {
        dossierJson = JSON.parse(dossierInput);
      } catch (e) {
        dossierJson = { raw: dossierInput };
      }

      const response = await fetch("/api/follow-up/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          dossierData: dossierJson,
          rapportContent: rapportInput,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save session");
      }

      const data = await response.json();
      const savedSession = data.success ? data.data : data;

      setCurrentSessionId(savedSession.id);

      toast({
        title: "Sessie opgeslagen",
        description: `Sessie voor ${clientName} is succesvol opgeslagen.`,
      });
    } catch (error: any) {
      console.error("Save session failed:", error);
      toast({
        title: "Opslaan mislukt",
        description: error.message || "Kon sessie niet opslaan. Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setIsSavingSession(false);
    }
  };

  const handleLoadSession = (session: FollowUpSession) => {
    setCurrentSessionId(session.id);
    setClientName(session.clientName);

    // Load dossier data
    if (typeof session.dossierData === "string") {
      setDossierInput(session.dossierData);
    } else {
      setDossierInput(JSON.stringify(session.dossierData, null, 2));
    }

    // Load rapport content
    setRapportInput(session.rapportContent);

    // Clear email input for new follow-up
    setEmailInput("");
    setShowOutput(false);
    setAssistantResponse(null);
    setFeedbackInput("");

    toast({
      title: "Sessie geladen",
      description: `Sessie voor ${session.clientName} is geladen. Je kunt nu een nieuwe e-mail invoeren.`,
    });
  };

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <AppHeader title="Follow-up Assistent" icon={Mail} />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-6">
          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Page Header */}
            <div className="mb-8">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-3xl font-bold text-foreground">
                    Follow-up Assistent
                  </h1>
                  <p className="text-muted-foreground mt-2">
                    Genereer snel antwoorden op vervolgvragen van klanten.
                  </p>
                </div>

                <Button
                  onClick={() => setSettingsOpen(true)}
                  variant="outline"
                  size="sm"
                  id="open-settings-modal-btn"
                >
                  <SettingsIcon className="h-4 w-4 mr-2" />
                  Instellingen
                </Button>
              </div>
            </div>

            {/* Session Management */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-base">Sessie Beheer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="client_name">Clientnaam</Label>
                  <Input
                    id="client_name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Bijv. Jan de Vries"
                    className="mt-1"
                  />
                </div>
                <Button
                  onClick={handleSaveSession}
                  disabled={isSavingSession || !clientName.trim() || !dossierInput.trim() || !rapportInput.trim()}
                  size="sm"
                  variant="default"
                >
                  {isSavingSession ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Opslaan...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Bewaar Sessie
                    </>
                  )}
                </Button>
                {currentSessionId && (
                  <Badge variant="secondary" className="ml-2">
                    Sessie actief
                  </Badge>
                )}
              </CardContent>
            </Card>

            {/* Input Panel */}
            <div className="grid gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Database className="h-5 w-5 mr-2 text-blue-500" />
                1. Het Dossier (JSON-output van Stap 1)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                id="dossier_input"
                value={dossierInput}
                onChange={(e) => setDossierInput(e.target.value)}
                placeholder="Plak hier de 'dossier' JSON..."
                className="font-mono text-sm min-h-32"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <FileText className="h-5 w-5 mr-2 text-green-500" />
                2. Het Finale Rapport (Tekst/HTML)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                id="rapport_input"
                value={rapportInput}
                onChange={(e) => setRapportInput(e.target.value)}
                placeholder="Plak hier de *volledige tekst* van het adviesrapport..."
                className="font-mono text-sm min-h-32"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Mail className="h-5 w-5 mr-2 text-orange-500" />
                3. De Nieuwe E-mailwisseling
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                id="email_input"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="Plak hier de *volledige nieuwe e-mail* van de klant..."
                className="font-mono text-sm min-h-32"
              />
            </CardContent>
          </Card>

          <div className="flex justify-center">
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              size="lg"
              id="genereer_antwoord"
              className="min-w-64"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                  Genereren...
                </>
              ) : (
                <>
                  Genereer Conceptantwoord →
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Output Panel */}
        {showOutput && assistantResponse && (
          <div className="grid gap-6">
            <Card className="border-primary">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>AI Analyse & Concept Antwoord</span>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleCopy}
                      variant="outline"
                      size="sm"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Kopieer
                    </Button>
                    <Button
                      onClick={handleReset}
                      variant="outline"
                      size="sm"
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Start Opnieuw
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">

                {/* Analysis Block */}
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    {assistantResponse.analyse.scope_status === "IN_SCOPE" ? (
                      <Badge className="bg-green-500 hover:bg-green-600">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        IN SCOPE
                      </Badge>
                    ) : (
                      <Badge className="bg-orange-500 hover:bg-orange-600">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        OUT OF SCOPE
                      </Badge>
                    )}
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">Vraag klant:</Label>
                    <p className="text-sm font-medium mt-1">{assistantResponse.analyse.vraag_van_klant}</p>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">Analyse:</Label>
                    <p className="text-sm mt-1">{assistantResponse.analyse.inhoudelijke_samenvatting_antwoord}</p>
                  </div>
                </div>

                {/* Draft Email Block */}
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="concept_onderwerp" className="text-sm font-medium">
                      Onderwerp:
                    </Label>
                    <Input
                      id="concept_onderwerp"
                      value={assistantResponse.concept_email.onderwerp}
                      onChange={(e) => setAssistantResponse({
                        ...assistantResponse,
                        concept_email: {
                          ...assistantResponse.concept_email,
                          onderwerp: e.target.value,
                        },
                      })}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="concept_body" className="text-sm font-medium">
                      E-mail Body:
                    </Label>
                    <Textarea
                      id="concept_body"
                      value={assistantResponse.concept_email.body}
                      onChange={(e) => setAssistantResponse({
                        ...assistantResponse,
                        concept_email: {
                          ...assistantResponse.concept_email,
                          body: e.target.value,
                        },
                      })}
                      className="mt-2 min-h-64 font-sans"
                    />
                  </div>
                </div>

                {/* Feedback & Refinement Section */}
                <div className="border-t pt-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    <Label className="text-base font-semibold">Feedback & Aanpassingen</Label>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Niet helemaal tevreden? Geef feedback en laat de AI de e-mail aanpassen.
                  </p>
                  <div className="space-y-3">
                    <Textarea
                      value={feedbackInput}
                      onChange={(e) => setFeedbackInput(e.target.value)}
                      placeholder='Bijvoorbeeld: "Maak de e-mail korter en directer" of "Voeg meer detail toe over de berekening"'
                      className="min-h-24"
                    />
                    <Button
                      onClick={handleRefine}
                      disabled={isRefining || !feedbackInput.trim()}
                      size="sm"
                    >
                      {isRefining ? (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                          Aanpassen...
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />
                          Pas E-mail Aan
                        </>
                      )}
                    </Button>
                  </div>
                </div>

              </CardContent>
            </Card>
          </div>
        )}

          </div>

          {/* Session Sidebar */}
          <aside className="w-80 flex-shrink-0">
            <SessionSidebar
              onLoadSession={handleLoadSession}
              currentSessionId={currentSessionId}
            />
          </aside>
        </div>
      </div>

      {/* Settings Modal */}
      <AssistantSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        aiModel={aiModel}
        setAiModel={setAiModel}
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
      />
    </div>
  );
});

export default FollowUpAssistant;
