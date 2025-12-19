/**
 * Box3CaseList Component - V3
 *
 * Displays a list of all Box 3 dossiers with:
 * - Search by client name
 * - Filter by status
 * - Sort by date/name
 * - Dashboard overview with statistics
 * - View/Create/Delete dossiers
 */

import { memo, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  FileCheck,
  Trash2,
  Clock,
  User,
  Calendar,
  Users,
  Search,
  Filter,
  ArrowUpDown,
  CheckCircle2,
  AlertTriangle,
  FileQuestion,
  LayoutGrid,
} from "lucide-react";
import type { Box3DossierLight } from "@/hooks/useBox3Sessions";

interface Box3CaseListProps {
  sessions: Box3DossierLight[] | undefined;
  onSelectCase: (dossierId: string) => void;
  onNewCase: () => void;
  onDeleteCase: (dossierId: string) => void;
}

type StatusFilter = "all" | "afgerond" | "in_behandeling" | "wacht_op_klant" | "intake";
type SortOption = "newest" | "oldest" | "name_asc" | "name_desc";

const getStatusColor = (status: string | null | undefined) => {
  if (!status) return "bg-gray-100 text-gray-800";
  switch (status) {
    case "afgerond":
      return "bg-green-100 text-green-800";
    case "in_behandeling":
      return "bg-blue-100 text-blue-800";
    case "wacht_op_klant":
      return "bg-amber-100 text-amber-800";
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
  // Search & filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortOption, setSortOption] = useState<SortOption>("newest");

  // Calculate statistics
  const stats = useMemo(() => {
    if (!sessions) return { total: 0, afgerond: 0, inBehandeling: 0, wachtOpKlant: 0 };

    return {
      total: sessions.length,
      afgerond: sessions.filter(s => s.status === "afgerond").length,
      inBehandeling: sessions.filter(s => s.status === "in_behandeling").length,
      wachtOpKlant: sessions.filter(s => s.status === "wacht_op_klant").length,
    };
  }, [sessions]);

  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    if (!sessions) return [];

    let result = [...sessions];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.clientName?.toLowerCase().includes(query) ||
          s.dossierNummer?.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (statusFilter !== "all") {
      result = result.filter((s) => s.status === statusFilter);
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortOption) {
        case "newest":
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        case "oldest":
          return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        case "name_asc":
          return (a.clientName || "").localeCompare(b.clientName || "");
        case "name_desc":
          return (b.clientName || "").localeCompare(a.clientName || "");
        default:
          return 0;
      }
    });

    return result;
  }, [sessions, searchQuery, statusFilter, sortOption]);

  const handleDelete = (dossierId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Weet je zeker dat je dit dossier wilt verwijderen?")) {
      onDeleteCase(dossierId);
    }
  };

  // Quick filter by clicking on stat card
  const handleStatClick = (status: StatusFilter) => {
    setStatusFilter(statusFilter === status ? "all" : status);
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

      {/* Dashboard Stats */}
      {sessions && sessions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button
            onClick={() => handleStatClick("all")}
            className={`p-4 rounded-lg border text-left transition-all hover:shadow-md ${
              statusFilter === "all" ? "ring-2 ring-primary bg-primary/5" : "bg-white"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <LayoutGrid className="h-4 w-4 text-gray-500" />
              <span className="text-sm text-muted-foreground">Totaal</span>
            </div>
            <p className="text-2xl font-bold">{stats.total}</p>
          </button>

          <button
            onClick={() => handleStatClick("afgerond")}
            className={`p-4 rounded-lg border text-left transition-all hover:shadow-md ${
              statusFilter === "afgerond" ? "ring-2 ring-green-500 bg-green-50" : "bg-white"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Afgerond</span>
            </div>
            <p className="text-2xl font-bold text-green-600">{stats.afgerond}</p>
          </button>

          <button
            onClick={() => handleStatClick("in_behandeling")}
            className={`p-4 rounded-lg border text-left transition-all hover:shadow-md ${
              statusFilter === "in_behandeling" ? "ring-2 ring-blue-500 bg-blue-50" : "bg-white"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">In behandeling</span>
            </div>
            <p className="text-2xl font-bold text-blue-600">{stats.inBehandeling}</p>
          </button>

          <button
            onClick={() => handleStatClick("wacht_op_klant")}
            className={`p-4 rounded-lg border text-left transition-all hover:shadow-md ${
              statusFilter === "wacht_op_klant" ? "ring-2 ring-amber-500 bg-amber-50" : "bg-white"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">Wacht op klant</span>
            </div>
            <p className="text-2xl font-bold text-amber-600">{stats.wachtOpKlant}</p>
          </button>
        </div>
      )}

      {/* Search & Filter Bar */}
      {sessions && sessions.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Zoek op klantnaam of dossiernummer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statussen</SelectItem>
              <SelectItem value="afgerond">Afgerond</SelectItem>
              <SelectItem value="in_behandeling">In behandeling</SelectItem>
              <SelectItem value="wacht_op_klant">Wacht op klant</SelectItem>
              <SelectItem value="intake">Intake</SelectItem>
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select value={sortOption} onValueChange={(v) => setSortOption(v as SortOption)}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <ArrowUpDown className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Sorteren" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Nieuwste eerst</SelectItem>
              <SelectItem value="oldest">Oudste eerst</SelectItem>
              <SelectItem value="name_asc">Naam A-Z</SelectItem>
              <SelectItem value="name_desc">Naam Z-A</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Results count when filtering */}
      {sessions && sessions.length > 0 && (searchQuery || statusFilter !== "all") && (
        <p className="text-sm text-muted-foreground">
          {filteredSessions.length} van {sessions.length} dossiers
          {searchQuery && ` voor "${searchQuery}"`}
          {statusFilter !== "all" && ` met status "${getStatusLabel(statusFilter)}"`}
        </p>
      )}

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
      ) : filteredSessions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileQuestion className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Geen resultaten</h3>
            <p className="text-muted-foreground text-center mb-4">
              Geen dossiers gevonden met de huidige filters.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("all");
              }}
            >
              Filters wissen
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredSessions.map((dossier) => (
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
