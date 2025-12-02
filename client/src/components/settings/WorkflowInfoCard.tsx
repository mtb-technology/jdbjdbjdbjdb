/**
 * WorkflowInfoCard Component
 *
 * Footer info card explaining the workflow.
 * Extracted from lines 1315-1330 of settings.tsx.
 */

import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Workflow } from "lucide-react";

export const WorkflowInfoCard = memo(function WorkflowInfoCard() {
  return (
    <Card className="mt-8 bg-muted/50">
      <CardContent className="p-6">
        <div className="flex items-start space-x-3">
          <Workflow className="h-5 w-5 text-primary mt-1" />
          <div>
            <h3 className="font-semibold text-foreground mb-2">Workflow Overzicht</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              De 11-stappen workflow verwerkt elk rapport sequentieel door gespecialiseerde AI rollen.
              Elke stap bouwt voort op de resultaten van de vorige stap, wat zorgt voor een gelaagde
              en grondige analyse. Configureer alle prompts om de volledige functionaliteit te benutten.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
