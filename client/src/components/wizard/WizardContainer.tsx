import { useState, useCallback, ReactNode } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ChevronLeft, ChevronRight, Check, Zap, FileText, Settings, Menu, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { DarkModeToggle } from "@/components/dark-mode-toggle";

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  component: ReactNode;
  canSkip?: boolean;
  isComplete?: boolean;
}

interface WizardContainerProps {
  steps: WizardStep[];
  currentStepIndex: number;
  onStepChange: (index: number) => void;
  onComplete: () => void;
  canGoNext?: boolean;
  canGoPrevious?: boolean;
  isProcessing?: boolean;
}

export function WizardContainer({
  steps,
  currentStepIndex,
  onStepChange,
  onComplete,
  canGoNext = true,
  canGoPrevious = true,
  isProcessing = false,
}: WizardContainerProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const currentStep = steps[currentStepIndex];
  const progress = ((currentStepIndex + 1) / steps.length) * 100;
  const isLastStep = currentStepIndex === steps.length - 1;

  const handleNext = useCallback(() => {
    if (isLastStep) {
      onComplete();
    } else {
      onStepChange(currentStepIndex + 1);
    }
  }, [isLastStep, currentStepIndex, onStepChange, onComplete]);

  const handlePrevious = useCallback(() => {
    if (currentStepIndex > 0) {
      onStepChange(currentStepIndex - 1);
    }
  }, [currentStepIndex, onStepChange]);

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation Header */}
      <header className="border-b border-border bg-card shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <div className="flex-shrink-0 flex items-center">
                <Zap className="text-2xl text-primary mr-3 h-8 w-8" />
                <span className="text-xl font-bold text-foreground">Rapport Wizard</span>
              </div>
              {/* Desktop Navigation */}
              <nav className="hidden md:ml-10 md:flex md:space-x-8">
                <Link href="/" className="text-primary font-medium">
                  Nieuwe Case
                </Link>
                <Link href="/cases" className="text-muted-foreground hover:text-foreground">
                  Cases
                </Link>
                <Link href="/batch" className="text-muted-foreground hover:text-foreground">
                  Batch
                </Link>
                <Link href="/settings" className="text-muted-foreground hover:text-foreground">
                  Instellingen
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <DarkModeToggle />
              {/* Mobile Navigation */}
              <div className="md:hidden">
                <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Menu className="h-5 w-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="w-64">
                    <nav className="flex flex-col space-y-4 mt-8">
                      <Link href="/" className="text-primary font-medium p-2 rounded-md">
                        Nieuwe Case
                      </Link>
                      <Link href="/cases" className="text-muted-foreground hover:text-foreground p-2 rounded-md">
                        Cases
                      </Link>
                      <Link href="/batch" className="text-muted-foreground hover:text-foreground p-2 rounded-md">
                        Batch
                      </Link>
                      <Link href="/settings" className="text-muted-foreground hover:text-foreground p-2 rounded-md">
                        Instellingen
                      </Link>
                    </nav>
                  </SheetContent>
                </Sheet>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Progress Header */}
      <div className="border-b bg-card shadow-sm sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 py-4">
          {/* Step Indicator */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-semibold">{currentStep.title}</h2>
                <p className="text-sm text-muted-foreground">{currentStep.description}</p>
              </div>
              <div className="text-sm font-medium text-muted-foreground">
                Stap {currentStepIndex + 1} van {steps.length}
              </div>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Step Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {steps.map((step, index) => {
              const isActive = index === currentStepIndex;
              const isComplete = index < currentStepIndex || step.isComplete;
              const isFuture = index > currentStepIndex;

              return (
                <button
                  key={step.id}
                  onClick={() => {
                    // Allow clicking on previous steps or completed steps
                    if (index < currentStepIndex || step.isComplete) {
                      onStepChange(index);
                    }
                  }}
                  disabled={isFuture && !step.isComplete}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all",
                    isActive && "bg-primary text-primary-foreground shadow-md scale-105",
                    isComplete && !isActive && "bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer",
                    isFuture && "bg-gray-100 text-gray-400 cursor-not-allowed"
                  )}
                >
                  {isComplete ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-current/20 text-xs">
                      {index + 1}
                    </span>
                  )}
                  <span className="hidden sm:inline">{step.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Card>
          <CardContent className="p-6">
            {currentStep.component}
          </CardContent>
        </Card>

        {/* Navigation Footer */}
        <div className="flex items-center justify-between mt-6">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={!canGoPrevious || currentStepIndex === 0 || isProcessing}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Vorige
          </Button>

          <div className="flex items-center gap-3">
            {currentStep.canSkip && !isLastStep && (
              <Button
                variant="ghost"
                onClick={handleNext}
                disabled={isProcessing}
              >
                Overslaan
              </Button>
            )}
            <Button
              onClick={handleNext}
              disabled={!canGoNext || isProcessing}
              size="lg"
            >
              {isProcessing ? (
                "Verwerken..."
              ) : isLastStep ? (
                "Voltooien"
              ) : (
                <>
                  Volgende
                  <ChevronRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
