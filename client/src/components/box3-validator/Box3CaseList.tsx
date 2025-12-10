/**
 * Box3CaseList Component - V2
 *
 * Displays a list of all Box 3 dossiers with ability to:
 * - View existing dossiers
 * - Create new dossier
 * - Delete dossiers
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  FileCheck,
  Trash2,
  Clock,
  User,
  Calendar,
  Users,
} from "lucide-react";
import type { Box3DossierLight } from "@/hooks/useBox3Sessions";

interface Box3CaseListProps {
  sessions: Box3DossierLight[] | undefined;
  onSelectCase: (dossierId: string) => void;
  onNewCase: () => void;
  onDeleteCase: (dossierId: string) => void;
}

const getStatusColor = (status: string | null | undefined) => {
  if (!status) return "bg-gray-100 text-gray-800";
  switch (status) {
    case "afgerond":
      return "bg-green-100 text-green-800";
    case "in_behandeling":
      return "bg-blue-100 text-blue-800";
    case "wacht_op_klant":
      return "bg-yellow-100 text-yellow-800";
    case "intake":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
};

const getStatusLabel = (status: string | null | undefined) => {
  if (!status) return "Onbekend";
  switch (status) {
    case "afgerond":
      return "Afgerond";
    case "in_behandeling":
      return "In behandeling";
    case "wacht_op_klant":
      return "Wacht op klant";
    case "intake":
      return "Intake";
    default:
      return status;
  }
};

export const Box3CaseList = memo(function Box3CaseList({
  sessions,
  onSelectCase,
  onNewCase,
  onDeleteCase,
}: Box3CaseListProps) {
  const handleDelete = (dossierId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Weet je zeker dat je dit dossier wilt verwijderen?")) {
      onDeleteCase(dossierId);
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
          Nieuw Dossier
        </Button>
      </div>

      {/* Cases Grid */}
      {!sessions || sessions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileCheck className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Geen dossiers gevonden</h3>
            <p className="text-muted-foreground text-center mb-4">
              Je hebt nog geen Box 3 validaties uitgevoerd.
            </p>
            <Button onClick={onNewCase}>
              <Plus className="h-4 w-4 mr-2" />
              Start eerste dossier
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sessions.map((dossier) => (
            <Card
              key={dossier.id}
              className="cursor-pointer hover:border-primary transition-colors group"
              onClick={() => onSelectCase(dossier.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base font-medium truncate flex-1">
                    <User className="h-4 w-4 inline mr-2 text-muted-foreground" />
                    {dossier.clientName || "Onbekende klant"}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 transition-opacity -mr-2 -mt-1"
                    onClick={(e) => handleDelete(dossier.id, e)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
                {dossier.dossierNummer && (
                  <p className="text-xs text-muted-foreground">
                    Dossier #{dossier.dossierNummer}
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Status badge */}
                <Badge className={getStatusColor(dossier.status)}>
                  {getStatusLabel(dossier.status)}
                </Badge>

                {/* Meta info */}
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {/* Tax years */}
                  {dossier.taxYears && dossier.taxYears.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {dossier.taxYears.length === 1
                        ? dossier.taxYears[0]
                        : `${dossier.taxYears[0]}-${dossier.taxYears[dossier.taxYears.length - 1]}`}
                    </span>
                  )}

                  {/* Fiscal partner indicator */}
                  {dossier.hasFiscalPartner && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      Partner
                    </span>
                  )}

                  {/* Created date */}
                  {dossier.createdAt && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(dossier.createdAt).toLocaleDateString("nl-NL")}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
});
