import { useState, useRef, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileCheck,
  Upload,
  RefreshCw,
  Copy,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  XCircle,
  Trash2,
  FileText,
  Mail,
  ChevronDown,
  ChevronUp,
  Clock,
  Settings as SettingsIcon,
  TrendingUp,
  TrendingDown,
  Banknote,
  Building,
  PiggyBank,
  Calculator,
  Ban,
  AlertTriangle,
  Sparkles,
  Info
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/app-header";
import { Box3SettingsModal, DEFAULT_BOX3_SYSTEM_PROMPT } from "@/components/box3-validator/Box3SettingsModal";
import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";
import type { Box3ValidationResult, Box3ValidatorSession } from "@shared/schema";

interface SessionLight {
  id: string;
  clientName: string;
  belastingjaar: string | null;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

interface PendingFile {
  file: File;
  name: string;
}

// De 5 document categorieën die we uitvragen
const documentCategories = [
  {
    key: "aangifte_ib",
    label: "Aangifte inkomstenbelasting",
    description: "De PDF van de ingediende aangifte van het betreffende jaar.",
    waarom: "Dit is ons startpunt om te zien hoe de Belastingdienst uw vermogen nu heeft berekend.",
    icon: FileText,
  },
  {
    key: "bankrekeningen",
    label: "Bankrekeningen (Rente & Valuta)",
    description: "Een overzicht van de daadwerkelijk ontvangen rente en eventuele valutaresultaten.",
    waarom: "Wij moeten aantonen dat uw werkelijk ontvangen spaarrente lager is dan het forfaitaire rendement.",
    icon: Banknote,
  },
  {
    key: "beleggingen",
    label: "Beleggingen",
    description: "Overzicht met beginstand (1 jan), eindstand (31 dec), stortingen/onttrekkingen en dividenden.",
    waarom: "Door de begin- en eindstand te vergelijken berekenen we uw exacte vermogensgroei.",
    icon: TrendingUp,
  },
  {
    key: "vastgoed",
    label: "Vastgoed & overige bezittingen",
    description: "De WOZ-waarde op 1 januari van het jaar én het jaar erna (T+1). Bij verhuur: huuroverzicht.",
    waarom: "Voor vastgoed telt waardestijging plus eventuele huurinkomsten als totaalrendement.",
    icon: Building,
  },
  {
    key: "schulden",
    label: "Schulden",
    description: "Een overzicht van de schulden en de betaalde rente.",
    waarom: "Betaalde rente vermindert uw netto rendement.",
    icon: Calculator,
  },
];

const categoryLabels: Record<string, string> = {
  aangifte_ib: "Aangifte inkomstenbelasting",
  bankrekeningen: "Bankrekeningen",
  beleggingen: "Beleggingen",
  vastgoed: "Vastgoed & overige bezittingen",
  schulden: "Schulden"
};

// ========== FORFAITAIRE RENDEMENTEN PER BELASTINGJAAR ==========
// Bron: Belastingdienst - deze percentages worden jaarlijks vastgesteld
export interface ForfaitaireRendementen {
  spaargeld: number;       // Categorie I: Banktegoeden
  beleggingen: number;     // Categorie II: Overige bezittingen (aandelen, obligaties, etc.)
  schulden: number;        // Categorie III: Schulden (aftrekbaar percentage)
  heffingsvrijVermogen: number; // Drempelbedrag per persoon
}

export const FORFAITAIRE_RENDEMENTEN: Record<string, ForfaitaireRendementen> = {
  "2017": {
    spaargeld: 1.63,
    beleggingen: 5.39,
    schulden: 3.43,
    heffingsvrijVermogen: 25000,
  },
  "2018": {
    spaargeld: 0.36,
    beleggingen: 5.38,
    schulden: 3.20,
    heffingsvrijVermogen: 30000,
  },
  "2019": {
    spaargeld: 0.08,
    beleggingen: 5.59,
    schulden: 3.00,
    heffingsvrijVermogen: 30360,
  },
  "2020": {
    spaargeld: 0.04,
    beleggingen: 5.28,
    schulden: 2.74,
    heffingsvrijVermogen: 30846,
  },
  "2021": {
    spaargeld: 0.03,
    beleggingen: 5.69,
    schulden: 2.46,
    heffingsvrijVermogen: 50000,
  },
  "2022": {
    spaargeld: 0.00,
    beleggingen: 5.53,
    schulden: 2.28,
    heffingsvrijVermogen: 50650,
  },
  "2023": {
    spaargeld: 0.36,
    beleggingen: 6.17,
    schulden: 2.46,
    heffingsvrijVermogen: 57000,
  },
  "2024": {
    spaargeld: 1.03,
    beleggingen: 6.04,
    schulden: 2.47,
    heffingsvrijVermogen: 57000,
  },
};

// Box 3 tarief (belastingpercentage over het forfaitaire rendement)
export const BOX3_TARIEVEN: Record<string, number> = {
  "2017": 0.30,
  "2018": 0.30,
  "2019": 0.30,
  "2020": 0.30,
  "2021": 0.31,
  "2022": 0.31,
  "2023": 0.32,
  "2024": 0.36,
};

// Functie om forfaitaire rendementen op te halen voor een jaar
export const getForfaitaireRendementen = (jaar: string | null | undefined): ForfaitaireRendementen | null => {
  if (!jaar) return null;
  return FORFAITAIRE_RENDEMENTEN[jaar] || null;
};

// Functie om box 3 tarief op te halen
export const getBox3Tarief = (jaar: string | null | undefined): number => {
  if (!jaar) return 0.36; // default naar meest recente
  return BOX3_TARIEVEN[jaar] || 0.36;
};

// Helper om document status te krijgen uit zowel nieuw als legacy format
const getDocumentStatus = (result: Box3ValidationResult, categoryKey: string): string => {
  // Mapping van onze keys naar de AI output keys
  const keyMapping: Record<string, string> = {
    aangifte_ib: "aangifte_ib",
    bankrekeningen: "bank",
    beleggingen: "beleggingen",
    vastgoed: "vastgoed",
    schulden: "schulden"
  };

  // Probeer eerst het legacy format (validatie object)
  if (result.validatie) {
    const legacyVal = result.validatie[categoryKey as keyof typeof result.validatie];
    if (legacyVal?.status) {
      return legacyVal.status;
    }
  }

  // Probeer dan het nieuwe format (document_validatie)
  if (result.document_validatie) {
    const mappedKey = keyMapping[categoryKey] || categoryKey;
    const newVal = result.document_validatie[mappedKey as keyof typeof result.document_validatie];
    if (newVal) {
      return newVal;
    }
  }

  // Default: ontbreekt
  return "ontbreekt";
};

// Helper om feedback te krijgen
const getDocumentFeedback = (result: Box3ValidationResult, categoryKey: string): string | null => {
  if (result.validatie) {
    const legacyVal = result.validatie[categoryKey as keyof typeof result.validatie];
    if (legacyVal?.feedback) {
      return legacyVal.feedback;
    }
  }
  return null;
};

// Helper om gevonden_in te krijgen
const getDocumentGevondenIn = (result: Box3ValidationResult, categoryKey: string): string[] | null => {
  if (result.validatie) {
    const legacyVal = result.validatie[categoryKey as keyof typeof result.validatie];
    if (legacyVal?.gevonden_in) {
      return legacyVal.gevonden_in;
    }
  }
  return null;
};

// ========== KANSRIJKHEID ANALYSE ==========
interface RendementBerekening {
  // Input data (wat we hebben gevonden)
  bankRente: number | null;
  beleggingenBegin: number | null;
  beleggingenEind: number | null;
  beleggingenDividend: number | null;
  beleggingenMutatiesGevonden: boolean;
  schuldenRente: number | null;
  // Fiscale data uit aangifte
  forfaitairRendement: number | null;
  belastbaarInkomen: number | null;
  // Berekende waarden
  werkelijkRendement: number | null;
  verschil: number | null;
  indicatieveTeruggave: number | null;
  // Kansrijkheid
  isKansrijk: boolean | null;
  missendVoorBerekening: string[];
  // Gebruikte parameters
  gebruiktTarief: number;
  gebruiktJaar: string | null;
}

// Bereken werkelijk rendement en kansrijkheid
const berekenKansrijkheid = (result: Box3ValidationResult, belastingjaar: string | null | undefined): RendementBerekening => {
  const tarief = getBox3Tarief(belastingjaar);
  const data = result.gevonden_data?.werkelijk_rendement_input;
  const fiscus = result.gevonden_data?.fiscus_box3;

  const berekening: RendementBerekening = {
    bankRente: data?.bank_rente_ontvangen ?? null,
    beleggingenBegin: data?.beleggingen_waarde_1jan ?? null,
    beleggingenEind: data?.beleggingen_waarde_31dec ?? null,
    beleggingenDividend: data?.beleggingen_dividend ?? null,
    beleggingenMutatiesGevonden: data?.beleggingen_mutaties_gevonden ?? false,
    schuldenRente: data?.schulden_rente_betaald ?? null,
    forfaitairRendement: null, // Moet uit aangifte komen
    belastbaarInkomen: fiscus?.belastbaar_inkomen_na_drempel ?? null,
    werkelijkRendement: null,
    verschil: null,
    indicatieveTeruggave: null,
    isKansrijk: null,
    missendVoorBerekening: [],
    gebruiktTarief: tarief,
    gebruiktJaar: belastingjaar || null,
  };

  // Check wat er mist voor een volledige berekening
  if (berekening.bankRente === null) {
    berekening.missendVoorBerekening.push("Ontvangen bankrente");
  }
  if (berekening.beleggingenBegin === null && berekening.beleggingenEind !== null) {
    berekening.missendVoorBerekening.push("Beginwaarde beleggingen (1 jan)");
  }
  if (berekening.beleggingenEind === null && berekening.beleggingenBegin !== null) {
    berekening.missendVoorBerekening.push("Eindwaarde beleggingen (31 dec)");
  }
  if (berekening.beleggingenBegin !== null && berekening.beleggingenEind !== null && !berekening.beleggingenMutatiesGevonden) {
    berekening.missendVoorBerekening.push("Stortingen/onttrekkingen beleggingen");
  }
  if (berekening.belastbaarInkomen === null) {
    berekening.missendVoorBerekening.push("Belastbaar inkomen uit aangifte");
  }

  // Bereken werkelijk rendement (vereenvoudigd - zonder mutaties correctie)
  let werkelijk = 0;
  let heeftData = false;

  if (berekening.bankRente !== null) {
    werkelijk += berekening.bankRente;
    heeftData = true;
  }

  if (berekening.beleggingenDividend !== null) {
    werkelijk += berekening.beleggingenDividend;
    heeftData = true;
  }

  // Koerswinst/-verlies (zonder mutaties correctie - indicatief)
  if (berekening.beleggingenBegin !== null && berekening.beleggingenEind !== null) {
    const koersresultaat = berekening.beleggingenEind - berekening.beleggingenBegin;
    werkelijk += koersresultaat;
    heeftData = true;
  }

  // Aftrek betaalde rente
  if (berekening.schuldenRente !== null) {
    werkelijk -= berekening.schuldenRente;
  }

  if (heeftData) {
    berekening.werkelijkRendement = werkelijk;

    // Als we belastbaar inkomen hebben, kunnen we vergelijken
    // Note: belastbaar inkomen is na drempel, dus we vergelijken indirect
    if (berekening.belastbaarInkomen !== null && berekening.belastbaarInkomen > 0) {
      // Indicatieve berekening: als werkelijk rendement lager is dan forfaitair
      // zou er een teruggave kunnen zijn
      // Vereenvoudigd: we vergelijken met belastbaar inkomen * een factor
      const geschatForfaitair = berekening.belastbaarInkomen; // Dit is al het forfaitaire rendement na drempel
      berekening.forfaitairRendement = geschatForfaitair;
      berekening.verschil = geschatForfaitair - werkelijk;

      if (berekening.verschil > 0) {
        berekening.indicatieveTeruggave = berekening.verschil * tarief;
        berekening.isKansrijk = true;
      } else {
        berekening.indicatieveTeruggave = 0;
        berekening.isKansrijk = false;
      }
    }
  }

  return berekening;
};

const StatusIcon = ({ status }: { status: string }) => {
  if (status === "compleet") {
    return <CheckCircle className="h-5 w-5 text-green-500" />;
  } else if (status === "onvolledig") {
    return <AlertCircle className="h-5 w-5 text-orange-500" />;
  } else {
    return <XCircle className="h-5 w-5 text-red-500" />;
  }
};

const StatusBadge = ({ status }: { status: string }) => {
  if (status === "compleet") {
    return <Badge className="bg-green-500 hover:bg-green-600">Compleet</Badge>;
  } else if (status === "onvolledig") {
    return <Badge className="bg-orange-500 hover:bg-orange-600">Onvolledig</Badge>;
  } else if (status === "nvt") {
    return <Badge variant="secondary">N.v.t.</Badge>;
  } else {
    return <Badge variant="destructive">Ontbreekt</Badge>;
  }
};

// Global status badge voor nieuwe format
const GlobalStatusBadge = ({ status }: { status: string }) => {
  switch (status) {
    case "REJECTED_LOW_VALUE":
      return <Badge variant="destructive" className="text-sm"><Ban className="h-3 w-3 mr-1" />Afgewezen - Te laag belang</Badge>;
    case "REJECTED_SAVINGS_ONLY":
      return <Badge variant="destructive" className="text-sm"><PiggyBank className="h-3 w-3 mr-1" />Afgewezen - Alleen spaargeld</Badge>;
    case "MISSING_IB_CRITICAL":
      return <Badge className="bg-orange-500 hover:bg-orange-600 text-sm"><AlertTriangle className="h-3 w-3 mr-1" />Aangifte IB ontbreekt</Badge>;
    case "ACTION_REQUIRED":
      return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-sm"><AlertCircle className="h-3 w-3 mr-1" />Actie vereist</Badge>;
    case "READY_FOR_CALCULATION":
      return <Badge className="bg-green-500 hover:bg-green-600 text-sm"><CheckCircle className="h-3 w-3 mr-1" />Klaar voor berekening</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
};

// Format currency
const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value);
};

// Data row component
const DataRow = ({ label, value, highlight }: { label: string; value: string | number | boolean | null | undefined; highlight?: boolean }) => {
  let displayValue: string;
  if (value === null || value === undefined) {
    displayValue = "—";
  } else if (typeof value === "boolean") {
    displayValue = value ? "Ja" : "Nee";
  } else if (typeof value === "number") {
    displayValue = formatCurrency(value);
  } else {
    displayValue = String(value);
  }

  return (
    <div className={`flex justify-between py-1 ${highlight ? "font-semibold text-primary" : ""}`}>
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={`text-sm ${highlight ? "text-primary" : ""}`}>{displayValue}</span>
    </div>
  );
};

// LocalStorage key for persisting system prompt
const STORAGE_KEY_SYSTEM_PROMPT = "box3-validator-system-prompt";

// Utility to strip HTML tags and convert to plain text for email copying
const stripHtmlToPlainText = (html: string): string => {
  if (!html) return "";

  return html
    // Replace <br> and <br/> with newlines
    .replace(/<br\s*\/?>/gi, "\n")
    // Replace </p> with double newlines (paragraph breaks)
    .replace(/<\/p>/gi, "\n\n")
    // Replace other block-level closing tags with newlines
    .replace(/<\/(div|h[1-6]|li|tr)>/gi, "\n")
    // Replace <li> with bullet points
    .replace(/<li[^>]*>/gi, "• ")
    // Remove all remaining HTML tags
    .replace(/<[^>]*>/g, "")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&euro;/g, "€")
    // Clean up excessive newlines (more than 2 in a row)
    .replace(/\n{3,}/g, "\n\n")
    // Trim whitespace
    .trim();
};

