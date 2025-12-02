/**
 * useBox3Sessions Hook
 *
 * Session management for Box 3 Validator.
 * Handles fetching, loading, and deleting sessions.
 */

import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { Box3ValidatorSession } from "@shared/schema";
import type { SessionLight } from "@/types/box3Validator.types";

interface UseBox3SessionsReturn {
  sessions: SessionLight[] | undefined;
  refetchSessions: () => void;
  loadSession: (sessionId: string) => Promise<Box3ValidatorSession | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;
}

export function useBox3Sessions(): UseBox3SessionsReturn {
  const { toast } = useToast();

  // Fetch sessions list
  const { data: sessions, refetch: refetchSessions } = useQuery<SessionLight[]>({
    queryKey: ["box3-validator-sessions"],
    queryFn: async () => {
      const res = await fetch("/api/box3-validator/sessions");
      const data = await res.json();
      return data.success ? data.data : [];
    },
    refetchInterval: 30000,
  });

  // Load a specific session
  const loadSession = async (
    sessionId: string
  ): Promise<Box3ValidatorSession | null> => {
    try {
      const res = await fetch(`/api/box3-validator/sessions/${sessionId}`);
      if (!res.ok) throw new Error("Failed to load session");

      const data = await res.json();
      const session: Box3ValidatorSession = data.success ? data.data : data;

      toast({
        title: "Sessie geladen",
        description: `Sessie voor ${session.clientName} is geladen.`,
      });

      return session;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Laden mislukt",
        description: message,
        variant: "destructive",
      });
      return null;
    }
  };

  // Delete a session
  const deleteSession = async (sessionId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/box3-validator/sessions/${sessionId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete session");

      toast({
        title: "Sessie verwijderd",
        description: "De sessie is succesvol verwijderd.",
      });

      refetchSessions();
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Verwijderen mislukt",
        description: message,
        variant: "destructive",
      });
      return false;
    }
  };

  return {
    sessions,
    refetchSessions,
    loadSession,
    deleteSession,
  };
}
