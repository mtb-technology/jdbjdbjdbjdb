import { useState, useEffect, useCallback, useMemo, memo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ToastAction } from "@/components/ui/toast";
import { Search, FileText, Calendar, User, Download, Trash2, Eye, Copy, Package, Loader2, Upload } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AppHeader } from "@/components/app-header";
import { celebrateExport } from "@/lib/confetti";
import { EmptyState } from "@/components/ui/empty-state";
import { WORKFLOW_STAGES } from "@/components/workflow/constants";
import { countCompletedStages } from "@/utils/workflowUtils";
import { useAllActiveJobs } from "@/hooks/useJobPolling";

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
const CaseItem = memo(function CaseItem({ case_, getStatusColor, getStatusText, handleExport, handleDuplicate, handleDelete }: {
  case_: Case;
  getStatusColor: (status: string) => "secondary" | "default" | "outline" | "destructive" | undefined;
  getStatusText: (status: string, report?: any) => string;
  handleExport: (caseId: string, format: string) => void;
  handleDuplicate: (caseId: string) => void;
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDuplicate(case_.id)}
              data-testid={`button-duplicate-${case_.id}`}
            >
              <Copy className="h-4 w-4 mr-2" />
              Dupliceren
            </Button>
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
  const [pendingDeletions, setPendingDeletions] = useState<Map<string, NodeJS.Timeout>>(new Map());
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasActiveJobForReport, byReport } = useAllActiveJobs();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const importCaseMutation = useMutation({
    mutationFn: async (jsonData: unknown) => {
      const response = await apiRequest("POST", "/api/reports/import-json", jsonData);
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(text.substring(0, 100));
      }
    },
    onSuccess: (data) => {
      // Force refetch all cases queries
      queryClient.invalidateQueries({
        queryKey: ["/api/cases"],
        refetchType: 'all'
      });
      const result = data?.data || data;
      toast({
        title: "Case geïmporteerd",
        description: `Case succesvol geïmporteerd als ${result?.title || 'nieuwe case'}`,
        duration: 5000,
      });
    },
    onError: (error: any) => {
      // Extract user-friendly message from AppError or use default
      const message = error?.userMessage || error?.message || "Er ging iets mis bij het importeren";
      toast({
        title: "Import mislukt",
        description: message,
        variant: "destructive",
        duration: 5000,
      });
    }
  });

  const duplicateCaseMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/reports/${id}/duplicate`, {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/cases"],
        refetchType: 'all'
      });
      const result = data?.data || data;
      toast({
        title: "Case gedupliceerd",
        description: `Kopie aangemaakt: ${result?.title || 'nieuwe case'}`,
        duration: 5000,
      });
    },
    onError: (error: any) => {
      const message = error?.userMessage || error?.message || "Er ging iets mis bij het dupliceren";
      toast({
        title: "Dupliceren mislukt",
        description: message,
        variant: "destructive",
        duration: 5000,
      });
    }
  });

  const handleDuplicate = useCallback((caseId: string) => {
    duplicateCaseMutation.mutate(caseId);
  }, [duplicateCaseMutation]);

  const handleImportFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const jsonData = JSON.parse(e.target?.result as string);
        importCaseMutation.mutate(jsonData);
      } catch {
        toast({
          title: "Ongeldig bestand",
          description: "Het bestand bevat geen geldige JSON",
          variant: "destructive",
          duration: 5000,
        });
      }
    };
    reader.readAsText(file);

    // Reset input zodat hetzelfde bestand opnieuw gekozen kan worden
    event.target.value = '';
  }, [importCaseMutation, toast]);

  // Cleanup pending deletions on unmount
  useEffect(() => {
    return () => {
      pendingDeletions.forEach((timeoutId) => clearTimeout(timeoutId));
    };
  }, [pendingDeletions]);

  // Auto-adjust page if current page exceeds total pages after deletion
  useEffect(() => {
    if (casesData && casesData.totalPages > 0 && page > casesData.totalPages) {
      setPage(casesData.totalPages);
    }
  }, [casesData, page]);

  const handleDelete = useCallback((caseId: string, caseName: string) => {
    // If this case already has a pending deletion, don't create another
    if (pendingDeletions.has(caseId)) {
      return;
    }

    // Set up delayed deletion with undo option
    const timeoutId = setTimeout(() => {
      deleteCaseMutation.mutate(caseId);
      setPendingDeletions(prev => {
        const next = new Map(prev);
        next.delete(caseId);
        return next;
      });
    }, 5000); // 5 second delay

    setPendingDeletions(prev => new Map(prev).set(caseId, timeoutId));

    // Show toast with undo button
    toast({
      title: "Case verwijderd",
      description: `"${caseName}" wordt over 5 seconden permanent verwijderd`,
      duration: 5000,
      action: (
        <ToastAction
          altText="Ongedaan maken"
          onClick={() => {
            clearTimeout(timeoutId);
            setPendingDeletions(prev => {
              const next = new Map(prev);
              next.delete(caseId);
              return next;
            });
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
  }, [pendingDeletions, deleteCaseMutation, toast]);

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
        // Use WORKFLOW_STAGES (8 steps) instead of STAGE_ORDER (9 steps with 1b)
        if (report?.stageResults) {
          const completedStages = countCompletedStages(
            report.stageResults,
            report.conceptReportVersions || {}
          );
          const totalStages = WORKFLOW_STAGES.length; // 8 UI stages (excludes 1b)
          const percentage = Math.round((completedStages / totalStages) * 100);

          if (completedStages >= 3) {
            return `Stap ${completedStages}/${totalStages} (${percentage}%)`;
          } else if (completedStages > 0) {
            return `Wordt gegenereerd... ${completedStages}/${totalStages}`;
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

      <AppHeader />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">

        {/* Page Header with Actions */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cases Overzicht</h1>
            <p className="text-muted-foreground">Beheer al je fiscale cases en rapporten</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
              data-testid="input-import-file"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importCaseMutation.isPending}
              data-testid="button-import-case"
            >
              {importCaseMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Import
            </Button>
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
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filters</CardTitle>
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
                        {hasActiveJobForReport(case_.id) && (
                          <Badge variant="default" className="bg-blue-500 hover:bg-blue-600 animate-pulse gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {byReport[case_.id]?.types.includes("express_mode") ? "Express Mode" : "Verwerking"} actief
                          </Badge>
                        )}
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDuplicate(case_.id)}
                        data-testid={`button-duplicate-${case_.id}`}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Dupliceren
                      </Button>
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
