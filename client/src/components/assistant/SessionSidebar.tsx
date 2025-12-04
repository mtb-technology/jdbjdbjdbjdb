import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Clock, Trash2, FolderOpen, AlertCircle, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";
import type { FollowUpSession } from "@shared/schema";

interface SessionSidebarProps {
  onLoadSession: (session: FollowUpSession) => void;
  currentSessionId?: string;
}

export const SessionSidebar = memo(function SessionSidebar({
  onLoadSession,
  currentSessionId,
}: SessionSidebarProps) {
  // Fetch all sessions
  const { data: sessions = [], isLoading, isError, refetch } = useQuery<FollowUpSession[]>({
    queryKey: ["/api/follow-up/sessions"],
    refetchInterval: 30000,
    retry: 2,
    staleTime: 60000, // Cache for 1 minute
  });

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent loading the session when clicking delete

    if (!confirm("Weet je zeker dat je deze sessie wilt verwijderen?")) {
      return;
    }

    try {
      const response = await fetch(`/api/follow-up/sessions/${sessionId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete session");
      }

      // Refresh the sessions list
      refetch();
    } catch (error) {
      console.error("Delete session failed:", error);
      alert("Kon sessie niet verwijderen. Probeer het opnieuw.");
    }
  };

  const formatDate = (dateString: string | Date | null | undefined) => {
    if (!dateString) return "Onbekend";

    try {
      return formatDistanceToNow(new Date(dateString), {
        addSuffix: true,
        locale: nl,
      });
    } catch (error) {
      return "Onbekend";
    }
  };

  if (isLoading) {
    return (
      <Card className="w-80 h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            Sessies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="w-80 h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            Sessies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
            <AlertCircle className="h-8 w-8 text-destructive mb-2" />
            <p>Kon sessies niet laden</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="mt-3"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Opnieuw proberen
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-80 h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FolderOpen className="h-4 w-4" />
          Sessies ({sessions.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full px-6 pb-6">
          {sessions.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <p>Nog geen sessies opgeslagen</p>
              <p className="text-xs mt-2">
                Klik op "Bewaar Sessie" om te beginnen
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => {
                const isActive = session.id === currentSessionId;

                return (
                  <div
                    key={session.id}
                    onClick={() => onLoadSession(session)}
                    className={`
                      group relative p-3 rounded-lg border cursor-pointer
                      transition-all hover:shadow-md
                      ${isActive ? "bg-primary/5 border-primary" : "bg-card hover:bg-accent"}
                    `}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium truncate">
                          {session.clientName}
                        </h4>
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{formatDate(session.createdAt)}</span>
                        </div>
                        {session.caseId && (
                          <Badge variant="outline" className="mt-2 text-xs">
                            Case: {session.caseId.substring(0, 8)}
                          </Badge>
                        )}
                      </div>

                      <Button
                        onClick={(e) => handleDeleteSession(session.id, e)}
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>

                    {isActive && (
                      <Badge className="absolute -top-2 -right-2 text-xs">
                        Actief
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
});
