import { useState, memo, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Save,
  History,
  ChevronDown,
  ChevronRight,
  Upload,
  XCircle,
  MessageSquare,
  Code2,
  Check
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/app-header";
import { AssistantSettingsModal } from "@/components/assistant/AssistantSettingsModal";
import { SimpleEmailSettingsModal } from "@/components/assistant/SimpleEmailSettingsModal";
import { SessionSidebar } from "@/components/assistant/SessionSidebar";
import { ExternalReportTab } from "@/components/assistant/ExternalReportTab";
import type { FollowUpSession, FollowUpThread, ExternalReportSession } from "@shared/schema";

interface PendingFile {
  file: File;
  name: string;
}

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

// Default Simple Email Assistant Prompt
export const DEFAULT_SIMPLE_EMAIL_PROMPT = `[ROL & DOEL]
Jij bent een "Senior Fiscaal Assistent" die snel en professioneel reageert op email correspondentie. Jouw taak is het analyseren van een email thread (inclusief eventuele bijlages) en het opstellen van een passend concept-antwoord.

[ANALYSESTAPPEN]
1. Lees de email thread zorgvuldig door en begrijp de context
2. Analyseer eventuele bijlages (documenten, cijfers, overzichten)
3. Identificeer de kernvraag of het verzoek van de klant
4. Bepaal of dit een:
   - Informatievraag is (uitleg over iets)
   - Actieverzoek is (iets moet gedaan worden)
   - Bevestigingsverzoek is (akkoord of feedback gevraagd)
   - Opvolging is (status update of herinnering)
5. Stel een professioneel, behulpzaam antwoord op

[STIJLRICHTLIJNEN]
- Professioneel maar vriendelijk
- Helder en bondig
- Gebruik "u" als formele aanspreking
- Begin met een bedanking of erkenning van de vraag
- Sluit af met een duidelijke volgende stap of aanbod voor verdere hulp

[OUTPUT-FORMAT (STRIKT)]
Genereer *alleen* de volgende JSON:
{
  "analyse": {
    "vraag_van_klant": "De specifieke vraag of het verzoek dat de AI heeft gedetecteerd.",
    "type_verzoek": "informatievraag|actieverzoek|bevestigingsverzoek|opvolging",
    "samenvatting_bijlages": "Korte samenvatting van relevante info uit bijlages (of 'Geen bijlages')"
  },
  "concept_email": {
    "onderwerp": "RE: [Onderwerp van de email]",
    "body": "..." // De gegenereerde concept-e-mail in PLAIN TEXT (geen HTML tags)
  }
}`;

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

interface SimpleEmailResponse {
  analyse: {
    vraag_van_klant: string;
    type_verzoek: "informatievraag" | "actieverzoek" | "bevestigingsverzoek" | "opvolging";
    samenvatting_bijlages: string;
  };
  concept_email: {
    onderwerp: string;
    body: string;
  };
  // Debug info from backend
  _debug?: {
    promptSent: string;
    attachmentNames: string[];
    visionAttachmentCount: number;
  };
}

// Helper function to strip markdown formatting for clean copy-paste
function stripMarkdown(text: string): string {
  return text
    // Remove bold **text** or __text__
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // Remove italic *text* or _text_
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove headers # ## ### etc
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bullet points - or *
    .replace(/^[\s]*[-*]\s+/gm, '• ')
    // Remove numbered lists formatting but keep numbers
    .replace(/^[\s]*(\d+)\.\s+/gm, '$1. ')
    // Clean up excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const FollowUpAssistant = memo(function FollowUpAssistant() {
  // Tab state
  const [activeTab, setActiveTab] = useState<"rapport" | "simpel" | "extern">("rapport");

  // === Rapport-based tab state ===
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
  const [sessionThreads, setSessionThreads] = useState<FollowUpThread[]>([]);

  // Local settings state for "Met Rapport" tab
  const [aiModel, setAiModel] = useState("gemini-3-pro-preview");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_FISCAL_ASSISTANT_PROMPT);

  // Local settings state for "Simpele Email" tab
  const [simpleAiModel, setSimpleAiModel] = useState("gemini-3-pro-preview");
  const [simpleSettingsOpen, setSimpleSettingsOpen] = useState(false);

  // === Simple email tab state ===
  const [simpleEmailThread, setSimpleEmailThread] = useState("");
  const [simplePendingFiles, setSimplePendingFiles] = useState<PendingFile[]>([]);
  const [isGeneratingSimple, setIsGeneratingSimple] = useState(false);
  const [simpleResponse, setSimpleResponse] = useState<SimpleEmailResponse | null>(null);
  const [showSimpleOutput, setShowSimpleOutput] = useState(false);
  const [simpleFeedbackInput, setSimpleFeedbackInput] = useState("");
  const [isRefiningSimple, setIsRefiningSimple] = useState(false);
  const [simpleSystemPrompt, setSimpleSystemPrompt] = useState(DEFAULT_SIMPLE_EMAIL_PROMPT);
  const simpleFileInputRef = useRef<HTMLInputElement>(null);

  // DevTools state for simple email
  const [showSimpleDevTools, setShowSimpleDevTools] = useState(false);
  const [simpleRawInputCollapsed, setSimpleRawInputCollapsed] = useState(true);
  const [simpleCopied, setSimpleCopied] = useState(false);
  const [simpleBodyCopied, setSimpleBodyCopied] = useState(false);
  const [simpleSubjectCopied, setSimpleSubjectCopied] = useState(false);

  // === External report tab state ===
  const [externalSessionIdToLoad, setExternalSessionIdToLoad] = useState<string | undefined>();
  const [currentExternalSessionId, setCurrentExternalSessionId] = useState<string | undefined>();

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

      // Save thread if we have an active session
      if (currentSessionId) {
        try {
          const threadResponse = await fetch(`/api/follow-up/sessions/${currentSessionId}/threads`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              emailThread: emailInput,
              aiAnalysis: result.analyse,
              conceptEmail: result.concept_email,
              threadNumber: String(sessionThreads.length + 1),
            }),
          });

          if (threadResponse.ok) {
            const threadData = await threadResponse.json();
            const savedThread = threadData.success ? threadData.data : threadData;
            setSessionThreads(prev => [...prev, savedThread]);
          }
        } catch (threadError) {
          console.error("Failed to save thread:", threadError);
          // Don't show error - thread saving is secondary
        }
      }

      toast({
        title: "Concept gegenereerd",
        description: currentSessionId
          ? "Het AI-antwoord is gegenereerd en opgeslagen bij de sessie."
          : "Het AI-antwoord is succesvol gegenereerd.",
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

  const handleLoadSession = async (session: FollowUpSession) => {
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

    // Fetch session with threads
    try {
      const response = await fetch(`/api/follow-up/sessions/${session.id}`);
      if (response.ok) {
        const data = await response.json();
        const sessionWithThreads = data.success ? data.data : data;
        if (sessionWithThreads.threads && sessionWithThreads.threads.length > 0) {
          setSessionThreads(sessionWithThreads.threads);
        } else {
          setSessionThreads([]);
        }
      }
    } catch (error) {
      console.error("Failed to load threads:", error);
      setSessionThreads([]);
    }

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

  // === Simple Email Tab Handlers ===
  const handleSimpleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;

      const newFiles = Array.from(e.target.files).map((file) => ({
        file,
        name: file.name,
      }));

      setSimplePendingFiles((prev) => [...prev, ...newFiles]);

      if (simpleFileInputRef.current) {
        simpleFileInputRef.current.value = "";
      }
    },
    []
  );

  const handleSimpleRemoveFile = useCallback((index: number) => {
    setSimplePendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSimpleGenerate = async () => {
    if (!simpleEmailThread.trim()) {
      toast({
        title: "Ontbrekende gegevens",
        description: "Plak de email thread om een antwoord te genereren.",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingSimple(true);

    try {
      // Build FormData for file upload
      const formData = new FormData();
      formData.append("emailThread", simpleEmailThread);
      formData.append("systemPrompt", simpleSystemPrompt);
      formData.append("model", simpleAiModel);

      // Add files
      for (const pf of simplePendingFiles) {
        formData.append("files", pf.file);
      }

      const response = await fetch("/api/assistant/simple-email", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || "Er ging iets mis");
      }

      const result = data.success ? data.data : data;

      // Debug logging
      console.log("📧 [SimpleEmail] Response data:", data);
      console.log("📧 [SimpleEmail] Result:", result);
      console.log("📧 [SimpleEmail] Has _debug:", !!result?._debug);

      if (!result || !result.analyse || !result.concept_email) {
        console.error("Invalid response structure:", result);
        throw new Error("Server antwoord heeft niet de verwachte structuur");
      }

      // Clean the body from markdown formatting for proper copy-paste
      const cleanedResult = {
        ...result,
        concept_email: {
          ...result.concept_email,
          body: stripMarkdown(result.concept_email.body)
        }
      };

      setSimpleResponse(cleanedResult);
      setShowSimpleOutput(true);

      toast({
        title: "Concept gegenereerd",
        description: "Het AI-antwoord is succesvol gegenereerd.",
      });
    } catch (error: any) {
      console.error("Simple generate failed:", error);
      toast({
        title: "Generatie mislukt",
        description: error.message || "Kon geen concept genereren. Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingSimple(false);
    }
  };

  const handleSimpleCopy = () => {
    if (!simpleResponse) return;

    const textToCopy = `Onderwerp: ${simpleResponse.concept_email.onderwerp}\n\n${simpleResponse.concept_email.body}`;
    navigator.clipboard.writeText(textToCopy);

    toast({
      title: "Gekopieerd",
      description: "Onderwerp en body zijn naar het klembord gekopieerd.",
    });
  };

  const handleSimpleReset = () => {
    setSimpleEmailThread("");
    setSimplePendingFiles([]);
    setShowSimpleOutput(false);
    setSimpleResponse(null);
    setSimpleFeedbackInput("");
  };

  const handleSimpleRefine = async () => {
    if (!simpleFeedbackInput.trim() || !simpleResponse) {
      toast({
        title: "Geen feedback",
        description: "Geef eerst feedback over hoe je de e-mail wilt aanpassen.",
        variant: "destructive",
      });
      return;
    }

    setIsRefiningSimple(true);

    try {
      const refinementPrompt = `Je hebt eerder deze e-mail gegenereerd:

ONDERWERP: ${simpleResponse.concept_email.onderwerp}

BODY:
${simpleResponse.concept_email.body}

De gebruiker wil de volgende aanpassing:
${simpleFeedbackInput}

Pas de e-mail aan op basis van deze feedback. Genereer ALLEEN de volgende JSON (zonder extra uitleg):
{
  "concept_email": {
    "onderwerp": "...",
    "body": "..."
  }
}`;

      const response = await fetch("/api/assistant/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemPrompt: "Je bent een e-mail editor die aanpassingen maakt op basis van gebruikersfeedback. Genereer ALLEEN JSON zonder extra tekst.",
          userInput: refinementPrompt,
          model: simpleAiModel,
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

      if (result.concept_email) {
        setSimpleResponse({
          ...simpleResponse,
          concept_email: {
            ...result.concept_email,
            body: stripMarkdown(result.concept_email.body)
          },
        });
        setSimpleFeedbackInput("");
        toast({
          title: "E-mail aangepast",
          description: "De e-mail is succesvol aangepast op basis van je feedback.",
        });
      } else {
        throw new Error("Geen concept_email in response");
      }
    } catch (error: any) {
      console.error("Simple refine failed:", error);
      toast({
        title: "Aanpassing mislukt",
        description: error.message || "Kon de e-mail niet aanpassen. Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setIsRefiningSimple(false);
    }
  };

  const handleCopyPrompt = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setSimpleCopied(true);
    setTimeout(() => setSimpleCopied(false), 2000);
  }, []);

  // Handler for loading external sessions from sidebar
  const handleLoadExternalSession = useCallback((session: ExternalReportSession) => {
    setExternalSessionIdToLoad(session.id);
    toast({
      title: "Sessie geladen",
      description: `Externe rapport sessie "${session.title}" is geladen.`,
    });
  }, [toast]);

  // Callback when external session changes in the tab
  const handleExternalSessionChange = useCallback((sessionId: string | undefined) => {
    setCurrentExternalSessionId(sessionId);
    // Clear the "to load" state once loaded
    if (sessionId) {
      setExternalSessionIdToLoad(undefined);
    }
  }, []);

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <AppHeader />

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

              </div>
            </div>

            {/* Tabs for different modes */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "rapport" | "simpel" | "extern")} className="mb-6">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="rapport" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Met Rapport
                </TabsTrigger>
                <TabsTrigger value="simpel" className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Simpele Email
                </TabsTrigger>
                <TabsTrigger value="extern" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Extern Rapport
                </TabsTrigger>
              </TabsList>

              {/* Tab 1: Met Rapport (existing functionality) */}
              <TabsContent value="rapport" className="mt-6">
                {/* Tab-specific settings button */}
                <div className="flex justify-end mb-4">
                  <Button
                    onClick={() => setSettingsOpen(true)}
                    variant="outline"
                    size="sm"
                  >
                    <SettingsIcon className="h-4 w-4 mr-2" />
                    Instellingen
                  </Button>
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

                {/* Thread History - Show previous generated emails */}
            {sessionThreads.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Eerdere Gegenereerde Emails ({sessionThreads.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {sessionThreads.map((thread, index) => {
                    const analysis = thread.aiAnalysis as { vraag_van_klant?: string; scope_status?: string } | null;
                    const email = thread.conceptEmail as { onderwerp?: string; body?: string } | null;

                    return (
                      <div key={thread.id} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            Thread #{index + 1}
                          </span>
                          <div className="flex items-center gap-2">
                            {analysis?.scope_status === "IN_SCOPE" ? (
                              <Badge className="bg-green-500 text-xs">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                IN SCOPE
                              </Badge>
                            ) : (
                              <Badge className="bg-orange-500 text-xs">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                OUT OF SCOPE
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {thread.createdAt ? new Date(thread.createdAt).toLocaleDateString('nl-NL') : ''}
                            </span>
                          </div>
                        </div>

                        {analysis?.vraag_van_klant && (
                          <div className="text-sm">
                            <span className="text-muted-foreground">Vraag: </span>
                            {analysis.vraag_van_klant}
                          </div>
                        )}

                        {email?.onderwerp && (
                          <div className="text-sm">
                            <span className="text-muted-foreground">Onderwerp: </span>
                            <span className="font-medium">{email.onderwerp}</span>
                          </div>
                        )}

                        {email?.body && (
                          <details className="text-sm">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground flex items-center gap-1">
                              <ChevronDown className="h-4 w-4" />
                              Toon email body
                            </summary>
                            <div className="mt-2 p-3 bg-muted/50 rounded text-sm whitespace-pre-wrap">
                              {email.body}
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

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
              </TabsContent>

              {/* Tab 2: Simpele Email (new functionality) */}
              <TabsContent value="simpel" className="mt-6">
                {/* Tab-specific settings button */}
                <div className="flex justify-end mb-4">
                  <Button
                    onClick={() => setSimpleSettingsOpen(true)}
                    variant="outline"
                    size="sm"
                  >
                    <SettingsIcon className="h-4 w-4 mr-2" />
                    Instellingen
                  </Button>
                </div>

                <Card className="mb-6">
                  <CardHeader>
                    <CardTitle className="flex items-center text-base">
                      <Mail className="h-4 w-4 mr-2 text-orange-500" />
                      Email Thread
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3">
                      Plak de volledige email thread (inclusief eerdere berichten) om een passend antwoord te genereren.
                    </p>
                    <Textarea
                      value={simpleEmailThread}
                      onChange={(e) => setSimpleEmailThread(e.target.value)}
                      placeholder="Plak hier de email thread..."
                      className="font-mono text-sm min-h-48"
                    />
                  </CardContent>
                </Card>

                {/* File Upload */}
                <Card className="mb-6">
                  <CardHeader>
                    <CardTitle className="flex items-center text-base">
                      <Upload className="h-4 w-4 mr-2 text-green-500" />
                      Bijlages ({simplePendingFiles.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Upload eventuele bijlages die bij de email horen (PDF, TXT, JPG, PNG). Deze worden meegenomen in de analyse.
                    </p>
                    <input
                      ref={simpleFileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.txt,.jpg,.jpeg,.png"
                      onChange={handleSimpleFileSelect}
                      className="hidden"
                    />
                    <Button
                      variant="outline"
                      onClick={() => simpleFileInputRef.current?.click()}
                      className="w-full"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Selecteer bestanden (PDF, TXT, JPG, PNG)
                    </Button>

                    {simplePendingFiles.length > 0 && (
                      <div className="space-y-2">
                        {simplePendingFiles.map((pf, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-2 bg-muted rounded-md"
                          >
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm truncate">{pf.name}</span>
                              <span className="text-xs text-muted-foreground">
                                ({(pf.file.size / 1024).toFixed(1)} KB)
                              </span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSimpleRemoveFile(idx)}
                            >
                              <XCircle className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Generate Button */}
                <div className="flex justify-center mb-8">
                  <Button
                    onClick={handleSimpleGenerate}
                    disabled={isGeneratingSimple}
                    size="lg"
                    className="min-w-64"
                  >
                    {isGeneratingSimple ? (
                      <>
                        <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                        Genereren...
                      </>
                    ) : (
                      <>
                        Genereer Reactie →
                      </>
                    )}
                  </Button>
                </div>

                {/* Simple Email Output */}
                {showSimpleOutput && simpleResponse && (
                  <Card className="border-primary">
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span>AI Analyse & Concept Antwoord</span>
                        <div className="flex gap-2">
                          <Button
                            onClick={handleSimpleCopy}
                            variant="outline"
                            size="sm"
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Kopieer
                          </Button>
                          <Button
                            onClick={handleSimpleReset}
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
                          <Badge variant="secondary">
                            {simpleResponse.analyse.type_verzoek}
                          </Badge>
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">Vraag/verzoek klant:</Label>
                          <p className="text-sm font-medium mt-1">{simpleResponse.analyse.vraag_van_klant}</p>
                        </div>

                        {simpleResponse.analyse.samenvatting_bijlages !== "Geen bijlages" && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Samenvatting bijlages:</Label>
                            <p className="text-sm mt-1">{simpleResponse.analyse.samenvatting_bijlages}</p>
                          </div>
                        )}
                      </div>

                      {/* Draft Email Block */}
                      <div className="space-y-4">
                        <div>
                          <div className="flex items-center justify-between">
                            <Label htmlFor="simple_onderwerp" className="text-sm font-medium">
                              Onderwerp:
                            </Label>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2"
                              onClick={() => {
                                navigator.clipboard.writeText(simpleResponse.concept_email.onderwerp);
                                setSimpleSubjectCopied(true);
                                setTimeout(() => setSimpleSubjectCopied(false), 2000);
                              }}
                            >
                              {simpleSubjectCopied ? (
                                <Check className="h-3 w-3 text-green-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                          <Input
                            id="simple_onderwerp"
                            value={simpleResponse.concept_email.onderwerp}
                            onChange={(e) => setSimpleResponse({
                              ...simpleResponse,
                              concept_email: {
                                ...simpleResponse.concept_email,
                                onderwerp: e.target.value,
                              },
                            })}
                            className="mt-2"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between">
                            <Label htmlFor="simple_body" className="text-sm font-medium">
                              E-mail Body:
                            </Label>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2"
                              onClick={() => {
                                navigator.clipboard.writeText(simpleResponse.concept_email.body);
                                setSimpleBodyCopied(true);
                                setTimeout(() => setSimpleBodyCopied(false), 2000);
                              }}
                            >
                              {simpleBodyCopied ? (
                                <Check className="h-3 w-3 text-green-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                          <Textarea
                            id="simple_body"
                            value={simpleResponse.concept_email.body}
                            onChange={(e) => setSimpleResponse({
                              ...simpleResponse,
                              concept_email: {
                                ...simpleResponse.concept_email,
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
                            value={simpleFeedbackInput}
                            onChange={(e) => setSimpleFeedbackInput(e.target.value)}
                            placeholder='Bijvoorbeeld: "Maak de e-mail korter" of "Voeg een bedanking toe"'
                            className="min-h-24"
                          />
                          <Button
                            onClick={handleSimpleRefine}
                            disabled={isRefiningSimple || !simpleFeedbackInput.trim()}
                            size="sm"
                          >
                            {isRefiningSimple ? (
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

                      {/* Developer Tools - LLM Input Panel */}
                      {simpleResponse._debug && (
                        <div className="border-t pt-6">
                          <div className="border border-dashed border-muted-foreground/30 rounded-lg overflow-hidden">
                            <button
                              onClick={() => setShowSimpleDevTools(!showSimpleDevTools)}
                              className="w-full px-4 py-2 flex items-center justify-between hover:bg-muted/30 transition-colors text-muted-foreground"
                            >
                              <span className="text-xs flex items-center gap-2">
                                <Code2 className="w-3 h-3" />
                                Developer Tools
                              </span>
                              {showSimpleDevTools ? (
                                <ChevronDown className="w-3 h-3" />
                              ) : (
                                <ChevronRight className="w-3 h-3" />
                              )}
                            </button>

                            {showSimpleDevTools && (
                              <div className="space-y-3 p-4 border-t border-dashed border-muted-foreground/30">
                                {/* Raw LLM Input Section */}
                                <div className="border border-blue-500/30 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 overflow-hidden">
                                  <button
                                    onClick={() => setSimpleRawInputCollapsed(!simpleRawInputCollapsed)}
                                    className="w-full px-3 py-2 flex items-center justify-between hover:bg-blue-100/50 dark:hover:bg-blue-950/30 transition-colors"
                                  >
                                    <span className="font-medium text-xs flex items-center gap-2 text-blue-600 dark:text-blue-400">
                                      <Code2 className="w-3 h-3" />
                                      Raw LLM Input
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="text-xs bg-white dark:bg-transparent">
                                        {simpleResponse._debug.promptSent.length.toLocaleString()} chars
                                      </Badge>
                                      {simpleRawInputCollapsed ? (
                                        <ChevronRight className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                      ) : (
                                        <ChevronDown className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                      )}
                                    </div>
                                  </button>
                                  {!simpleRawInputCollapsed && (
                                    <div className="px-3 py-3 bg-white dark:bg-background border-t border-blue-500/30">
                                      <div className="mb-2 flex items-center justify-between">
                                        <p className="text-xs text-muted-foreground">Exacte prompt naar LLM</p>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleCopyPrompt(simpleResponse._debug!.promptSent)}
                                          className="h-6 w-6 p-0"
                                        >
                                          {simpleCopied ? (
                                            <Check className="w-3 h-3" />
                                          ) : (
                                            <Copy className="w-3 h-3" />
                                          )}
                                        </Button>
                                      </div>
                                      <div className="bg-muted/50 p-3 rounded border font-mono text-xs overflow-auto max-h-64">
                                        <pre
                                          className="whitespace-pre-wrap break-words"
                                          style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
                                        >
                                          {simpleResponse._debug.promptSent}
                                        </pre>
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* Attachment Info */}
                                <div className="border rounded-lg p-3 bg-muted/30">
                                  <div className="flex items-center gap-2 mb-2">
                                    <FileText className="w-3 h-3 text-muted-foreground" />
                                    <span className="text-xs font-medium">Bijlages verwerkt</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {simpleResponse._debug.attachmentNames.length > 0
                                      ? simpleResponse._debug.attachmentNames.join(", ")
                                      : "Geen bijlages"}
                                    {simpleResponse._debug.visionAttachmentCount > 0 && (
                                      <Badge variant="secondary" className="ml-2 text-xs">
                                        {simpleResponse._debug.visionAttachmentCount} via vision
                                      </Badge>
                                    )}
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Tab 3: Extern Rapport (paste & adjust existing reports) */}
              <TabsContent value="extern" className="mt-6">
                {/* Tab-specific settings button - links to central settings */}
                <div className="flex justify-end mb-4">
                  <Button
                    onClick={() => window.location.href = "/settings"}
                    variant="outline"
                    size="sm"
                  >
                    <SettingsIcon className="h-4 w-4 mr-2" />
                    Centrale Instellingen
                  </Button>
                </div>

                <ExternalReportTab
                  sessionIdToLoad={externalSessionIdToLoad}
                  onSessionChange={handleExternalSessionChange}
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* Unified Session Sidebar - shows different sessions based on active tab */}
          <aside className="w-80 flex-shrink-0">
            <SessionSidebar
              onLoadSession={handleLoadSession}
              onLoadExternalSession={handleLoadExternalSession}
              currentSessionId={activeTab === "extern" ? currentExternalSessionId : currentSessionId}
              activeTab={activeTab}
            />
          </aside>
        </div>
      </div>

      {/* Settings Modal for "Met Rapport" tab */}
      <AssistantSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        aiModel={aiModel}
        setAiModel={setAiModel}
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
      />

      {/* Settings Modal for "Simpele Email" tab */}
      <SimpleEmailSettingsModal
        open={simpleSettingsOpen}
        onOpenChange={setSimpleSettingsOpen}
        aiModel={simpleAiModel}
        setAiModel={setSimpleAiModel}
        systemPrompt={simpleSystemPrompt}
        setSystemPrompt={setSimpleSystemPrompt}
      />
    </div>
  );
});

export default FollowUpAssistant;