const Box3Validator = memo(function Box3Validator() {
  const [clientName, setClientName] = useState("");
  const [inputText, setInputText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<Box3ValidationResult | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [editedConceptMail, setEditedConceptMail] = useState<{ onderwerp: string; body: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [lastUsedPrompt, setLastUsedPrompt] = useState<string | null>(null);

  // Load system prompt from localStorage, fallback to default
  const [systemPrompt, setSystemPrompt] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_SYSTEM_PROMPT);
      return saved || DEFAULT_BOX3_SYSTEM_PROMPT;
    }
    return DEFAULT_BOX3_SYSTEM_PROMPT;
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();

  // Handler to update system prompt and save to localStorage
  const handleSystemPromptChange = (newPrompt: string) => {
    setSystemPrompt(newPrompt);
    localStorage.setItem(STORAGE_KEY_SYSTEM_PROMPT, newPrompt);
  };

  // Fetch sessions
  const { data: sessions, refetch: refetchSessions } = useQuery<SessionLight[]>({
    queryKey: ["box3-validator-sessions"],
    queryFn: async () => {
      const res = await fetch("/api/box3-validator/sessions");
      const data = await res.json();
      return data.success ? data.data : [];
    },
    refetchInterval: 30000
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const newFiles = Array.from(e.target.files).map(file => ({
      file,
      name: file.name
    }));

    setPendingFiles(prev => [...prev, ...newFiles]);

    // Clear input for next selection
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleValidate = async () => {
    if (!clientName.trim()) {
      toast({
        title: "Klantnaam vereist",
        description: "Vul een klantnaam in.",
        variant: "destructive"
      });
      return;
    }

    if (!inputText.trim() && pendingFiles.length === 0) {
      toast({
        title: "Geen input",
        description: "Voer mail tekst in of upload documenten.",
        variant: "destructive"
      });
      return;
    }

    setIsValidating(true);

    try {
      const formData = new FormData();
      formData.append("clientName", clientName.trim());
      formData.append("inputText", inputText.trim() || "(geen mail tekst)");
      formData.append("systemPrompt", systemPrompt);

      for (const pf of pendingFiles) {
        formData.append("files", pf.file);
      }

      const response = await fetch("/api/box3-validator/validate", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = data.success ? data.data : data;

      setValidationResult(result.validationResult);
      setCurrentSessionId(result.session?.id || null);
      // Strip HTML from concept mail for clean copying
      const conceptMail = result.validationResult.concept_mail || result.validationResult.draft_mail;
      if (conceptMail) {
        setEditedConceptMail({
          onderwerp: stripHtmlToPlainText(conceptMail.onderwerp || ""),
          body: stripHtmlToPlainText(conceptMail.body || "")
        });
      }
      setLastUsedPrompt(systemPrompt);

      // Expand all categories by default
      setExpandedCategories(new Set(Object.keys(categoryLabels)));

      toast({
        title: "Validatie voltooid",
        description: "De documenten zijn geanalyseerd."
      });

      refetchSessions();
    } catch (error: any) {
      console.error("Validation failed:", error);
      toast({
        title: "Validatie mislukt",
        description: error.message || "Kon documenten niet valideren.",
        variant: "destructive"
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleCopyMail = () => {
    if (!editedConceptMail) return;

    const text = `Onderwerp: ${editedConceptMail.onderwerp}\n\n${editedConceptMail.body}`;
    navigator.clipboard.writeText(text);

    toast({
      title: "Gekopieerd",
      description: "Concept mail is naar het klembord gekopieerd."
    });
  };

  const handleReset = () => {
    setClientName("");
    setInputText("");
    setPendingFiles([]);
    setValidationResult(null);
    setCurrentSessionId(null);
    setEditedConceptMail(null);
    setExpandedCategories(new Set());
  };

  const handleRevalidate = async () => {
    if (!currentSessionId) {
      toast({
        title: "Geen sessie",
        description: "Laad eerst een sessie om opnieuw te valideren.",
        variant: "destructive"
      });
      return;
    }

    setIsValidating(true);

    try {
      const response = await fetch(`/api/box3-validator/sessions/${currentSessionId}/revalidate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ systemPrompt })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = data.success ? data.data : data;

      setValidationResult(result.validationResult);
      // Strip HTML from concept mail for clean copying
      const conceptMail = result.validationResult.concept_mail || result.validationResult.draft_mail;
      if (conceptMail) {
        setEditedConceptMail({
          onderwerp: stripHtmlToPlainText(conceptMail.onderwerp || ""),
          body: stripHtmlToPlainText(conceptMail.body || "")
        });
      }
      setExpandedCategories(new Set(Object.keys(categoryLabels)));
      setLastUsedPrompt(systemPrompt);

      toast({
        title: "Opnieuw gevalideerd",
        description: "De documenten zijn opnieuw geanalyseerd met de aangepaste prompt."
      });

      refetchSessions();
    } catch (error: any) {
      console.error("Re-validation failed:", error);
      toast({
        title: "Hervalidatie mislukt",
        description: error.message || "Kon documenten niet opnieuw valideren.",
        variant: "destructive"
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleLoadSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/box3-validator/sessions/${sessionId}`);
      if (!res.ok) throw new Error("Failed to load session");

      const data = await res.json();
      const session: Box3ValidatorSession = data.success ? data.data : data;

      setClientName(session.clientName);
      setInputText(session.inputText);
      setPendingFiles([]);
      setValidationResult(session.validationResult as Box3ValidationResult);
      setCurrentSessionId(session.id);
      // Strip HTML from concept mail for clean copying
      const conceptMail = session.conceptMail as { onderwerp?: string; body?: string } | null;
      if (conceptMail) {
        setEditedConceptMail({
          onderwerp: stripHtmlToPlainText(conceptMail.onderwerp || ""),
          body: stripHtmlToPlainText(conceptMail.body || "")
        });
      } else {
        setEditedConceptMail(null);
      }
      setExpandedCategories(new Set(Object.keys(categoryLabels)));

      toast({
        title: "Sessie geladen",
        description: `Sessie voor ${session.clientName} is geladen.`
      });
    } catch (error: any) {
      toast({
        title: "Laden mislukt",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!confirm("Weet je zeker dat je deze sessie wilt verwijderen?")) return;

    try {
      const res = await fetch(`/api/box3-validator/sessions/${sessionId}`, {
        method: "DELETE"
      });

      if (!res.ok) throw new Error("Failed to delete session");

      if (currentSessionId === sessionId) {
        handleReset();
      }

      refetchSessions();

      toast({
        title: "Sessie verwijderd",
        description: "De sessie is succesvol verwijderd."
      });
    } catch (error: any) {
      toast({
        title: "Verwijderen mislukt",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const toggleCategory = (key: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Determine if using new format (gevonden_data) or legacy format (validatie)
  const isNewFormat = validationResult?.gevonden_data || validationResult?.global_status;

  // Get belastingjaar from either format (convert to string if needed)
  const belastingjaarRaw = validationResult?.gevonden_data?.algemeen?.belastingjaar
    || validationResult?.belastingjaar;
  const belastingjaar = belastingjaarRaw != null ? String(belastingjaarRaw) : undefined;

  // Get mail from either format
  const mailData = validationResult?.draft_mail || validationResult?.concept_mail;

  return (
    <div className="min-h-screen bg-background">
      {/* Settings Modal */}
      <Box3SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        systemPrompt={systemPrompt}
        onSystemPromptChange={handleSystemPromptChange}
      />

      <AppHeader title="Box 3 Validator" icon={FileCheck} />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-6">
          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Page Header */}
            <div className="mb-8">
              <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold text-foreground">Box 3 Informatieverzoek Validator</h1>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                >
                  <SettingsIcon className="h-4 w-4 mr-2" />
                  COG Prompt
                </Button>
              </div>
              <p className="text-muted-foreground mt-2">
                Valideer ontvangen documenten en genereer een concept reactie.
              </p>
            </div>

            {/* Input Section */}
            <div className="grid gap-6 mb-8">
              {/* Client Name */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Klantnaam</CardTitle>
                </CardHeader>
                <CardContent>
                  <Input
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Bijv. Jan de Vries"
                  />
                </CardContent>
              </Card>

              {/* Mail Text Input */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Mail className="h-5 w-5 mr-2 text-blue-500" />
                    Mail van klant
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Plak hier de mail tekst van de klant..."
                    className="font-mono text-sm min-h-32"
                  />
                </CardContent>
              </Card>

              {/* File Upload */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Upload className="h-5 w-5 mr-2 text-green-500" />
                    Bijlages ({pendingFiles.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.txt"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Selecteer bestanden (PDF, TXT)
                  </Button>

                  {pendingFiles.length > 0 && (
                    <div className="space-y-2">
                      {pendingFiles.map((pf, idx) => (
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
                            onClick={() => handleRemoveFile(idx)}
                          >
                            <XCircle className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Validate Button */}
              <div className="flex justify-center">
                <Button
                  onClick={handleValidate}
                  disabled={isValidating}
                  size="lg"
                  className="min-w-64"
                >
                  {isValidating ? (
                    <>
                      <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                      Valideren...
                    </>
                  ) : (
                    <>
                      <FileCheck className="mr-2 h-5 w-5" />
                      Valideer Documenten
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Results Section */}
            {validationResult && (
              <div className="grid gap-6">
                {/* Header Card met Status */}
                <Card className={`border-2 ${
                  validationResult.global_status === "READY_FOR_CALCULATION" ? "border-green-500" :
                  validationResult.global_status?.startsWith("REJECTED") ? "border-red-500" :
                  "border-primary"
                }`}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span>Analyse Resultaat</span>
                        {belastingjaar && (
                          <Badge variant="outline">
                            Belastingjaar {belastingjaar}
                          </Badge>
                        )}
                        {validationResult.global_status && (
                          <GlobalStatusBadge status={validationResult.global_status} />
                        )}
                      </div>
                      <div className="flex gap-2">
                        {currentSessionId && (
                          <Button
                            onClick={handleRevalidate}
                            variant="default"
                            size="sm"
                            disabled={isValidating}
                          >
                            {isValidating ? (
                              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4 mr-2" />
                            )}
                            Opnieuw valideren
                          </Button>
                        )}
                        <Button onClick={handleReset} variant="outline" size="sm">
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Reset
                        </Button>
                      </div>
                    </CardTitle>
                  </CardHeader>
                </Card>

                {/* Kansrijkheid Analyse Card */}
                {(() => {
                  const kansrijkheid = berekenKansrijkheid(validationResult, belastingjaar);
                  const heeftBerekening = kansrijkheid.werkelijkRendement !== null;
                  const forfaitair = getForfaitaireRendementen(belastingjaar);

                  return (
                    <Card className={`border-2 ${
                      kansrijkheid.isKansrijk === true ? "border-green-500 bg-green-500/5" :
                      kansrijkheid.isKansrijk === false ? "border-orange-500 bg-orange-500/5" :
                      "border-muted"
                    }`}>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-primary" />
                            <span>Kansrijkheid Analyse</span>
                            {kansrijkheid.isKansrijk === true && (
                              <Badge className="bg-green-500 hover:bg-green-600">
                                <TrendingUp className="h-3 w-3 mr-1" />
                                Kansrijk
                              </Badge>
                            )}
                            {kansrijkheid.isKansrijk === false && (
                              <Badge className="bg-orange-500 hover:bg-orange-600">
                                <TrendingDown className="h-3 w-3 mr-1" />
                                Mogelijk niet kansrijk
                              </Badge>
                            )}
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Rendement Vergelijking */}
                        {heeftBerekening ? (
                          <div className="grid md:grid-cols-3 gap-4">
                            {/* Werkelijk Rendement */}
                            <div className="bg-muted/30 rounded-lg p-4 text-center">
                              <p className="text-xs text-muted-foreground mb-1">Werkelijk Rendement</p>
                              <p className={`text-2xl font-bold ${kansrijkheid.werkelijkRendement! < 0 ? "text-red-500" : "text-foreground"}`}>
                                {formatCurrency(kansrijkheid.werkelijkRendement)}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                (rente + dividend + koersresultaat)
                              </p>
                            </div>

                            {/* Forfaitair Rendement */}
                            <div className="bg-muted/30 rounded-lg p-4 text-center">
                              <p className="text-xs text-muted-foreground mb-1">Forfaitair Rendement</p>
                              {kansrijkheid.forfaitairRendement !== null ? (
                                <p className="text-2xl font-bold">
                                  {formatCurrency(kansrijkheid.forfaitairRendement)}
                                </p>
                              ) : (
                                <p className="text-lg text-muted-foreground">—</p>
                              )}
                              <p className="text-xs text-muted-foreground mt-1">
                                (uit aangifte IB)
                              </p>
                            </div>

                            {/* Indicatieve Teruggave */}
                            <div className={`rounded-lg p-4 text-center ${
                              kansrijkheid.isKansrijk ? "bg-green-500/10" : "bg-muted/30"
                            }`}>
                              <p className="text-xs text-muted-foreground mb-1">Indicatieve Teruggave</p>
                              {kansrijkheid.indicatieveTeruggave !== null ? (
                                <p className={`text-2xl font-bold ${kansrijkheid.indicatieveTeruggave > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                                  {formatCurrency(kansrijkheid.indicatieveTeruggave)}
                                </p>
                              ) : (
                                <p className="text-lg text-muted-foreground">—</p>
                              )}
                              <p className="text-xs text-muted-foreground mt-1">
                                (verschil × {(kansrijkheid.gebruiktTarief * 100).toFixed(0)}% box 3 tarief)
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-muted/30 rounded-lg p-4 text-center">
                            <Info className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">
                              Onvoldoende data om werkelijk rendement te berekenen
                            </p>
                          </div>
                        )}

                        {/* Opbouw werkelijk rendement */}
                        {heeftBerekening && (
                          <div className="border-t pt-4">
                            <p className="text-xs font-medium text-muted-foreground mb-2">Opbouw werkelijk rendement:</p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                              {kansrijkheid.bankRente !== null && (
                                <div className="flex justify-between bg-muted/20 rounded px-2 py-1">
                                  <span className="text-muted-foreground">Bankrente</span>
                                  <span className="font-medium">{formatCurrency(kansrijkheid.bankRente)}</span>
                                </div>
                              )}
                              {kansrijkheid.beleggingenDividend !== null && (
                                <div className="flex justify-between bg-muted/20 rounded px-2 py-1">
                                  <span className="text-muted-foreground">Dividend</span>
                                  <span className="font-medium">{formatCurrency(kansrijkheid.beleggingenDividend)}</span>
                                </div>
                              )}
                              {kansrijkheid.beleggingenBegin !== null && kansrijkheid.beleggingenEind !== null && (
                                <div className="flex justify-between bg-muted/20 rounded px-2 py-1">
                                  <span className="text-muted-foreground">Koersresultaat</span>
                                  <span className={`font-medium ${(kansrijkheid.beleggingenEind - kansrijkheid.beleggingenBegin) < 0 ? "text-red-500" : ""}`}>
                                    {formatCurrency(kansrijkheid.beleggingenEind - kansrijkheid.beleggingenBegin)}
                                  </span>
                                </div>
                              )}
                              {kansrijkheid.schuldenRente !== null && kansrijkheid.schuldenRente > 0 && (
                                <div className="flex justify-between bg-muted/20 rounded px-2 py-1">
                                  <span className="text-muted-foreground">Rente schulden</span>
                                  <span className="font-medium text-red-500">-{formatCurrency(kansrijkheid.schuldenRente)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Missende data voor volledige berekening */}
                        {kansrijkheid.missendVoorBerekening.length > 0 && (
                          <div className="border-t pt-4">
                            <div className="flex items-start gap-2 text-sm">
                              <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                              <div>
                                <p className="font-medium text-orange-600">Ontbrekend voor nauwkeurige berekening:</p>
                                <ul className="text-muted-foreground mt-1 space-y-0.5">
                                  {kansrijkheid.missendVoorBerekening.map((item, i) => (
                                    <li key={i}>• {item}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Gebruikte forfaitaire percentages */}
                        {forfaitair && (
                          <div className="border-t pt-4">
                            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                              <Calculator className="h-3 w-3" />
                              Gebruikte forfaitaire percentages ({kansrijkheid.gebruiktJaar}):
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                              <div className="bg-muted/20 rounded px-2 py-1.5">
                                <span className="text-muted-foreground">Spaargeld:</span>
                                <span className="font-medium ml-1">{forfaitair.spaargeld.toFixed(2)}%</span>
                              </div>
                              <div className="bg-muted/20 rounded px-2 py-1.5">
                                <span className="text-muted-foreground">Beleggingen:</span>
                                <span className="font-medium ml-1">{forfaitair.beleggingen.toFixed(2)}%</span>
                              </div>
                              <div className="bg-muted/20 rounded px-2 py-1.5">
                                <span className="text-muted-foreground">Schulden:</span>
                                <span className="font-medium ml-1">{forfaitair.schulden.toFixed(2)}%</span>
                              </div>
                              <div className="bg-muted/20 rounded px-2 py-1.5">
                                <span className="text-muted-foreground">Box 3 tarief:</span>
                                <span className="font-medium ml-1">{(kansrijkheid.gebruiktTarief * 100).toFixed(0)}%</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Disclaimer */}
                        <div className="text-xs text-muted-foreground bg-muted/20 rounded p-2 flex items-start gap-2">
                          <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          <span>
                            Dit is een indicatieve berekening. De definitieve berekening hangt af van alle vermogensbestanddelen,
                            stortingen/onttrekkingen, en de exacte forfaitaire percentages van het betreffende belastingjaar.
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* Debug: Raw Prompt & Output */}
                <div className="border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setShowRawOutput(!showRawOutput)}
                    className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FileText className="h-4 w-4" />
                      <span>Prompt & Raw Output</span>
                    </div>
                    {showRawOutput ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  {showRawOutput && (
                    <div className="p-4 space-y-4 border-t bg-muted/10">
                      {/* Used Prompt */}
                      <div>
                        <Label className="text-xs text-muted-foreground mb-2 block">Gebruikte Prompt</Label>
                        <pre className="bg-background border rounded p-3 text-xs font-mono overflow-auto max-h-64 whitespace-pre-wrap">
                          {lastUsedPrompt || systemPrompt}
                        </pre>
                      </div>
                      {/* Raw JSON Output */}
                      <div>
                        <Label className="text-xs text-muted-foreground mb-2 block">Raw JSON Output</Label>
                        <pre className="bg-background border rounded p-3 text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap">
                          {JSON.stringify(validationResult, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>

                {/* New Format: Gevonden Data Dashboard */}
                {isNewFormat && validationResult.gevonden_data && (
                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Fiscus Box 3 Data */}
                    {validationResult.gevonden_data.fiscus_box3 && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center">
                            <Calculator className="h-4 w-4 mr-2 text-blue-500" />
                            Fiscale Gegevens (Box 3)
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                          <DataRow
                            label="Totaal bezittingen (bruto)"
                            value={validationResult.gevonden_data.fiscus_box3.totaal_bezittingen_bruto}
                          />
                          <DataRow
                            label="Heffingsvrij vermogen"
                            value={validationResult.gevonden_data.fiscus_box3.heffingsvrij_vermogen}
                          />
                          <DataRow
                            label="Schulden Box 3"
                            value={validationResult.gevonden_data.fiscus_box3.schulden_box3}
                          />
                          <div className="border-t pt-2 mt-2">
                            <DataRow
                              label="Belastbaar inkomen (na drempel)"
                              value={validationResult.gevonden_data.fiscus_box3.belastbaar_inkomen_na_drempel}
                              highlight
                            />
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Werkelijk Rendement */}
                    {validationResult.gevonden_data.werkelijk_rendement_input && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center">
                            <TrendingUp className="h-4 w-4 mr-2 text-green-500" />
                            Werkelijk Rendement
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                          <DataRow
                            label="Bank rente ontvangen"
                            value={validationResult.gevonden_data.werkelijk_rendement_input.bank_rente_ontvangen}
                          />
                          <DataRow
                            label="Beleggingen waarde 1 jan"
                            value={validationResult.gevonden_data.werkelijk_rendement_input.beleggingen_waarde_1jan}
                          />
                          <DataRow
                            label="Beleggingen waarde 31 dec"
                            value={validationResult.gevonden_data.werkelijk_rendement_input.beleggingen_waarde_31dec}
                          />
                          <DataRow
                            label="Beleggingen dividend"
                            value={validationResult.gevonden_data.werkelijk_rendement_input.beleggingen_dividend}
                          />
                          <DataRow
                            label="Mutaties gevonden"
                            value={validationResult.gevonden_data.werkelijk_rendement_input.beleggingen_mutaties_gevonden}
                          />
                          <DataRow
                            label="Schulden rente betaald"
                            value={validationResult.gevonden_data.werkelijk_rendement_input.schulden_rente_betaald}
                          />
                        </CardContent>
                      </Card>
                    )}

                    {/* Analyse Box 3 */}
                    {validationResult.analyse_box3 && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center">
                            <FileCheck className="h-4 w-4 mr-2 text-purple-500" />
                            Analyse Resultaat
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                          <DataRow
                            label="Basis bedrag oordeel"
                            value={validationResult.analyse_box3.oordeel_basis_bedrag}
                            highlight
                          />
                          <DataRow
                            label="Conclusie type"
                            value={validationResult.analyse_box3.conclusie_type}
                          />
                        </CardContent>
                      </Card>
                    )}

                  </div>
                )}

                {/* Document Checklist - Altijd alle 5 categorieën tonen */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span className="flex items-center">
                        <FileCheck className="h-5 w-5 mr-2 text-primary" />
                        Document Checklist
                      </span>
                      <Badge variant={
                        documentCategories.filter(cat => {
                          const status = getDocumentStatus(validationResult, cat.key);
                          return status === "compleet";
                        }).length === 5 ? "default" : "secondary"
                      }>
                        {documentCategories.filter(cat => {
                          const status = getDocumentStatus(validationResult, cat.key);
                          return status === "compleet";
                        }).length}/5 compleet
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {documentCategories.map((cat) => {
                      const status = getDocumentStatus(validationResult, cat.key);
                      const feedback = getDocumentFeedback(validationResult, cat.key);
                      const gevondenIn = getDocumentGevondenIn(validationResult, cat.key);
                      const IconComponent = cat.icon;
                      const isExpanded = expandedCategories.has(cat.key);

                      return (
                        <div key={cat.key} className="border rounded-lg overflow-hidden">
                          <button
                            onClick={() => toggleCategory(cat.key)}
                            className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <StatusIcon status={status} />
                              <div className="flex items-center gap-2">
                                <IconComponent className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium text-sm">{cat.label}</span>
                              </div>
                              <StatusBadge status={status} />
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>

                          {isExpanded && (
                            <div className="p-3 pt-0 border-t bg-muted/30 space-y-2">
                              {/* Beschrijving van wat we nodig hebben */}
                              <div className="text-xs text-muted-foreground bg-background/50 rounded p-2">
                                <p className="font-medium mb-1">Wat we nodig hebben:</p>
                                <p>{cat.description}</p>
                                <p className="mt-1 italic">Waarom: {cat.waarom}</p>
                              </div>

                              {/* AI Feedback */}
                              {feedback && (
                                <div className="text-sm">
                                  <p className="font-medium text-xs text-muted-foreground mb-1">AI Analyse:</p>
                                  <p className="whitespace-pre-wrap">{feedback}</p>
                                </div>
                              )}

                              {/* Gevonden in documenten */}
                              {gevondenIn && gevondenIn.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-1">
                                  <span className="text-xs text-muted-foreground">Gevonden in:</span>
                                  {gevondenIn.map((doc: string, i: number) => (
                                    <Badge key={i} variant="outline" className="text-xs">
                                      {doc}
                                    </Badge>
                                  ))}
                                </div>
                              )}

                              {/* Geen feedback beschikbaar */}
                              {!feedback && status === "ontbreekt" && (
                                <p className="text-sm text-muted-foreground italic">
                                  Dit document is niet gevonden in de aangeleverde bestanden.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                {/* Concept Mail - beide formats */}
                {(editedConceptMail || mailData) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span className="flex items-center">
                          <Mail className="h-5 w-5 mr-2 text-primary" />
                          Concept Reactie Mail
                        </span>
                        <Button onClick={handleCopyMail} variant="outline" size="sm">
                          <Copy className="h-4 w-4 mr-2" />
                          Kopieer
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label>Onderwerp</Label>
                        <Input
                          value={editedConceptMail?.onderwerp || stripHtmlToPlainText(mailData?.onderwerp || "")}
                          onChange={(e) => setEditedConceptMail({
                            onderwerp: e.target.value,
                            body: editedConceptMail?.body || stripHtmlToPlainText(mailData?.body || "")
                          })}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>Bericht</Label>
                        <Textarea
                          value={editedConceptMail?.body || stripHtmlToPlainText(mailData?.body || "")}
                          onChange={(e) => setEditedConceptMail({
                            onderwerp: editedConceptMail?.onderwerp || stripHtmlToPlainText(mailData?.onderwerp || ""),
                            body: e.target.value
                          })}
                          className="mt-1 min-h-64 font-mono text-sm"
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>

          {/* Session Sidebar */}
          <div className="w-80 flex-shrink-0">
            <Card className="sticky top-8">
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <Clock className="h-4 w-4 mr-2" />
                  Recente Sessies
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[600px]">
                  {sessions && sessions.length > 0 ? (
                    <div className="divide-y">
                      {sessions.map((session) => (
                        <div
                          key={session.id}
                          onClick={() => handleLoadSession(session.id)}
                          className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                            currentSessionId === session.id ? "bg-primary/10" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm truncate">
                              {session.clientName}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => handleDeleteSession(session.id, e)}
                              className="h-6 w-6 p-0"
                            >
                              <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500" />
                            </Button>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {session.belastingjaar && (
                              <Badge variant="outline" className="text-xs">
                                {session.belastingjaar}
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {session.attachmentCount} bijlage(s)
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(session.createdAt), {
                              addSuffix: true,
                              locale: nl
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-muted-foreground text-sm">
                      Nog geen sessies opgeslagen
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
});

export default Box3Validator;
