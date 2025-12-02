/**
 * Status Components for Box 3 Validator
 *
 * Small UI components for displaying document and global status.
 */

import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  AlertCircle,
  XCircle,
  Ban,
  PiggyBank,
  AlertTriangle,
} from "lucide-react";
import { formatCurrency } from "@/utils/box3Utils";

/**
 * Status icon based on document status
 */
export const StatusIcon = memo(function StatusIcon({
  status,
}: {
  status: string;
}) {
  if (status === "compleet") {
    return <CheckCircle className="h-5 w-5 text-green-500" />;
  } else if (status === "onvolledig") {
    return <AlertCircle className="h-5 w-5 text-orange-500" />;
  } else {
    return <XCircle className="h-5 w-5 text-red-500" />;
  }
});

/**
 * Status badge for document status
 */
export const StatusBadge = memo(function StatusBadge({
  status,
}: {
  status: string;
}) {
  if (status === "compleet") {
    return (
      <Badge className="bg-green-500 hover:bg-green-600">Compleet</Badge>
    );
  } else if (status === "onvolledig") {
    return (
      <Badge className="bg-orange-500 hover:bg-orange-600">Onvolledig</Badge>
    );
  } else if (status === "nvt") {
    return <Badge variant="secondary">N.v.t.</Badge>;
  } else {
    return <Badge variant="destructive">Ontbreekt</Badge>;
  }
});

/**
 * Global status badge for new format
 */
export const GlobalStatusBadge = memo(function GlobalStatusBadge({
  status,
}: {
  status: string;
}) {
  switch (status) {
    case "REJECTED_LOW_VALUE":
      return (
        <Badge variant="destructive" className="text-sm">
          <Ban className="h-3 w-3 mr-1" />
          Afgewezen - Te laag belang
        </Badge>
      );
    case "REJECTED_SAVINGS_ONLY":
      return (
        <Badge variant="destructive" className="text-sm">
          <PiggyBank className="h-3 w-3 mr-1" />
          Afgewezen - Alleen spaargeld
        </Badge>
      );
    case "MISSING_IB_CRITICAL":
      return (
        <Badge className="bg-orange-500 hover:bg-orange-600 text-sm">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Aangifte IB ontbreekt
        </Badge>
      );
    case "ACTION_REQUIRED":
      return (
        <Badge className="bg-yellow-500 hover:bg-yellow-600 text-sm">
          <AlertCircle className="h-3 w-3 mr-1" />
          Actie vereist
        </Badge>
      );
    case "READY_FOR_CALCULATION":
      return (
        <Badge className="bg-green-500 hover:bg-green-600 text-sm">
          <CheckCircle className="h-3 w-3 mr-1" />
          Klaar voor berekening
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
});

/**
 * Data row component for displaying label/value pairs
 */
export const DataRow = memo(function DataRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number | boolean | null | undefined;
  highlight?: boolean;
}) {
  let displayValue: string;
  if (value === null || value === undefined) {
    displayValue = "—";
  } else if (typeof value === "boolean") {
    displayValue = value ? "Ja" : "Nee";
  } else if (typeof value === "number") {
    displayValue = formatCurrency(value);
  } else {
    displayValue = String(value);
  }

  return (
    <div
      className={`flex justify-between py-1 ${
        highlight ? "font-semibold text-primary" : ""
      }`}
    >
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={`text-sm ${highlight ? "text-primary" : ""}`}>
        {displayValue}
      </span>
    </div>
  );
});
