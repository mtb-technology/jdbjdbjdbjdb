/**
 * GevondenDataCards Component
 *
 * Displays found data cards for validation results.
 * Supports both legacy format and new "Senior Fiscaal Jurist" format.
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calculator, TrendingUp, FileCheck, Users, AlertTriangle, Calendar } from "lucide-react";
import { DataRow } from "./StatusComponents";
import {
  isNewJuristFormat,
  getBetrokkenPersonen,
  getAandachtspunten,
  formatCurrency,
} from "@/utils/box3Utils";
import type { Box3ValidationResult } from "@shared/schema";

interface GevondenDataCardsProps {
  validationResult: Box3ValidationResult;
  jaar?: string; // Optional: filter to specific year for multi-year view
}

export const GevondenDataCards = memo(function GevondenDataCards({
  validationResult,
  jaar,
}: GevondenDataCardsProps) {
  const isNewFormat = isNewJuristFormat(validationResult);
  const betrokkenPersonen = getBetrokkenPersonen(validationResult);
  const aandachtspunten = getAandachtspunten(validationResult);

  // NEW FORMAT: jaren_data
  if (isNewFormat && validationResult.jaren_data) {
    const jarenToShow = jaar
      ? { [jaar]: validationResult.jaren_data[jaar] }
      : validationResult.jaren_data;

    const jaren = Object.keys(jarenToShow).filter(j => jarenToShow[j]).sort();

    if (jaren.length === 0) {
      return null;
    }

    return (
      <div className="space-y-4">
        {/* Betrokken Personen */}
        {betrokkenPersonen.length > 0 && (
          <Card className="border-blue-200 bg-blue-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center">
                <Users className="h-4 w-4 mr-2 text-blue-500" />
                Betrokken Personen
                <Badge variant="secondary" className="ml-2">{betrokkenPersonen.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-3">
                {betrokkenPersonen.map((persoon) => (
                  <div key={persoon.id} className="bg-white p-3 rounded-lg border">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">
                        {persoon.rol.includes("Hoofdaanvrager") ? "Hoofdaanvrager" : "Partner"}
                      </Badge>
                    </div>
                    <p className="font-medium">{persoon.naam || "Onbekend"}</p>
                    {persoon.geboortedatum && (
                      <p className="text-xs text-muted-foreground">Geb: {persoon.geboortedatum}</p>
                    )}
                    {persoon.bsn_mask && (
                      <p className="text-xs text-muted-foreground">BSN: {persoon.bsn_mask}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Per-jaar gegevens */}
        {jaren.map((jaarKey) => {
          const jaarData = jarenToShow[jaarKey];
          if (!jaarData) return null;

          const vermogen = jaarData.vermogens_mix_totaal_huishouden;
          const verdeling = jaarData.fiscale_verdeling;
          const teBetalen = jaarData.te_betalen_terug_te_krijgen;

          return (
            <Card key={jaarKey}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center">
                    <Calendar className="h-4 w-4 mr-2 text-purple-500" />
                    Belastingjaar {jaarKey}
                  </span>
                  {jaarData.document_type && (
                    <Badge variant="outline" className="text-xs">
                      {jaarData.document_type}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Vermogens Mix */}
                {vermogen && (
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Vermogens Samenstelling
                    </h4>
                    <DataRow
                      label="Bank- en spaartegoeden"
                      value={vermogen.bank_en_spaartegoeden}
                    />
                    <DataRow
                      label="Overige bezittingen (beleggingen)"
                      value={vermogen.overige_bezittingen}
                    />
                    {vermogen.onroerende_zaken_waarde !== null && vermogen.onroerende_zaken_waarde !== undefined && (
                      <DataRow
                        label="Onroerende zaken"
                        value={vermogen.onroerende_zaken_waarde}
                      />
                    )}
                    <DataRow
                      label="Schulden Box 3"
                      value={vermogen.schulden_box_3}
                    />
                    <div className="border-t pt-2 mt-2">
                      <DataRow
                        label="Totaal bezittingen"
                        value={vermogen.totaal_bezittingen}
                        highlight
                      />
                      <DataRow
                        label="Heffingsvrij vermogen"
                        value={vermogen.heffingsvrij_vermogen_totaal}
                      />
                    </div>
                  </div>
                )}

                {/* Fiscale Verdeling */}
                {verdeling && (verdeling.aandeel_persoon_1 !== null || verdeling.aandeel_persoon_2 !== null) && (
                  <div className="space-y-1 border-t pt-3">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Fiscale Verdeling
                    </h4>
                    <DataRow
                      label="Grondslag sparen & beleggen totaal"
                      value={verdeling.grondslag_sparen_beleggen_totaal}
                    />
                    {verdeling.aandeel_persoon_1 !== null && (
                      <DataRow
                        label={`Aandeel ${betrokkenPersonen[0]?.naam || "Persoon 1"}`}
                        value={verdeling.aandeel_persoon_1}
                      />
                    )}
                    {verdeling.aandeel_persoon_2 !== null && (
                      <DataRow
                        label={`Aandeel ${betrokkenPersonen[1]?.naam || "Persoon 2"}`}
                        value={verdeling.aandeel_persoon_2}
                      />
                    )}
                  </div>
                )}

                {/* Te betalen / Terug te krijgen */}
                {teBetalen && (
                  <div className="space-y-1 border-t pt-3">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Resultaat
                    </h4>
                    <DataRow
                      label="Box 3 inkomen berekend"
                      value={teBetalen.box_3_inkomen_berekend}
                    />
                    <DataRow
                      label="Totaal te betalen/ontvangen"
                      value={teBetalen.totaal_te_betalen_aanslag}
                      highlight
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Aandachtspunten */}
        {aandachtspunten.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center">
                <AlertTriangle className="h-4 w-4 mr-2 text-amber-500" />
                Aandachtspunten voor Expert
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {aandachtspunten.map((punt, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-amber-500 mt-0.5">•</span>
                    <span>{punt}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // LEGACY FORMAT: gevonden_data structure
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
