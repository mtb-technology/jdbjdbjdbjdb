import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface ResearchProgressStepperProps {
  currentStage: string;
  percentage: number;
  message?: string;
}

const RESEARCH_STAGES = [
  { id: 'planning', label: 'Planning' },
  { id: 'executing', label: 'Onderzoek' },
  { id: 'publishing', label: 'Synthese' },
  { id: 'finalizing', label: 'Afronding' },
] as const;

type StageId = typeof RESEARCH_STAGES[number]['id'];

function getStageStatus(stageId: StageId, currentStage: string): 'completed' | 'active' | 'pending' {
  const currentIndex = RESEARCH_STAGES.findIndex(s => s.id === currentStage);
  const stageIndex = RESEARCH_STAGES.findIndex(s => s.id === stageId);

  if (stageIndex < currentIndex) return 'completed';
  if (stageIndex === currentIndex) return 'active';
  return 'pending';
}

function getStageIcon(status: 'completed' | 'active' | 'pending') {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case 'active':
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case 'pending':
      return <Circle className="w-4 h-4 text-gray-300" />;
  }
}

export function ResearchProgressStepper({
  currentStage,
  percentage,
  message
}: ResearchProgressStepperProps) {
  // Extract question progress from message if available (e.g., "Onderzoek 3/5: ...")
  const questionMatch = message?.match(/(\d+)\/(\d+)/);
  const questionProgress = questionMatch
    ? `${questionMatch[1]}/${questionMatch[2]}`
    : null;

  return (
    <div className="space-y-3 p-3 bg-muted/50 rounded-lg border">
      {/* Stepper */}
      <div className="flex items-center justify-between gap-1">
        {RESEARCH_STAGES.map((stage, index) => {
          const status = getStageStatus(stage.id, currentStage);
          const isLast = index === RESEARCH_STAGES.length - 1;

          return (
            <div key={stage.id} className="flex items-center flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                {getStageIcon(status)}
                <span className={`text-xs truncate ${
                  status === 'active'
                    ? 'font-medium text-foreground'
                    : status === 'completed'
                    ? 'text-green-600'
                    : 'text-muted-foreground'
                }`}>
                  {stage.label}
                  {status === 'active' && stage.id === 'executing' && questionProgress && (
                    <span className="ml-1 font-normal">({questionProgress})</span>
                  )}
                </span>
              </div>
              {!isLast && (
                <div className={`flex-1 h-px mx-2 ${
                  status === 'completed' ? 'bg-green-400' : 'bg-gray-200'
                }`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <Progress value={percentage} className="h-2" />

      {/* Current action message */}
      {message && (
        <p className="text-xs text-muted-foreground truncate" title={message}>
          {message}
        </p>
      )}
    </div>
  );
}
