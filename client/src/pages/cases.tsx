import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Search, FileText, Calendar, User, Download, Trash2, Eye, Archive, RefreshCw, Menu } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiRequest } from "@/lib/queryClient";

interface Case {
  id: string;
  title: string;
  clientName: string;
  status: "draft" | "processing" | "generated" | "exported" | "archived";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface CasesResponse {
  reports: Case[];
  total: number;
  page: number;
  totalPages: number;
}

// Memoized Case Item Component for better performance
const CaseItem = memo(function CaseItem({ case_, getStatusColor, getStatusText, handleExport, updateStatusMutation, deleteCaseMutation }: {
  case_: Case;
  getStatusColor: (status: string) => "secondary" | "default" | "outline" | "destructive" | undefined;
  getStatusText: (status: string, report?: any) => string;
  handleExport: (caseId: string, format: string) => void;
  updateStatusMutation: any;
  deleteCaseMutation: any;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-lg font-semibold">{case_.title}</h3>
              <Badge variant={getStatusColor(case_.status)}>
                {getStatusText(case_.status, case_)}
              </Badge>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <User className="h-4 w-4" />
                {case_.clientName}
              </div>
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {new Date(case_.createdAt).toLocaleDateString('nl-NL')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/cases/${case_.id}`}>
              <Button variant="outline" size="sm" data-testid={`button-view-case-${case_.id}`}>
                <Eye className="h-4 w-4 mr-2" />
                Bekijken
              </Button>
            </Link>
            {case_.status === "generated" && (
              <>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleExport(case_.id, "html")}
                  data-testid={`button-export-html-${case_.id}`}
                >
                  <Download className="h-4 w-4 mr-2" />
                  HTML
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleExport(case_.id, "json")}
                  data-testid={`button-export-json-${case_.id}`}
                >
                  <Download className="h-4 w-4 mr-2" />
                  JSON
                </Button>
              </>
            )}
            {case_.status !== "archived" && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => updateStatusMutation.mutate({ id: case_.id, status: "archived" })}
                data-testid={`button-archive-${case_.id}`}
              >
                <Archive className="h-4 w-4 mr-2" />
                Archiveren
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid={`button-delete-${case_.id}`}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Verwijderen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Case verwijderen</AlertDialogTitle>
                  <AlertDialogDescription>
                    Weet je zeker dat je deze case wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuleren</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={() => deleteCaseMutation.mutate(case_.id)}
                    data-testid={`button-confirm-delete-${case_.id}`}
                  >
                    Verwijderen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

function Cases() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { data: casesData, isLoading } = useQuery<CasesResponse>({
    queryKey: ["/api/cases", { page, search, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", "10");
      if (search) params.set("search", search);
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      
      const response = await apiRequest("GET", `/api/cases?${params.toString()}`);
      return response.json();
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const response = await apiRequest("PATCH", `/api/cases/${id}/status`, { status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ["/api/cases"],
        exact: false 
      });
    },
  });

  const deleteCaseMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/cases/${id}`);
      return response.json();
    },
    onMutate: async (deletedId: string) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["/api/cases"] });

      // Snapshot the previous value
      const previousCases = queryClient.getQueryData(["/api/cases", { page, search, status: statusFilter }]);

      // Optimistically update to the new value
      queryClient.setQueryData(["/api/cases", { page, search, status: statusFilter }], (old: CasesResponse | undefined) => {
        if (!old) return old;
        return {
          ...old,
          reports: old.reports.filter(case_ => case_.id !== deletedId),
          total: old.total - 1
        };
      });

