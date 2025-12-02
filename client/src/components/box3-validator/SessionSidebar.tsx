/**
 * SessionSidebar Component
 *
 * Displays recent sessions with load/delete functionality.
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";
import type { SessionLight } from "@/types/box3Validator.types";

interface SessionSidebarProps {
  sessions: SessionLight[] | undefined;
  currentSessionId: string | null;
  onLoadSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string, e: React.MouseEvent) => void;
}

export const SessionSidebar = memo(function SessionSidebar({
  sessions,
  currentSessionId,
  onLoadSession,
  onDeleteSession,
}: SessionSidebarProps) {
  return (
    <div className="w-80 flex-shrink-0">
      <Card className="sticky top-8">
        <CardHeader>
          <CardTitle className="text-base flex items-center">
            <Clock className="h-4 w-4 mr-2" />
            Recente Sessies
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            {sessions && sessions.length > 0 ? (
              <div className="divide-y">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => onLoadSession(session.id)}
                    className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                      currentSessionId === session.id ? "bg-primary/10" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm truncate">
                        {session.clientName}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => onDeleteSession(session.id, e)}
                        className="h-6 w-6 p-0"
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {session.belastingjaar && (
                        <Badge variant="outline" className="text-xs">
                          {session.belastingjaar}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {session.attachmentCount} bijlage(s)
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(session.createdAt), {
                        addSuffix: true,
                        locale: nl,
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-muted-foreground text-sm">
                Nog geen sessies opgeslagen
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
});
