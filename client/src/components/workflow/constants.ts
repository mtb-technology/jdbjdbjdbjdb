import { 
  FileSearch,
  Brain,
  Wand2,
  Search,
  Calculator,
  Target,
  MessageSquare,
  UserCheck,
  PenTool,
  Shield,
  CheckCircle
} from "lucide-react";

export interface WorkflowStage {
  key: string;
  label: string;
  description: string;
  icon: any;
  type: "generator" | "reviewer" | "processor";
  substeps?: Array<{
    key: string;
    label: string;
    type: "review" | "processing";
  }>;
}

export const WORKFLOW_STAGES: WorkflowStage[] = [
  {
    key: "1_informatiecheck",
    label: "1. Informatiecheck",
    description: "Ruwe tekst → Gestructureerde informatie",
    icon: FileSearch,
    type: "generator",
  },
  {
    key: "2_complexiteitscheck",
    label: "2. Complexiteitscheck",
    description: "Analyse van complexiteit en scope",
    icon: Brain,
    type: "generator",
  },
  {
    key: "3_generatie",
    label: "3. Generatie",
    description: "Basis rapport generatie",
    icon: Wand2,
    type: "generator",
  },
  {
    key: "4a_BronnenSpecialist",
    label: "4a. Bronnen Specialist",
    description: "Review bronnen → JSON feedback → Rapport update",
    icon: Search,
    type: "reviewer",
    substeps: [
      { key: "review", label: "Review & JSON feedback", type: "review" },
      { key: "update", label: "Rapport update", type: "processing" }
    ]
  },
  {
    key: "4b_FiscaalTechnischSpecialist",
    label: "4b. Fiscaal Technisch Specialist",
    description: "Review fiscale techniek → JSON feedback → Rapport update",
    icon: Calculator,
    type: "reviewer",
    substeps: [
      { key: "review", label: "Review & JSON feedback", type: "review" },
      { key: "update", label: "Rapport update", type: "processing" }
    ]
  },
  {
    key: "4c_ScenarioGatenAnalist",
    label: "4c. Scenario Gaten Analist",
    description: "Review scenarios → JSON feedback → Rapport update",
    icon: Target,
    type: "reviewer",
    substeps: [
      { key: "review", label: "Review & JSON feedback", type: "review" },
      { key: "update", label: "Rapport update", type: "processing" }
    ]
  },
  {
    key: "4d_DeVertaler",
    label: "4d. De Vertaler",
    description: "Review communicatie → JSON feedback → Rapport update",
    icon: MessageSquare,
    type: "reviewer",
    substeps: [
      { key: "review", label: "Review & JSON feedback", type: "review" },
      { key: "update", label: "Rapport update", type: "processing" }
    ]
  },
  {
    key: "4e_DeAdvocaat",
    label: "4e. De Advocaat",
    description: "Review juridisch → JSON feedback → Rapport update",
    icon: UserCheck,
    type: "reviewer",
    substeps: [
      { key: "review", label: "Review & JSON feedback", type: "review" },
      { key: "update", label: "Rapport update", type: "processing" }
    ]
  },
  {
    key: "4f_DeKlantpsycholoog",
    label: "4f. De Klantpsycholoog",
    description: "Review klant focus → JSON feedback → Rapport update",
    icon: PenTool,
    type: "reviewer",
    substeps: [
      { key: "review", label: "Review & JSON feedback", type: "review" },
      { key: "update", label: "Rapport update", type: "processing" }
    ]
  },
  {
    key: "4g_ChefEindredactie",
    label: "4g. Chef Eindredactie",
    description: "Review eindredactie → JSON feedback → Rapport update",
    icon: Shield,
    type: "reviewer",
    substeps: [
      { key: "review", label: "Review & JSON feedback", type: "review" },
      { key: "update", label: "Rapport update", type: "processing" }
    ]
  },
  {
    key: "final_check",
    label: "Final Check",
    description: "Laatste controle voor Mathijs",
    icon: CheckCircle,
    type: "generator",
  },
];