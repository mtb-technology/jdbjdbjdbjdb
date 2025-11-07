import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface FeedbackItem {
  bevinding_categorie?: string;
  instructie?: string;
  priority?: string;
  type?: string;
  [key: string]: any;
}

interface ReviewerFeedbackViewerProps {
  stageKey: string;
  stageName: string;
  rawOutput: string;
  className?: string;
}

/**
 * Component voor het weergeven van gestructureerde reviewer feedback (4a-4g stappen)
 * Parse en visualiseer JSON feedback van validators in een gebruiksvriendelijke manier
 */
export function ReviewerFeedbackViewer({
  stageKey,
  stageName,
  rawOutput,
  className
}: ReviewerFeedbackViewerProps) {
  // Probeer de JSON feedback te parsen
  const parsedFeedback = parseReviewerFeedback(rawOutput);

  if (!parsedFeedback) {
    // Als parsing faalt, toon de raw output
    return (
      <Card className={cn("border-gray-200", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-500" />
            {stageName} - Raw Output
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs whitespace-pre-wrap text-gray-600 bg-gray-50 p-3 rounded">
            {rawOutput}
          </pre>
        </CardContent>
      </Card>
    );
  }

  // Categoriseer feedback items
  const { critical, warnings, info, suggestions } = categorizeFeedback(parsedFeedback);
  const totalItems = parsedFeedback.length;
  const hasIssues = critical.length > 0 || warnings.length > 0;

  return (
    <Card className={cn("border-gray-200", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            {hasIssues ? (
              <AlertCircle className="h-4 w-4 text-orange-500" />
            ) : (
              <CheckCircle className="h-4 w-4 text-green-500" />
            )}
            {stageName} Feedback
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {totalItems} bevinding{totalItems !== 1 ? 'en' : ''}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Samenvatting */}
        <div className="flex gap-2 text-xs">
          {critical.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              {critical.length} Critical
            </Badge>
          )}
          {warnings.length > 0 && (
            <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800">
              {warnings.length} Warning{warnings.length !== 1 ? 's' : ''}
            </Badge>
          )}
          {suggestions.length > 0 && (
            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
              {suggestions.length} Suggestie{suggestions.length !== 1 ? 's' : ''}
            </Badge>
          )}
          {info.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {info.length} Info
            </Badge>
          )}
        </div>

        {/* Critical Items */}
        {critical.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-red-700 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Kritieke Bevindingen
            </h4>
            {critical.map((item, idx) => (
              <FeedbackItemCard key={idx} item={item} variant="critical" />
            ))}
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-orange-700 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Waarschuwingen
            </h4>
            {warnings.map((item, idx) => (
              <FeedbackItemCard key={idx} item={item} variant="warning" />
            ))}
          </div>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-blue-700 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Suggesties
            </h4>
            {suggestions.map((item, idx) => (
              <FeedbackItemCard key={idx} item={item} variant="suggestion" />
            ))}
          </div>
        )}

        {/* Info Items */}
        {info.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Informatie
            </h4>
            {info.map((item, idx) => (
              <FeedbackItemCard key={idx} item={item} variant="info" />
            ))}
          </div>
        )}

        {/* Geen bevindingen */}
        {totalItems === 0 && (
          <div className="text-center py-4 text-sm text-gray-500">
            <CheckCircle className="h-6 w-6 mx-auto mb-2 text-green-500" />
            Geen bevindingen - alles ziet er goed uit!
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface FeedbackItemCardProps {
  item: FeedbackItem;
  variant: 'critical' | 'warning' | 'suggestion' | 'info';
}

function FeedbackItemCard({ item, variant }: FeedbackItemCardProps) {
  const variantStyles = {
    critical: {
      bg: "bg-red-50 border-red-200",
      text: "text-red-900",
      badge: "bg-red-100 text-red-800"
    },
    warning: {
      bg: "bg-orange-50 border-orange-200",
      text: "text-orange-900",
      badge: "bg-orange-100 text-orange-800"
    },
    suggestion: {
      bg: "bg-blue-50 border-blue-200",
      text: "text-blue-900",
      badge: "bg-blue-100 text-blue-800"
    },
    info: {
      bg: "bg-gray-50 border-gray-200",
      text: "text-gray-900",
      badge: "bg-gray-100 text-gray-800"
    }
  };

  const styles = variantStyles[variant];

  return (
    <div className={cn("p-3 rounded-lg border", styles.bg)}>
      <div className="flex items-start justify-between gap-2 mb-1">
        {item.bevinding_categorie && (
          <Badge variant="outline" className={cn("text-xs", styles.badge)}>
            {item.bevinding_categorie}
          </Badge>
        )}
        {item.priority && (
          <span className={cn("text-xs font-medium", styles.text)}>
            Prioriteit: {item.priority}
          </span>
        )}
      </div>
      {item.instructie && (
        <p className={cn("text-xs mt-2", styles.text)}>
          {item.instructie}
        </p>
      )}

      {/* Extra velden die mogelijk aanwezig zijn */}
      {Object.entries(item)
        .filter(([key]) => !['bevinding_categorie', 'instructie', 'priority', 'type'].includes(key))
        .map(([key, value]) => (
          <div key={key} className="mt-2 text-xs">
            <span className="font-medium">{formatFieldName(key)}:</span>{' '}
            <span className="text-gray-700">{String(value)}</span>
          </div>
        ))}
    </div>
  );
}

/**
 * Parse reviewer feedback JSON
 * Ondersteunt verschillende formaten:
 * - Array van feedback objecten
 * - Enkel feedback object
 * - JSON string
 */
function parseReviewerFeedback(rawOutput: string): FeedbackItem[] | null {
  if (!rawOutput || typeof rawOutput !== 'string') {
    return null;
  }

  try {
    // Probeer direct te parsen
    const parsed = JSON.parse(rawOutput);

    // Als het een array is, return het
    if (Array.isArray(parsed)) {
      return parsed;
    }

    // Als het een object is met een feedback array property
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.feedback)) {
        return parsed.feedback;
      }
      if (Array.isArray(parsed.bevindingen)) {
        return parsed.bevindingen;
      }
      if (Array.isArray(parsed.items)) {
        return parsed.items;
      }
      // Als het een enkel feedback object is, wrap het in een array
      if (parsed.bevinding_categorie || parsed.instructie) {
        return [parsed];
      }
    }

    return null;
  } catch (error) {
    // Als JSON parsing faalt, probeer te zoeken naar JSON in de tekst
    const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (e) {
        // Ignore
      }
    }

    return null;
  }
}

/**
 * Categoriseer feedback items op basis van type/priority
 */
function categorizeFeedback(items: FeedbackItem[]) {
  const critical: FeedbackItem[] = [];
  const warnings: FeedbackItem[] = [];
  const info: FeedbackItem[] = [];
  const suggestions: FeedbackItem[] = [];

  items.forEach(item => {
    // Categoriseer op basis van type, priority of bevinding_categorie
    const type = (item.type || item.priority || item.bevinding_categorie || '').toLowerCase();

    if (type.includes('critical') || type.includes('error') || type.includes('fout') || type.includes('kritiek')) {
      critical.push(item);
    } else if (type.includes('warning') || type.includes('waarschuwing') || type.includes('aandacht')) {
      warnings.push(item);
    } else if (type.includes('suggestion') || type.includes('suggestie') || type.includes('verbetering')) {
      suggestions.push(item);
    } else {
      info.push(item);
    }
  });

  return { critical, warnings, info, suggestions };
}

/**
 * Format field name voor display
 */
function formatFieldName(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .trim();
}
