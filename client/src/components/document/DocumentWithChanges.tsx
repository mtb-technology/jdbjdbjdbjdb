import { useState } from 'react';
import { DocumentEditor } from './DocumentEditor';
import { ChangesReview } from './ChangesReview';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { TipTapContent, PendingChanges, SpecialistChanges } from '@shared/document-types';

interface DocumentWithChangesProps {
  reportId: string;
  documentContent: TipTapContent | string;
  pendingChanges: PendingChanges;
  onAcceptChange: (specialistId: string, changeId: string) => Promise<void>;
  onRejectChange: (specialistId: string, changeId: string) => Promise<void>;
  onAcceptAllChanges: (specialistId: string) => Promise<void>;
  onRejectAllChanges: (specialistId: string) => Promise<void>;
  readOnly?: boolean;
}

export function DocumentWithChanges({
  reportId,
  documentContent,
  pendingChanges,
  onAcceptChange,
  onRejectChange,
  onAcceptAllChanges,
  onRejectAllChanges,
  readOnly = false,
}: DocumentWithChangesProps) {
  const [activeTab, setActiveTab] = useState<'document' | 'changes'>('document');

  // Get all specialists with pending changes
  const specialistsWithChanges = Object.values(pendingChanges).filter(
    sc => sc.changes && sc.changes.length > 0
  );

  const totalPendingChanges = specialistsWithChanges.reduce(
    (sum, sc) => sum + sc.changes.filter(c => c.status === 'pending').length,
    0
  );

  // Calculate highlighted ranges for changes
  const highlightedRanges = specialistsWithChanges.flatMap(sc =>
    sc.changes
      .filter(c => c.status === 'pending')
      .map(c => ({
        from: c.position,
        to: c.position + (c.oldText?.length || 0),
        color: getSpecialistColor(sc.specialist),
        specialist: sc.specialist,
      }))
  );

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'document' | 'changes')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="document">
            📄 Document
          </TabsTrigger>
          <TabsTrigger value="changes">
            🔍 Voorgestelde Wijzigingen
            {totalPendingChanges > 0 && (
              <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                {totalPendingChanges}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="document" className="mt-4">
          <div className="border rounded-lg overflow-hidden">
            <DocumentEditor
              content={documentContent}
              readOnly={readOnly}
              highlightedRanges={highlightedRanges}
              placeholder="Het rapport wordt gegenereerd door de AI specialist..."
            />
          </div>
          {highlightedRanges.length > 0 && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                💡 <strong>Tip:</strong> Gemarkeerde tekst heeft voorgestelde wijzigingen. 
                Ga naar het "Voorgestelde Wijzigingen" tabblad om deze te bekijken en goed te keuren.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="changes" className="mt-4 space-y-4">
          {specialistsWithChanges.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">Geen voorgestelde wijzigingen</p>
              <p className="text-sm mt-2">
                Specialists hebben nog geen wijzigingen voorgesteld voor dit document.
              </p>
            </div>
          ) : (
            <>
              {specialistsWithChanges.map((specialistChanges) => (
                <ChangesReview
                  key={specialistChanges.specialist}
                  specialistChanges={specialistChanges}
                  onAcceptChange={(changeId) => onAcceptChange(specialistChanges.specialist, changeId)}
                  onRejectChange={(changeId) => onRejectChange(specialistChanges.specialist, changeId)}
                  onAcceptAll={() => onAcceptAllChanges(specialistChanges.specialist)}
                  onRejectAll={() => onRejectAllChanges(specialistChanges.specialist)}
                />
              ))}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Helper function to get specialist-specific colors
function getSpecialistColor(specialistId: string): string {
  const colors: Record<string, string> = {
    '4a_bronnen': '#3B82F6',      // blue
    '4b_technisch': '#8B5CF6',    // purple
    '4c_structuur': '#10B981',    // green
    '4d_toon': '#F59E0B',         // orange
    '4e_klant': '#EC4899',        // pink
    '4f_juridisch': '#EF4444',    // red
    '4g_volledigheid': '#6366F1', // indigo
  };
  return colors[specialistId] || '#6B7280'; // gray fallback
}
