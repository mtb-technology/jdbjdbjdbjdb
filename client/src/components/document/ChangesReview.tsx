import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import type { DocumentChange, SpecialistChanges } from '@shared/document-types';

interface ChangesReviewProps {
  specialistChanges: SpecialistChanges;
  onAcceptChange: (changeId: string) => void;
  onRejectChange: (changeId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

const SPECIALIST_COLORS: Record<string, string> = {
  '4a_bronnen': 'bg-blue-100 text-blue-800 border-blue-300',
  '4b_technisch': 'bg-purple-100 text-purple-800 border-purple-300',
  '4c_structuur': 'bg-green-100 text-green-800 border-green-300',
  '4d_toon': 'bg-orange-100 text-orange-800 border-orange-300',
  '4e_klant': 'bg-pink-100 text-pink-800 border-pink-300',
  '4f_juridisch': 'bg-red-100 text-red-800 border-red-300',
  '4g_volledigheid': 'bg-indigo-100 text-indigo-800 border-indigo-300',
};

const SPECIALIST_NAMES: Record<string, string> = {
  '4a_bronnen': 'Bronnen Specialist',
  '4b_technisch': 'Fiscaal-Technisch Specialist',
  '4c_structuur': 'Structuur Specialist',
  '4d_toon': 'Toon & Stijl Specialist',
  '4e_klant': 'Klantgerichte Specialist',
  '4f_juridisch': 'Juridisch Specialist',
  '4g_volledigheid': 'Volledigheid Specialist',
};

function getStatusIcon(status: DocumentChange['status']) {
  switch (status) {
    case 'accepted':
      return <CheckCircle2 className="w-5 h-5 text-green-600" />;
    case 'rejected':
      return <XCircle className="w-5 h-5 text-red-600" />;
    case 'applied':
      return <CheckCircle2 className="w-5 h-5 text-green-600" />;
    case 'pending':
      return <Clock className="w-5 h-5 text-yellow-600" />;
    default:
      return <AlertCircle className="w-5 h-5 text-gray-600" />;
  }
}

function getChangeTypeLabel(type: DocumentChange['type']) {
  switch (type) {
    case 'insert':
      return 'Toevoeging';
    case 'delete':
      return 'Verwijdering';
    case 'replace':
      return 'Wijziging';
    case 'comment':
      return 'Opmerking';
    default:
      return type;
  }
}

export function ChangesReview({
  specialistChanges,
  onAcceptChange,
  onRejectChange,
  onAcceptAll,
  onRejectAll,
}: ChangesReviewProps) {
  const pendingChanges = specialistChanges.changes.filter(c => c.status === 'pending');
  const appliedChanges = specialistChanges.changes.filter(c => c.status === 'applied' || c.status === 'accepted');
  const rejectedChanges = specialistChanges.changes.filter(c => c.status === 'rejected');

  const specialistColor = SPECIALIST_COLORS[specialistChanges.specialist] || 'bg-gray-100 text-gray-800';
  const specialistName = SPECIALIST_NAMES[specialistChanges.specialist] || specialistChanges.specialist;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Badge className={specialistColor}>{specialistName}</Badge>
              <span className="text-lg">Voorgestelde Wijzigingen</span>
            </CardTitle>
            <CardDescription className="mt-2">
              {pendingChanges.length} in afwachting • {appliedChanges.length} geaccepteerd • {rejectedChanges.length} afgewezen
            </CardDescription>
          </div>
          {pendingChanges.length > 0 && (
            <div className="flex gap-2">
              <Button onClick={onAcceptAll} variant="outline" size="sm">
                <CheckCircle2 className="w-4 h-4 mr-1" />
                Alles Accepteren
              </Button>
              <Button onClick={onRejectAll} variant="outline" size="sm">
                <XCircle className="w-4 h-4 mr-1" />
                Alles Afwijzen
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pending Changes */}
        {pendingChanges.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">
              Te Beoordelen ({pendingChanges.length})
            </h3>
            {pendingChanges.map((change) => (
              <ChangeItem
                key={change.id}
                change={change}
                onAccept={() => onAcceptChange(change.id)}
                onReject={() => onRejectChange(change.id)}
              />
            ))}
          </div>
        )}

        {/* Applied Changes */}
        {appliedChanges.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-green-700 uppercase tracking-wide">
              Geaccepteerd ({appliedChanges.length})
            </h3>
            {appliedChanges.map((change) => (
              <ChangeItem key={change.id} change={change} />
            ))}
          </div>
        )}

        {/* Rejected Changes */}
        {rejectedChanges.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-red-700 uppercase tracking-wide">
              Afgewezen ({rejectedChanges.length})
            </h3>
            {rejectedChanges.map((change) => (
              <ChangeItem key={change.id} change={change} />
            ))}
          </div>
        )}

        {specialistChanges.changes.length === 0 && (
          <p className="text-center text-gray-500 py-8">
            Geen wijzigingen voorgesteld door deze specialist.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface ChangeItemProps {
  change: DocumentChange;
  onAccept?: () => void;
  onReject?: () => void;
}

function ChangeItem({ change, onAccept, onReject }: ChangeItemProps) {
  const isPending = change.status === 'pending';

  return (
    <div className={`border rounded-lg p-4 ${isPending ? 'border-l-4 border-l-blue-500' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            {getStatusIcon(change.status)}
            <Badge variant="outline">{getChangeTypeLabel(change.type)}</Badge>
            <span className="text-xs text-gray-500">Positie: {change.position}</span>
          </div>

          {/* Comment/Reasoning */}
          <p className="text-sm text-gray-700 mb-3">{change.comment}</p>

          {/* Diff View */}
          {(change.oldText || change.newText) && (
            <div className="space-y-1 font-mono text-xs">
              {change.oldText && (
                <div className="bg-red-50 text-red-800 p-2 rounded border border-red-200">
                  <span className="font-bold">- </span>
                  {change.oldText}
                </div>
              )}
              {change.newText && (
                <div className="bg-green-50 text-green-800 p-2 rounded border border-green-200">
                  <span className="font-bold">+ </span>
                  {change.newText}
                </div>
              )}
            </div>
          )}

          {/* Timestamp */}
          <p className="text-xs text-gray-500 mt-2">
            {new Date(change.createdAt).toLocaleString('nl-NL')}
          </p>
        </div>

        {/* Action Buttons */}
        {isPending && onAccept && onReject && (
          <div className="flex flex-col gap-2">
            <Button onClick={onAccept} size="sm" className="bg-green-600 hover:bg-green-700">
              <CheckCircle2 className="w-4 h-4 mr-1" />
              Accepteren
            </Button>
            <Button onClick={onReject} size="sm" variant="outline">
              <XCircle className="w-4 h-4 mr-1" />
              Afwijzen
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
