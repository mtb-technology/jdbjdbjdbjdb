/**
 * GevondenDataCards Component
 *
 * Displays found data cards for new format validation results.
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calculator, TrendingUp, FileCheck } from "lucide-react";
import { DataRow } from "./StatusComponents";
import type { Box3ValidationResult } from "@shared/schema";

interface GevondenDataCardsProps {
  validationResult: Box3ValidationResult;
}

export const GevondenDataCards = memo(function GevondenDataCards({
  validationResult,
}: GevondenDataCardsProps) {
  const gevondenData = validationResult.gevonden_data;

  if (!gevondenData) {
    return null;
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Fiscus Box 3 Data */}
      {gevondenData.fiscus_box3 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center">
              <Calculator className="h-4 w-4 mr-2 text-blue-500" />
              Fiscale Gegevens (Box 3)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <DataRow
              label="Totaal bezittingen (bruto)"
              value={gevondenData.fiscus_box3.totaal_bezittingen_bruto}
            />
            <DataRow
              label="Heffingsvrij vermogen"
              value={gevondenData.fiscus_box3.heffingsvrij_vermogen}
            />
            <DataRow
              label="Schulden Box 3"
              value={gevondenData.fiscus_box3.schulden_box3}
            />
            <div className="border-t pt-2 mt-2">
              <DataRow
                label="Belastbaar inkomen (na drempel)"
                value={gevondenData.fiscus_box3.belastbaar_inkomen_na_drempel}
                highlight
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Werkelijk Rendement */}
      {gevondenData.werkelijk_rendement_input && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center">
              <TrendingUp className="h-4 w-4 mr-2 text-green-500" />
              Werkelijk Rendement
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <DataRow
              label="Bank rente ontvangen"
              value={gevondenData.werkelijk_rendement_input.bank_rente_ontvangen}
            />
            <DataRow
              label="Beleggingen waarde 1 jan"
              value={gevondenData.werkelijk_rendement_input.beleggingen_waarde_1jan}
            />
            <DataRow
              label="Beleggingen waarde 31 dec"
              value={gevondenData.werkelijk_rendement_input.beleggingen_waarde_31dec}
            />
            <DataRow
              label="Beleggingen dividend"
              value={gevondenData.werkelijk_rendement_input.beleggingen_dividend}
            />
            <DataRow
              label="Mutaties gevonden"
              value={gevondenData.werkelijk_rendement_input.beleggingen_mutaties_gevonden}
            />
            <DataRow
              label="Schulden rente betaald"
              value={gevondenData.werkelijk_rendement_input.schulden_rente_betaald}
            />
          </CardContent>
        </Card>
      )}

      {/* Analyse Box 3 */}
      {validationResult.analyse_box3 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center">
              <FileCheck className="h-4 w-4 mr-2 text-purple-500" />
              Analyse Resultaat
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <DataRow
              label="Basis bedrag oordeel"
              value={validationResult.analyse_box3.oordeel_basis_bedrag}
              highlight
            />
            <DataRow
              label="Conclusie type"
              value={validationResult.analyse_box3.conclusie_type}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
});
