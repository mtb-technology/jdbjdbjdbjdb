import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ToastAction } from "@/components/ui/toast";
import { Search, FileText, Calendar, User, Download, Trash2, Eye, Copy, Package, Loader2, Upload, ArrowUpDown, CheckCircle2, Clock, PlayCircle, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
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
  // Required for progress calculation
  stageResults?: Record<string, unknown> | null;
  conceptReportVersions?: Record<string, unknown> | null;
}

interface CasesResponse {
  reports: Case[];
  total: number;
  page: number;
  totalPages: number;
}

type SortOption = "date-desc" | "date-asc" | "progress-desc" | "progress-asc" | "name-asc" | "name-desc";

type ProgressFilter = "all" | "not-started" | "in-progress" | "complete";

function Cases() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("date-desc");
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

      // Store all previous cache states for rollback
      const previousCacheStates: Array<{ queryKey: unknown[]; data: unknown }> = [];

      // Update ALL cached /api/cases queries, not just the current filter
      // This prevents race conditions when deleting multiple cases quickly
      queryClient.setQueriesData<CasesResponse>(
        { queryKey: ["/api/cases"] },
        (old) => {
          if (!old) return old;

          // Store previous state for potential rollback
          // Note: queryKey is captured per-query by React Query internally

          const filteredReports = old.reports.filter(case_ => case_.id !== deletedId);

          // Only update if this query contained the deleted item
          if (filteredReports.length === old.reports.length) {
            return old; // No change needed
          }

          const newTotal = old.total - 1;
          const newTotalPages = Math.ceil(newTotal / 10);

          return {
            ...old,
            reports: filteredReports,
            total: newTotal,
            totalPages: newTotalPages
          };
        }
      );

      // Return deleted ID for potential rollback via invalidation
      return { deletedId };
    },
    onError: (_err, _deletedId, _context) => {
      // On error, invalidate all case queries to refetch fresh data
      // This is simpler and more reliable than trying to restore individual cache states
      queryClient.invalidateQueries({
        queryKey: ["/api/cases"],
        exact: false
      });
    },
    onSuccess: () => {
      // Optionally refetch to ensure server state is in sync
      // This handles edge cases where optimistic update might differ from server
      queryClient.invalidateQueries({
        queryKey: ["/api/cases"],
        exact: false,
        refetchType: 'none' // Don't refetch immediately, let stale time handle it
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

  const getProgressInfo = useCallback((report?: any): {
    completed: number;
    total: number;
    percentage: number;
    status: "not-started" | "in-progress" | "complete";
    statusLabel: string;
  } => {
    const totalStages = WORKFLOW_STAGES.length; // 8 UI stages
    let completedStages = 0;

    if (report?.stageResults) {
      completedStages = countCompletedStages(
        report.stageResults,
        report.conceptReportVersions || {}
      );
    }

    const percentage = Math.round((completedStages / totalStages) * 100);

    let status: "not-started" | "in-progress" | "complete" = "not-started";
    let statusLabel = "Niet gestart";

    if (completedStages === totalStages) {
      status = "complete";
      statusLabel = "Voltooid";
    } else if (completedStages > 0) {
      status = "in-progress";
      statusLabel = `${completedStages} van ${totalStages}`;
    }

    return {
      completed: completedStages,
      total: totalStages,
      percentage,
      status,
      statusLabel
    };
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

  // Calculate progress counts for filter chips
  const progressCounts = useMemo(() => {
    const reports = casesData?.reports || [];
    const counts = { all: reports.length, "not-started": 0, "in-progress": 0, complete: 0 };

    for (const report of reports) {
      const progress = getProgressInfo(report);
      counts[progress.status]++;
    }

    return counts;
  }, [casesData?.reports, getProgressInfo]);

  // Filter and sort cases
  const cases = useMemo(() => {
    const reports = casesData?.reports || [];

    // Apply progress filter
    const filtered = progressFilter === "all"
      ? reports
      : reports.filter(report => getProgressInfo(report).status === progressFilter);

    // Sort
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "date-desc":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "date-asc":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "progress-desc": {
          const progressA = getProgressInfo(a).percentage;
          const progressB = getProgressInfo(b).percentage;
          return progressB - progressA;
        }
        case "progress-asc": {
          const progressA = getProgressInfo(a).percentage;
          const progressB = getProgressInfo(b).percentage;
          return progressA - progressB;
        }
        case "name-asc":
          return (a.clientName || "").localeCompare(b.clientName || "");
        case "name-desc":
          return (b.clientName || "").localeCompare(a.clientName || "");
        default:
          return 0;
      }
    });
  }, [casesData?.reports, sortBy, progressFilter, getProgressInfo]);


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

        {/* Quick Filter Chips */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            onClick={() => setProgressFilter("all")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-full transition-colors",
              progressFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            Alle ({progressCounts.all})
          </button>
          <button
            onClick={() => setProgressFilter("in-progress")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-full transition-colors",
              progressFilter === "in-progress"
                ? "bg-amber-500 text-white"
                : "bg-amber-100 text-amber-700 hover:bg-amber-200"
            )}
          >
            Bezig ({progressCounts["in-progress"]})
          </button>
          <button
            onClick={() => setProgressFilter("complete")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-full transition-colors",
              progressFilter === "complete"
                ? "bg-emerald-500 text-white"
                : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
            )}
          >
            Voltooid ({progressCounts.complete})
          </button>
          <button
            onClick={() => setProgressFilter("not-started")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-full transition-colors",
              progressFilter === "not-started"
                ? "bg-gray-500 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            )}
          >
            Niet gestart ({progressCounts["not-started"]})
          </button>

        </div>

        {/* Search & Sort */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Zoek op klantnaam of titel..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              data-testid="input-search-cases"
              aria-label="Zoek cases op klantnaam of titel"
            />
          </div>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
            <SelectTrigger className="w-full sm:w-44" data-testid="select-sort">
              <ArrowUpDown className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Sorteren" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date-desc">Nieuwste eerst</SelectItem>
              <SelectItem value="date-asc">Oudste eerst</SelectItem>
              <SelectItem value="progress-desc">Meeste voortgang</SelectItem>
              <SelectItem value="progress-asc">Minste voortgang</SelectItem>
              <SelectItem value="name-asc">Naam A-Z</SelectItem>
              <SelectItem value="name-desc">Naam Z-A</SelectItem>
            </SelectContent>
          </Select>
        </div>

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
          <div className="space-y-2">
            {cases.map((case_: Case) => {
              const progress = getProgressInfo(case_);
              const isActive = hasActiveJobForReport(case_.id);

              return (
                <Card
                  key={case_.id}
                  className="group hover:shadow-md hover:border-primary/30 transition-all duration-200 cursor-pointer"
                >
                  <Link href={`/cases/${case_.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        {/* Status Icon */}
                        <div className="flex-shrink-0">
                          {isActive ? (
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <Loader2 className="h-5 w-5 text-primary animate-spin" />
                            </div>
                          ) : progress.status === "complete" ? (
                            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            </div>
                          ) : progress.status === "in-progress" ? (
                            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                              <Clock className="h-5 w-5 text-amber-600" />
                            </div>
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                              <PlayCircle className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                        </div>

                        {/* Main Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-sm truncate">{case_.title}</h3>
                            {isActive && (
                              <Badge variant="default" className="bg-primary/90 text-xs px-1.5 py-0">
                                {byReport[case_.id]?.types.includes("express_mode") ? "Express" : "Bezig"}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {case_.clientName}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(case_.createdAt).toLocaleDateString('nl-NL')}
                            </span>
                          </div>
                        </div>

                        {/* Progress Section */}
                        <div className="flex-shrink-0 w-28 hidden sm:block">
                          <div className="flex items-center justify-end text-xs mb-1">
                            <span className={cn(
                              "font-medium",
                              progress.status === "complete" ? "text-emerald-600" :
                              progress.status === "in-progress" ? "text-amber-600" :
                              "text-muted-foreground"
                            )}>
                              {progress.statusLabel}
                            </span>
                          </div>
                          <Progress
                            value={progress.percentage}
                            className={cn(
                              "h-1.5",
                              progress.status === "complete" && "[&>div]:bg-emerald-500",
                              progress.status === "in-progress" && "[&>div]:bg-amber-500"
                            )}
                          />
                        </div>

                        {/* Actions Menu - Always visible for touch support */}
                        <div className="flex-shrink-0" onClick={(e) => e.preventDefault()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDuplicate(case_.id);
                                }}
                              >
                                <Copy className="h-4 w-4 mr-2" />
                                Dupliceren
                              </DropdownMenuItem>
                              {case_.status === "generated" && (
                                <>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleExport(case_.id, "html");
                                    }}
                                  >
                                    <Download className="h-4 w-4 mr-2" />
                                    Export HTML
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleExport(case_.id, "json");
                                    }}
                                  >
                                    <Download className="h-4 w-4 mr-2" />
                                    Export JSON
                                  </DropdownMenuItem>
                                </>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(case_.id, case_.title);
                                }}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Verwijderen
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </CardContent>
                  </Link>
                </Card>
              );
            })}

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
}

export default Cases;