      // Return a context object with the snapshotted value
      return { previousCases };
    },
    onError: (err, deletedId, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousCases) {
        queryClient.setQueryData(["/api/cases", { page, search, status: statusFilter }], context.previousCases);
      }
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ 
        queryKey: ["/api/cases"],
        exact: false 
      });
    },
  });

  // Auto-adjust page if current page exceeds total pages after deletion
  useEffect(() => {
    if (casesData && casesData.totalPages > 0 && page > casesData.totalPages) {
      setPage(casesData.totalPages);
    }
  }, [casesData, page]);

  const getStatusColor = useCallback((status: string): "secondary" | "default" | "outline" | "destructive" | undefined => {
    switch (status) {
      case "draft": return "secondary";
      case "processing": return "default";
      case "generated": return "outline"; // Blauwe outline voor "groeiend" rapport
      case "exported": return "default"; // Groen voor echt voltooid
      case "archived": return "secondary";
      default: return "secondary";
    }
  }, []);

  const getStatusText = useCallback((status: string, report?: any) => {
    switch (status) {
      case "draft": return "Concept";
      case "processing": return "Bezig";
      case "generated": {
        // Calculate progress based on completed stages
        if (report?.stageResults) {
          const completedStages = Object.keys(report.stageResults).length;
          const totalStages = 11; // 11 workflow stages
          const percentage = Math.round((completedStages / totalStages) * 100);
          
          if (completedStages >= 3) {
            return `Stap ${completedStages}/11 (${percentage}%)`;
          } else {
            return `Wordt gegenereerd... ${completedStages}/11`;
          }
        }
        return "Rapport Groeit";
      }
      case "exported": return "Voltooid";
      case "archived": return "Gearchiveerd";
      default: return status;
    }
  }, []);

  const handleExport = useCallback((caseId: string, format: string) => {
    window.open(`/api/cases/${caseId}/export/${format}`, '_blank');
  }, []);

  const cases = useMemo(() => casesData?.reports || [], [casesData?.reports]);
  const totalPages = useMemo(() => casesData?.totalPages || 1, [casesData?.totalPages]);

  return (
    <div className="min-h-screen bg-background">
      
      {/* Header */}
      <header className="border-b border-border bg-card shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <div className="flex-shrink-0 flex items-center">
                <FileText className="text-2xl text-primary mr-3 h-8 w-8" />
                <span className="text-xl font-bold text-foreground">Case Management</span>
              </div>
              {/* Desktop Navigation */}
              <nav className="hidden md:ml-10 md:flex md:space-x-8">
                <Link href="/" className="text-muted-foreground hover:text-foreground" data-testid="nav-pipeline">
                  Pipeline
                </Link>
                <Link href="/cases" className="text-primary font-medium" data-testid="nav-cases">
                  Cases
                </Link>
                <Link href="/settings" className="text-muted-foreground hover:text-foreground" data-testid="nav-settings">
                  Instellingen
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button data-testid="button-new-case">
                  Nieuwe Case
                </Button>
              </Link>
              {/* Mobile Navigation */}
              <div className="md:hidden">
                <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
                      <Menu className="h-5 w-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="w-64">
                    <nav className="flex flex-col space-y-4 mt-8">
                      <Link href="/" className="text-muted-foreground hover:text-foreground p-2 rounded-md" data-testid="nav-mobile-pipeline">
                        Pipeline
                      </Link>
                      <Link href="/cases" className="text-primary font-medium p-2 rounded-md" data-testid="nav-mobile-cases">
                        Cases
                      </Link>
                      <Link href="/settings" className="text-muted-foreground hover:text-foreground p-2 rounded-md" data-testid="nav-mobile-settings">
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

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Cases Overzicht</CardTitle>
            <CardDescription>
              Beheer al je fiscale cases en rapporten
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="flex-1 relative w-full">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Zoek op klantnaam of titel..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-cases"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-48" data-testid="select-status-filter">
                  <SelectValue placeholder="Alle statussen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle statussen</SelectItem>
                  <SelectItem value="draft">Concept</SelectItem>
                  <SelectItem value="processing">Bezig</SelectItem>
                  <SelectItem value="generated">Voltooid</SelectItem>
                  <SelectItem value="exported">Geëxporteerd</SelectItem>
                  <SelectItem value="archived">Gearchiveerd</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Cases List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin" />
            <span className="ml-2">Cases laden...</span>
          </div>
        ) : cases.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Geen cases gevonden</h3>
              <p className="text-muted-foreground mb-6">
                {search || statusFilter ? "Geen cases gevonden die voldoen aan je filters" : "Je hebt nog geen cases aangemaakt"}
              </p>
              <Link href="/">
                <Button data-testid="button-create-first-case">
                  Eerste Case Aanmaken
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {cases.map((case_: Case) => (
              <Card key={case_.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold">{case_.title}</h3>
                        <Badge variant={getStatusColor(case_.status)}>
                          {getStatusText(case_.status, case_)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-6 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <User className="h-4 w-4" />
                          {case_.clientName}
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {new Date(case_.createdAt).toLocaleDateString('nl-NL')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link href={`/cases/${case_.id}`}>
                        <Button variant="outline" size="sm" data-testid={`button-view-case-${case_.id}`}>
                          <Eye className="h-4 w-4 mr-2" />
                          Bekijken
                        </Button>
                      </Link>
                      {case_.status === "generated" && (
                        <>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleExport(case_.id, "html")}
                            data-testid={`button-export-html-${case_.id}`}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            HTML
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleExport(case_.id, "json")}
                            data-testid={`button-export-json-${case_.id}`}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            JSON
                          </Button>
                        </>
                      )}
                      {case_.status !== "archived" && (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => updateStatusMutation.mutate({ id: case_.id, status: "archived" })}
                          data-testid={`button-archive-${case_.id}`}
                        >
                          <Archive className="h-4 w-4 mr-2" />
                          Archiveren
                        </Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" data-testid={`button-delete-${case_.id}`}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Verwijderen
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Case verwijderen</AlertDialogTitle>
                            <AlertDialogDescription>
                              Weet je zeker dat je deze case wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuleren</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => deleteCaseMutation.mutate(case_.id)}
                              data-testid={`button-confirm-delete-${case_.id}`}
                            >
                              Verwijderen
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <Button 
                  variant="outline" 
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  data-testid="button-previous-page"
                >
                  Vorige
                </Button>
                <span className="text-sm text-muted-foreground">
                  Pagina {page} van {totalPages}
                </span>
                <Button 
                  variant="outline" 
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  data-testid="button-next-page"
                >
                  Volgende
                </Button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}export default memo(Cases);
