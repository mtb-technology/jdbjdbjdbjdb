import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ToastAction } from "@/components/ui/toast";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Search, FileText, Calendar, User, Download, Trash2, Eye, Archive, RefreshCw, Menu, Package } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { celebrateExport } from "@/lib/confetti";
import { EmptyState } from "@/components/ui/empty-state";

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
const CaseItem = memo(function CaseItem({ case_, getStatusColor, getStatusText, handleExport, updateStatusMutation, handleDelete }: {
  case_: Case;
  getStatusColor: (status: string) => "secondary" | "default" | "outline" | "destructive" | undefined;
  getStatusText: (status: string, report?: any) => string;
  handleExport: (caseId: string, format: string) => void;
  updateStatusMutation: any;
  handleDelete: (caseId: string, caseName: string) => void;
}) {
  return (
    <Card className="group hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 border-l-4 border-l-transparent hover:border-l-primary/50 bg-gradient-to-r from-card to-card/50">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-lg font-semibold group-hover:text-primary transition-colors">{case_.title}</h3>
              <Badge 
                variant={getStatusColor(case_.status)}
                className="shadow-sm font-medium px-3 py-1 text-xs"
              >
                {getStatusText(case_.status, case_)}
              </Badge>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground/80">
              <div className="flex items-center gap-2 bg-muted/30 px-3 py-1.5 rounded-full">
                <User className="h-4 w-4 text-primary" />
                <span className="font-medium">{case_.clientName}</span>
              </div>
              <div className="flex items-center gap-2 bg-muted/30 px-3 py-1.5 rounded-full">
                <Calendar className="h-4 w-4 text-primary" />
                <span>{new Date(case_.createdAt).toLocaleDateString('nl-NL')}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/cases/${case_.id}`} asChild>
              <Button variant="default" size="sm" className="bg-primary hover:bg-primary/90 shadow-md" data-testid={`button-view-case-${case_.id}`}>
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
                    Weet je zeker dat je deze case wilt verwijderen? Je hebt 5 seconden om dit ongedaan te maken.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuleren</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleDelete(case_.id, case_.title)}
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
  const [pendingDeletion, setPendingDeletion] = useState<{ id: string; timeoutId: NodeJS.Timeout } | null>(null);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const { data: casesData, isLoading } = useQuery<CasesResponse>({
    queryKey: ["/api/cases", { page, search, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", "10");
      if (search) params.set("search", search);
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      
      // Use standard queryFn that handles API response format automatically
      const response = await fetch(`/api/cases?${params.toString()}`, {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Extract data from API response format with proper null checking
      if (data && typeof data === 'object' && 'success' in data && data.success === true) {
        if (data.data && typeof data.data === 'object') {
          return data.data;
        }
        throw new Error('Invalid API response format: missing data field');
      }
      
      // Validate fallback data structure
      if (data && typeof data === 'object' && 'reports' in data) {
        return data;
      }
      
      throw new Error('Invalid API response format');
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
        const filteredReports = old.reports.filter(case_ => case_.id !== deletedId);
        const newTotal = old.total - 1;
        const newTotalPages = Math.ceil(newTotal / 10);
        
        return {
          ...old,
          reports: filteredReports,
          total: newTotal,
          totalPages: newTotalPages
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
      // Only invalidate on error to refresh data
      queryClient.invalidateQueries({ 
        queryKey: ["/api/cases"],
        exact: false 
      });
    },
  });

  // Cleanup pending deletion on unmount
  useEffect(() => {
    return () => {
      if (pendingDeletion) {
        clearTimeout(pendingDeletion.timeoutId);
      }
    };
  }, [pendingDeletion]);

  // Auto-adjust page if current page exceeds total pages after deletion
  useEffect(() => {
    if (casesData && casesData.totalPages > 0 && page > casesData.totalPages) {
      setPage(casesData.totalPages);
    }
  }, [casesData, page]);

  const handleDelete = useCallback((caseId: string, caseName: string) => {
    // If there's already a pending deletion, cancel it
    if (pendingDeletion) {
      clearTimeout(pendingDeletion.timeoutId);
    }

    // Set up delayed deletion with undo option
    const timeoutId = setTimeout(() => {
      deleteCaseMutation.mutate(caseId);
      setPendingDeletion(null);
    }, 5000); // 5 second delay

    setPendingDeletion({ id: caseId, timeoutId });

    // Show toast with undo button
    const toastInstance = toast({
      title: "Case verwijderd",
      description: `"${caseName}" wordt over 5 seconden permanent verwijderd`,
      duration: 5000,
      action: (
        <ToastAction
          altText="Ongedaan maken"
          onClick={() => {
            clearTimeout(timeoutId);
            setPendingDeletion(null);
            toast({
              title: "Verwijdering geannuleerd",
              description: `"${caseName}" is behouden`,
              duration: 3000,
            });
          }}
        >
          Ongedaan maken
        </ToastAction>
      ),
    });
  }, [pendingDeletion, deleteCaseMutation, toast]);

  const getStatusColor = useCallback((status: string): "secondary" | "default" | "outline" | "destructive" | undefined => {
    switch (status) {
      case "draft": return "secondary";
      case "processing": return "default";
      case "generated": return "outline";
      case "exported": return "default";
      case "archived": return "secondary";
      default: return "secondary";
    }
  }, []);

  const getStatusText = useCallback((status: string, report?: any) => {
    switch (status) {
      case "draft": return "Concept";
      case "processing": 
      case "generated": {
        // Calculate progress based on completed stages for both processing and generated
        if (report?.stageResults) {
          const completedStages = Object.keys(report.stageResults).length;
          const totalStages = 10; // 10 workflow stages (removed 4d_DeVertaler, renamed 4f to 4f_HoofdCommunicatie)
          const percentage = Math.round((completedStages / totalStages) * 100);
          
          if (completedStages >= 3) {
            return `Stap ${completedStages}/10 (${percentage}%)`;
          } else if (completedStages > 0) {
            return `Wordt gegenereerd... ${completedStages}/10`;
          }
        }
        // Fallback for processing without stage results yet
        return status === "processing" ? "Bezig" : "Rapport Groeit";
      }
      case "exported": return "Voltooid";
      case "archived": return "Gearchiveerd";
      default: return status;
    }
  }, []);

  const handleExport = useCallback((caseId: string, format: string) => {
    window.open(`/api/cases/${caseId}/export/${format}`, '_blank');

    // Celebrate successful export
    celebrateExport(format as 'html' | 'json');

    toast({
      title: "Export gestart",
      description: `Case wordt geëxporteerd als ${format.toUpperCase()}`,
      duration: 3000,
    });
  }, [toast]);

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
                <Link href="/pipeline" className="text-muted-foreground hover:text-foreground" data-testid="nav-pipeline">
                  Pipeline
                </Link>
                <Link href="/cases" className="text-primary font-medium" data-testid="nav-cases">
                  Cases
                </Link>
                <Link href="/assistant" className="text-muted-foreground hover:text-foreground" data-testid="nav-assistant">
                  Assistent
                </Link>
                <Link href="/text-styler" className="text-muted-foreground hover:text-foreground" data-testid="nav-text-styler">
                  Text Styler
                </Link>
                <Link href="/settings" className="text-muted-foreground hover:text-foreground" data-testid="nav-settings">
                  Instellingen
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <DarkModeToggle />
              <Link href="/batch" asChild>
                <Button variant="outline" data-testid="button-batch-processing">
                  <Package className="mr-2 h-4 w-4" />
                  Batch
                </Button>
              </Link>
              <Link href="/pipeline" asChild>
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
                      <Link href="/pipeline" className="text-muted-foreground hover:text-foreground p-2 rounded-md" data-testid="nav-mobile-pipeline">
                        Pipeline
                      </Link>
                      <Link href="/cases" className="text-primary font-medium p-2 rounded-md" data-testid="nav-mobile-cases">
                        Cases
                      </Link>
                      <Link href="/assistant" className="text-muted-foreground hover:text-foreground p-2 rounded-md" data-testid="nav-mobile-assistant">
                        Assistent
                      </Link>
                      <Link href="/text-styler" className="text-muted-foreground hover:text-foreground p-2 rounded-md" data-testid="nav-mobile-text-styler">
                        Text Styler
                      </Link>
                      <Link href="/batch" className="text-muted-foreground hover:text-foreground p-2 rounded-md" data-testid="nav-mobile-batch">
                        Batch Verwerking
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
                  aria-label="Zoek cases op klantnaam of titel"
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
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="h-6 bg-muted rounded w-48"></div>
                        <div className="h-6 bg-muted rounded w-20"></div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="h-4 bg-muted rounded-full w-32"></div>
                        <div className="h-4 bg-muted rounded-full w-24"></div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-8 bg-muted rounded w-20"></div>
                      <div className="h-8 bg-muted rounded w-16"></div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : cases.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={search || statusFilter ? Search : FileText}
                title={search || statusFilter ? "Geen cases gevonden" : "Nog geen cases"}
                description={search || statusFilter ? "Geen cases gevonden die voldoen aan je filters. Probeer een andere zoekopdracht of filter." : "Je hebt nog geen cases aangemaakt. Maak je eerste case aan om te beginnen."}
                action={{
                  label: "Nieuwe Case Aanmaken",
                  onClick: () => window.location.href = "/pipeline"
                }}
              />
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/cases/${case_.id}`} asChild>
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
                              Weet je zeker dat je deze case wilt verwijderen? Je hebt 5 seconden om dit ongedaan te maken.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuleren</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(case_.id, case_.title)}
                              disabled={deleteCaseMutation.isPending}
                              data-testid={`button-confirm-delete-${case_.id}`}
                            >
                              {deleteCaseMutation.isPending ? "Verwijderen..." : "Verwijderen"}
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
