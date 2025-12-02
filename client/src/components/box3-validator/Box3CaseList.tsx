/**
 * Box3CaseList Component
 *
 * Displays a list of all Box 3 validation cases with ability to:
 * - View existing cases
 * - Create new case
 * - Delete cases
 */

import { memo

 } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  FileCheck,
  Trash2,
  Clock,
  User,
  Paperclip,
} from "lucide-react";
import type { SessionLight } from "@/types/box3Validator.types";

interface Box3CaseListProps {
  sessions: SessionLight[] | undefined;
  onSelectCase: (sessionId: string) => void;
  onNewCase: () => void;
  onDeleteCase: (sessionId: string) => void;
}

const getStatusColor = (status: string | null | undefined) => {
  if (!status) return "bg-gray-100 text-gray-800";
  if (status === "READY_FOR_CALCULATION") return "bg-green-100 text-green-800";
  if (status.startsWith("REJECTED")) return "bg-red-100 text-red-800";
  return "bg-blue-100 text-blue-800";
};

const getStatusLabel = (status: string | null | undefined) => {
  if (!status) return "Onbekend";
  if (status === "READY_FOR_CALCULATION") return "Klaar voor berekening";
  if (status === "REJECTED_MISSING_INFO") return "Ontbrekende informatie";
  if (status === "REJECTED_NO_GROUNDS") return "Geen gronden";
  return status;
};

export const Box3CaseList = memo(function Box3CaseList({
  sessions,
  onSelectCase,
  onNewCase,
  onDeleteCase,
}: Box3CaseListProps) {
  const handleDelete = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Weet je zeker dat je deze case wilt verwijderen?")) {
      onDeleteCase(sessionId);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Box 3 Validator</h1>
          <p className="text-muted-foreground">
            Valideer ontvangen documenten en genereer een concept reactie
          </p>
        </div>
        <Button onClick={onNewCase} size="lg">
          <Plus className="h-5 w-5 mr-2" />
          Nieuwe Case
        </Button>
      </div>

      {/* Cases Grid */}
      {!sessions || sessions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileCheck className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Geen cases gevonden</h3>
            <p className="text-muted-foreground text-center mb-4">
              Je hebt nog geen Box 3 validaties uitgevoerd.
            </p>
            <Button onClick={onNewCase}>
              <Plus className="h-4 w-4 mr-2" />
              Start eerste case
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <Card
              key={session.id}
              className="cursor-pointer hover:border-primary transition-colors group"
              onClick={() => onSelectCase(session.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base font-medium truncate flex-1">
                    <User className="h-4 w-4 inline mr-2 text-muted-foreground" />
                    {session.clientName || "Onbekende klant"}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 transition-opacity -mr-2 -mt-1"
                    onClick={(e) => handleDelete(session.id, e)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Meta info */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {session.belastingjaar && (
                    <span className="flex items-center gap-1">
                      <FileCheck className="h-3 w-3" />
                      {session.belastingjaar}
                    </span>
                  )}
                  {session.attachmentCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Paperclip className="h-3 w-3" />
                      {session.attachmentCount} bijlage(s)
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(session.createdAt).toLocaleDateString("nl-NL")}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
});
