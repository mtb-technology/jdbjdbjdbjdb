import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DocumentWithChanges } from '@/components/document/DocumentWithChanges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import type { TipTapContent, PendingChanges } from '@shared/document-types';

// Mock initial content for demo
const DEMO_DOCUMENT: TipTapContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Fiscaal Duidingsrapport' }],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '1. Inleiding' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Dit rapport behandelt de fiscale situatie van de klant met betrekking tot de BTW-aangifte en mogelijke aftrek van voorbelasting.',
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '2. Analyse' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Op basis van de verstrekte informatie kunnen we concluderen dat er sprake is van ondernemen voor de BTW. Dit betekent dat de klant recht heeft op aftrek van voorbelasting.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'De activiteiten vallen onder het normale tarief van 21%.',
        },
      ],
    },
  ],
};

export default function DocumentDemo() {
  const [reportId] = useState('demo-report-123');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch pending changes
  const { data: changesData, isLoading } = useQuery({
    queryKey: ['document-changes', reportId],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${reportId}/changes`);
      if (!res.ok) throw new Error('Failed to fetch changes');
      return res.json();
    },
    retry: false,
  });

  // Create mock changes mutation
  const createMockChangesMutation = useMutation({
    mutationFn: async (specialistId: string) => {
      const mockChanges = generateMockChanges(specialistId);
      const res = await fetch(`/api/documents/${reportId}/changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specialistId,
          changes: mockChanges,
        }),
      });
      if (!res.ok) throw new Error('Failed to create changes');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-changes', reportId] });
      toast({
        title: 'Wijzigingen aangemaakt',
        description: 'De specialist heeft wijzigingen voorgesteld',
      });
    },
  });

  // Accept change mutation
  const acceptChangeMutation = useMutation({
    mutationFn: async ({ changeId }: { changeId: string }) => {
      const res = await fetch(`/api/documents/${reportId}/changes/${changeId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' }),
      });
      if (!res.ok) throw new Error('Failed to accept change');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-changes', reportId] });
      toast({
        title: 'Wijziging geaccepteerd',
        description: 'De wijziging is goedgekeurd',
      });
    },
  });

  // Reject change mutation
  const rejectChangeMutation = useMutation({
    mutationFn: async ({ changeId }: { changeId: string }) => {
      const res = await fetch(`/api/documents/${reportId}/changes/${changeId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
      if (!res.ok) throw new Error('Failed to reject change');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-changes', reportId] });
      toast({
        title: 'Wijziging afgewezen',
        description: 'De wijziging is afgewezen',
      });
    },
  });

  // Accept all changes mutation
  const acceptAllChangesMutation = useMutation({
    mutationFn: async (specialistId: string) => {
      const res = await fetch(`/api/documents/${reportId}/specialists/${specialistId}/review-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' }),
      });
      if (!res.ok) throw new Error('Failed to accept all changes');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-changes', reportId] });
      toast({
        title: 'Alle wijzigingen geaccepteerd',
        description: 'Alle wijzigingen van deze specialist zijn goedgekeurd',
      });
    },
  });

  // Reject all changes mutation
  const rejectAllChangesMutation = useMutation({
    mutationFn: async (specialistId: string) => {
      const res = await fetch(`/api/documents/${reportId}/specialists/${specialistId}/review-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
      if (!res.ok) throw new Error('Failed to reject all changes');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-changes', reportId] });
      toast({
        title: 'Alle wijzigingen afgewezen',
        description: 'Alle wijzigingen van deze specialist zijn afgewezen',
      });
    },
  });

  const pendingChanges: PendingChanges = changesData?.data?.pendingChanges || {};

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>🚀 Living Document System - Demo</CardTitle>
          <CardDescription>
            Proof-of-concept van het nieuwe Google Docs-achtige document systeem met change tracking
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => createMockChangesMutation.mutate('4a_bronnen')}
              disabled={createMockChangesMutation.isPending}
            >
              📚 Simuleer Bronnen Specialist
            </Button>
            <Button
              onClick={() => createMockChangesMutation.mutate('4b_technisch')}
              disabled={createMockChangesMutation.isPending}
            >
              ⚖️ Simuleer Fiscaal-Technisch Specialist
            </Button>
            <Button
              onClick={() => createMockChangesMutation.mutate('4c_structuur')}
              disabled={createMockChangesMutation.isPending}
            >
              🏗️ Simuleer Structuur Specialist
            </Button>
          </div>
          <p className="text-sm text-gray-600">
            💡 Klik op een knop om voorgestelde wijzigingen van een specialist te simuleren
          </p>
        </CardContent>
      </Card>

      <DocumentWithChanges
        reportId={reportId}
        documentContent={DEMO_DOCUMENT}
        pendingChanges={pendingChanges}
        onAcceptChange={(specialistId, changeId) => acceptChangeMutation.mutateAsync({ changeId })}
        onRejectChange={(specialistId, changeId) => rejectChangeMutation.mutateAsync({ changeId })}
        onAcceptAllChanges={(specialistId) => acceptAllChangesMutation.mutateAsync(specialistId)}
        onRejectAllChanges={(specialistId) => rejectAllChangesMutation.mutateAsync(specialistId)}
      />
    </div>
  );
}

// Helper to generate realistic mock changes
function generateMockChanges(specialistId: string) {
  const changesBySpecialist: Record<string, any[]> = {
    '4a_bronnen': [
      {
        type: 'replace',
        position: 180,
        oldText: 'de verstrekte informatie',
        newText: 'de verstrekte documentatie en bronmateriaal uit de Belastingdienst database (art. 15 Wet OB)',
        comment: 'Toegevoegd: specifieke bronvermelding conform artikel 15 Wet op de Omzetbelasting 1968',
      },
      {
        type: 'insert',
        position: 320,
        newText: ' Zie ook: Belastingdienst besluit van 15 maart 2023, nr. 2023-12345.',
        comment: 'Bronvermelding toegevoegd voor onderbouwing',
      },
    ],
    '4b_technisch': [
      {
        type: 'replace',
        position: 250,
        oldText: 'ondernemen voor de BTW',
        newText: 'economische activiteit in de zin van artikel 7 Wet OB 1968',
        comment: 'Fiscaal-technische correctie: gebruik correcte terminologie uit de wet',
      },
      {
        type: 'replace',
        position: 350,
        oldText: 'normale tarief van 21%',
        newText: 'algemene tarief van 21% als bedoeld in artikel 9 lid 1 Wet OB 1968',
        comment: 'Precisering met wetelijke grondslag',
      },
    ],
    '4c_structuur': [
      {
        type: 'insert',
        position: 140,
        newText: '\n\n**1.1 Achtergrond**\n\nDe klant is een ondernemer die zich richt op...\n\n**1.2 Vraagstelling**\n\nDe centrale vraag luidt...\n\n',
        comment: 'Structuurverbetering: subkopjes toegevoegd voor betere leesbaarheid',
      },
    ],
  };

  return changesBySpecialist[specialistId] || [];
}
