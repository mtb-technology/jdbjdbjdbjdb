import { useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { WizardContainer, WizardStep } from "@/components/wizard/WizardContainer";
import { IntakeStep } from "@/components/wizard/steps/IntakeStep";
import { ProcessingStep } from "@/components/wizard/steps/ProcessingStep";
import { ReviewRoundStep } from "@/components/wizard/steps/ReviewRoundStep";
import { FinalizeStep } from "@/components/wizard/steps/FinalizeStep";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  FileSearch,
  Target,
  Wand2,
  Users,
  RefreshCw,
  GitCompare,
  Sparkles
} from "lucide-react";

interface StageOutput {
  [key: string]: {
    output: string;
    status: 'idle' | 'processing' | 'completed' | 'error';
    error?: string;
  };
}

interface Reviewer {
  key: string;
  name: string;
  icon: string;
  description: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  output?: string;
  error?: string;
}

export default function GuidedFlow() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Intake data
  const [clientName, setClientName] = useState("");
  const [rawText, setRawText] = useState("");
  const [reportId, setReportId] = useState<string>("");

  // Current step
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Stage outputs
  const [stageOutputs, setStageOutputs] = useState<StageOutput>({
    '1_informatiecheck': { output: '', status: 'idle' },
    '2_complexiteitscheck': { output: '', status: 'idle' },
    '3_generatie': { output: '', status: 'idle' },
    '5_feedback_verwerker': { output: '', status: 'idle' },
    '6_change_summary': { output: '', status: 'idle' },
  });

  // Reviewers
  const [reviewers, setReviewers] = useState<Reviewer[]>([
    {
      key: '4a_BronnenSpecialist',
      name: 'Bronnen Specialist',
      icon: '📚',
      description: 'Controleert wetgeving en jurisprudentie',
      status: 'pending',
    },
    {
      key: '4b_FiscaalTechnischSpecialist',
      name: 'Fiscaal Technisch Specialist',
      icon: '⚖️',
      description: 'Verificeert technische juistheid',
      status: 'pending',
    },
    {
      key: '4c_ScenarioGatenAnalist',
      name: 'Scenario & Gaten Analist',
      icon: '🔍',
      description: 'Identificeert ontbrekende scenario\'s',
      status: 'pending',
    },
    {
      key: '4d_DeVertaler',
      name: 'De Vertaler',
      icon: '🗣️',
      description: 'Zorgt voor begrijpelijke taal',
      status: 'pending',
    },
    {
      key: '4e_DeAdvocaat',
      name: 'De Advocaat',
      icon: '⚔️',
      description: 'Beoordeelt juridische houdbaarheid',
      status: 'pending',
    },
    {
      key: '4f_DeKlantpsycholoog',
      name: 'De Klantpsycholoog',
      icon: '💭',
      description: 'Controleert empathie en toon',
      status: 'pending',
    },
    {
      key: '4g_ChefEindredactie',
      name: 'Chef Eindredactie',
      icon: '✍️',
      description: 'Finale kwaliteitscontrole',
      status: 'pending',
    },
  ]);

  // Execute a single stage
  const executeStage = useCallback(async (stageKey: string) => {
    if (!reportId) {
      toast({
        title: "Geen rapport",
        description: "Er moet eerst een rapport aangemaakt worden",
        variant: "destructive",
      });
      return;
    }

    setStageOutputs(prev => ({
      ...prev,
      [stageKey]: { ...prev[stageKey], status: 'processing' }
    }));

    try {
      const response = await apiRequest(
        "POST",
        `/api/reports/${reportId}/stage/${stageKey}`,
        {}
      );

      // Parse response
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      const data = result.success ? result.data : result;

      setStageOutputs(prev => ({
        ...prev,
        [stageKey]: {
          output: data.stageResult || data.output || data.generatedContent || '',
          status: 'completed',
        }
      }));

      toast({
        title: "Stap voltooid",
        description: `${stageKey} is succesvol afgerond`,
      });
    } catch (error: any) {
      setStageOutputs(prev => ({
        ...prev,
        [stageKey]: {
          ...prev[stageKey],
          status: 'error',
          error: error.message || 'Er ging iets mis'
        }
      }));

      toast({
        title: "Fout bij verwerken",
        description: error.message || "Er ging iets mis",
        variant: "destructive",
      });
    }
  }, [reportId, toast]);

  // Execute reviewer
  const executeReviewer = useCallback(async (reviewerKey: string) => {
    if (!reportId) return;

    setReviewers(prev => prev.map(r =>
      r.key === reviewerKey ? { ...r, status: 'processing' as const } : r
    ));

    try {
      const response = await apiRequest(
        "POST",
        `/api/reports/${reportId}/stage/${reviewerKey}`,
        {}
      );

      // Parse response
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      const data = result.success ? result.data : result;

      setReviewers(prev => prev.map(r =>
        r.key === reviewerKey
          ? {
              ...r,
              status: 'completed' as const,
              output: data.stageResult || data.output || data.generatedContent || ''
            }
          : r
      ));
    } catch (error: any) {
      setReviewers(prev => prev.map(r =>
        r.key === reviewerKey
          ? {
              ...r,
              status: 'error' as const,
              error: error.message || 'Er ging iets mis'
            }
          : r
      ));
    }
  }, [reportId]);

  // Execute all reviewers
  const executeAllReviewers = useCallback(async () => {
    setReviewers(prev => prev.map(r => ({ ...r, status: 'processing' as const })));

    // Execute all in parallel
    await Promise.all(
      reviewers.map(reviewer => executeReviewer(reviewer.key))
    );

    toast({
      title: "Reviews voltooid",
      description: "Alle reviewers hebben hun feedback gegeven",
    });
  }, [reviewers, executeReviewer, toast]);

  // Create report in step 1
  const createReport = useCallback(async () => {
    try {
      const response = await apiRequest(
        "POST",
        "/api/reports/create",
        {
          clientName,
          rawText,
        }
      );

      const json = await response.json();
      const report = json.success ? json.data : json;

      setReportId(report.id);

      toast({
        title: "Rapport aangemaakt",
        description: `Nieuwe case voor ${clientName} is aangemaakt`,
      });

      // Move to next step automatically
      setCurrentStepIndex(1);
    } catch (error: any) {
      console.error("Create report error:", error);
      toast({
        title: "Fout bij aanmaken",
        description: error.message || "Er ging iets mis bij het aanmaken van het rapport",
        variant: "destructive",
      });
    }
  }, [clientName, rawText, toast]);

  // Validation
  const wordCount = rawText.trim().split(/\s+/).filter(Boolean).length;
  const isIntakeValid = clientName.trim().length > 0 && wordCount >= 10;

  // Debug: log validation status
  console.log('🔍 Validation check:', {
    clientName: clientName.trim(),
    clientNameValid: clientName.trim().length > 0,
    wordCount,
    wordCountValid: wordCount >= 10,
    isIntakeValid,
  });

  // Define wizard steps
  const steps: WizardStep[] = useMemo(() => [
    {
      id: 'intake',
      title: 'Intake',
      description: 'Client informatie en case details',
      isComplete: !!reportId,
      component: (
        <IntakeStep
          clientName={clientName}
          rawText={rawText}
          onClientNameChange={setClientName}
          onRawTextChange={setRawText}
          isValid={isIntakeValid}
        />
      ),
    },
    {
      id: 'informatiecheck',
      title: 'Informatiecheck',
      description: 'Validatie van de ingevoerde informatie',
      isComplete: stageOutputs['1_informatiecheck'].status === 'completed',
      component: (
        <ProcessingStep
          stageKey="1_informatiecheck"
          stageName="Informatiecheck"
          stageDescription="Controleert of alle benodigde informatie aanwezig is"
          icon={<FileSearch className="h-8 w-8 text-primary" />}
          reportId={reportId}
          output={stageOutputs['1_informatiecheck'].output}
          status={stageOutputs['1_informatiecheck'].status}
          error={stageOutputs['1_informatiecheck'].error}
          onExecute={() => executeStage('1_informatiecheck')}
          autoStart={false}
        />
      ),
    },
    {
      id: 'complexiteitscheck',
      title: 'Complexiteitscheck',
      description: 'Bepaal de aanpak en complexiteit',
      isComplete: stageOutputs['2_complexiteitscheck'].status === 'completed',
      component: (
        <ProcessingStep
          stageKey="2_complexiteitscheck"
          stageName="Complexiteitscheck"
          stageDescription="Analyseert de complexiteit van de case"
          icon={<Target className="h-8 w-8 text-primary" />}
          reportId={reportId}
          output={stageOutputs['2_complexiteitscheck'].output}
          status={stageOutputs['2_complexiteitscheck'].status}
          error={stageOutputs['2_complexiteitscheck'].error}
          onExecute={() => executeStage('2_complexiteitscheck')}
          autoStart={false}
        />
      ),
    },
    {
      id: 'generatie',
      title: 'Generatie',
      description: 'Concept rapport wordt gegenereerd',
      isComplete: stageOutputs['3_generatie'].status === 'completed',
      component: (
        <ProcessingStep
          stageKey="3_generatie"
          stageName="Rapport Generatie"
          stageDescription="Genereert het eerste concept van het adviesrapport"
          icon={<Wand2 className="h-8 w-8 text-primary" />}
          reportId={reportId}
          output={stageOutputs['3_generatie'].output}
          status={stageOutputs['3_generatie'].status}
          error={stageOutputs['3_generatie'].error}
          onExecute={() => executeStage('3_generatie')}
          autoStart={false}
        />
      ),
    },
    {
      id: 'review',
      title: 'Review Ronde',
      description: '7 gespecialiseerde reviewers',
      isComplete: reviewers.every(r => r.status === 'completed'),
      component: (
        <ReviewRoundStep
          reviewers={reviewers}
          onExecuteAll={executeAllReviewers}
          onExecuteReviewer={executeReviewer}
          allCompleted={reviewers.every(r => r.status === 'completed')}
          hasStarted={reviewers.some(r => r.status !== 'pending')}
        />
      ),
    },
    {
      id: 'verwerking',
      title: 'Verwerking',
      description: 'Feedback wordt verwerkt',
      isComplete: stageOutputs['5_feedback_verwerker'].status === 'completed',
      component: (
        <ProcessingStep
          stageKey="5_feedback_verwerker"
          stageName="Feedback Verwerking"
          stageDescription="Verwerkt alle feedback van de reviewers"
          icon={<RefreshCw className="h-8 w-8 text-primary" />}
          reportId={reportId}
          output={stageOutputs['5_feedback_verwerker'].output}
          status={stageOutputs['5_feedback_verwerker'].status}
          error={stageOutputs['5_feedback_verwerker'].error}
          onExecute={() => executeStage('5_feedback_verwerker')}
          autoStart={false}
        />
      ),
    },
    {
      id: 'afronden',
      title: 'Afronden',
      description: 'Rapport finaliseren en exporteren',
      isComplete: false,
      component: (
        <FinalizeStep
          reportId={reportId}
          reportTitle={`Fiscaal Advies - ${clientName}`}
          clientName={clientName}
          finalContent={stageOutputs['5_feedback_verwerker'].output || stageOutputs['3_generatie'].output}
          onComplete={() => navigate('/cases')}
          onViewReport={() => navigate(`/cases/${reportId}`)}
        />
      ),
    },
  ], [
    clientName,
    rawText,
    reportId,
    isIntakeValid,
    stageOutputs,
    reviewers,
    executeStage,
    executeAllReviewers,
    executeReviewer,
    navigate,
  ]);

  // Handle step change
  const handleStepChange = useCallback((index: number) => {
    // Special handling for step 0 -> 1 transition (need to create report)
    if (index === 1 && !reportId && isIntakeValid) {
      createReport();
      return;
    }

    setCurrentStepIndex(index);
  }, [reportId, isIntakeValid, createReport]);

  // Determine if can go next
  const canGoNext = useMemo(() => {
    if (currentStepIndex === 0) {
      // Intake step: must be valid
      return isIntakeValid;
    }

    // Processing steps (1-5): Always allow navigation
    // User has full control to move when ready
    if (currentStepIndex >= 1 && currentStepIndex <= 5) {
      return true;
    }

    // Final step: check completion
    return steps[currentStepIndex].isComplete;
  }, [currentStepIndex, isIntakeValid, steps]);

  return (
    <WizardContainer
      steps={steps}
      currentStepIndex={currentStepIndex}
      onStepChange={handleStepChange}
      onComplete={() => navigate('/cases')}
      canGoNext={canGoNext}
      canGoPrevious={currentStepIndex > 0 && currentStepIndex < steps.length - 1}
      isProcessing={Object.values(stageOutputs).some(s => s.status === 'processing') || reviewers.some(r => r.status === 'processing')}
    />
  );
}
