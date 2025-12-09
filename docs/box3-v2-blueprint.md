# Box 3 V2 - Blueprint Data Model

> **Status**: Ontwerp - ter review
> **Doel**: Eén canonical data model waar alle LLM outputs naar toe worden gemapped

---

## 1. Overzicht Architectuur

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   LLM CALLS                                  BACKEND                │
│   (vullen blueprint)                         (rekent ermee)         │
│                                                                     │
│   ┌─────────────┐                                                   │
│   │   INTAKE    │──────┐                                            │
│   └─────────────┘      │                                            │
│                        │      ┌──────────────┐    ┌──────────────┐  │
│   ┌─────────────┐      ├─────▶│  BLUEPRINT   │───▶│  BEREKENING  │  │
│   │  AANVULLING │──────┤      │   (JSON)     │    │  (Pure Math) │  │
│   └─────────────┘      │      └──────────────┘    └──────────────┘  │
│                        │                                            │
│   ┌─────────────┐      │                                            │
│   │ HERVALIDATIE│──────┘                                            │
│   └─────────────┘                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Principe**: LLM extraheert data → wij rekenen ermee

---

## 2. Database Schema (Hybride aanpak)

```sql
-- Dossier metadata (normale kolommen voor queries)
CREATE TABLE box3_dossiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificatie
  dossier_nummer TEXT UNIQUE,           -- "BZ-2024-001"

  -- Klant info
  client_name TEXT NOT NULL,
  client_email TEXT,

  -- Status
  status TEXT DEFAULT 'intake',          -- intake | in_behandeling | wacht_op_klant | klaar | afgerond
  tax_years TEXT[],                       -- ["2022", "2023"]
  has_fiscal_partner BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Documenten (eigen tabel voor beheer)
CREATE TABLE box3_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id UUID REFERENCES box3_dossiers(id) ON DELETE CASCADE,

  -- File info
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_data TEXT NOT NULL,               -- base64

  -- Upload tracking
  uploaded_at TIMESTAMP DEFAULT NOW(),
  uploaded_via TEXT,                      -- "intake" | "aanvulling" | "hervalidatie"

  -- AI classificatie (JSON voor flexibiliteit)
  classification JSONB,                   -- { doc_type, tax_years[], for_person, confidence }
  extraction_summary TEXT,
  extracted_values JSONB                  -- { field: value } pairs
);

-- Blueprint (JSON blob, versioned)
CREATE TABLE box3_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id UUID REFERENCES box3_dossiers(id) ON DELETE CASCADE,

  version INTEGER NOT NULL,               -- 1, 2, 3...
  blueprint JSONB NOT NULL,               -- De volledige blueprint

  created_at TIMESTAMP DEFAULT NOW(),
  created_by TEXT                         -- "intake" | "aanvulling" | "hervalidatie" | "manual"
);

-- Indexes
CREATE INDEX idx_box3_dossiers_status ON box3_dossiers(status);
CREATE INDEX idx_box3_dossiers_client ON box3_dossiers(client_name);
CREATE INDEX idx_box3_documents_dossier ON box3_documents(dossier_id);
CREATE INDEX idx_box3_blueprints_dossier ON box3_blueprints(dossier_id);
```

---

## 3. Blueprint JSON Structuur

Dit is de **canonical data structure** waar alle LLM outputs naar toe worden gemapped.

```json
{
  "schema_version": "2.0",

  "fiscal_entity": {
    "taxpayer": {
      "id": "tp_01",
      "name": "Dhr. J. Jansen",
      "bsn_masked": "****4567",
      "date_of_birth": "1975-03-15",
      "email": "jan@klant.nl"
    },
    "fiscal_partner": {
      "has_partner": true,
      "id": "fp_01",
      "name": "Mevr. S. Jansen-De Vries",
      "bsn_masked": "****8901",
      "date_of_birth": "1978-06-22"
    }
  },

  "assets": {
    "bank_savings": [
      {
        "id": "asset_bank_01",
        "owner_id": "tp_01",
        "description": "ABN Amro Spaarrekening",
        "account_masked": "NL22ABNA****99",
        "is_joint_account": false,
        "ownership_percentage": 100,
        "is_green_investment": false,

        "yearly_data": {
          "2023": {
            "value_jan_1": {
              "amount": 45000.00,
              "source_doc_id": "doc_001",
              "source_snippet": "Saldo per 1-1-2023: € 45.000,00",
              "confidence": 1.0
            },
            "value_dec_31": {
              "amount": 47500.00,
              "source_doc_id": "doc_001",
              "confidence": 1.0
            },
            "interest_received": {
              "amount": 625.50,
              "source_doc_id": "doc_002",
              "source_snippet": "Totaal ontvangen rente 2023: € 625,50",
              "confidence": 0.95
            }
          },
          "2022": {
            "value_jan_1": { "amount": 42000.00, "source_doc_id": "doc_003" },
            "value_dec_31": { "amount": 45000.00, "source_doc_id": "doc_003" },
            "interest_received": { "amount": 85.00, "source_doc_id": "doc_003" }
          }
        }
      }
    ],

    "investments": [
      {
        "id": "asset_inv_01",
        "owner_id": "joint",
        "description": "Meesman Indexbeleggen",
        "institution": "Meesman",
        "type": "stocks",
        "ownership_percentage": 100,

        "yearly_data": {
          "2023": {
            "value_jan_1": { "amount": 120000.00, "source_doc_id": "doc_004" },
            "value_dec_31": { "amount": 135000.00, "source_doc_id": "doc_004" },
            "dividend_received": { "amount": 2400.00, "source_doc_id": "doc_004" },
            "deposits": { "amount": 5000.00, "source_doc_id": "doc_004" },
            "withdrawals": { "amount": 0, "source_doc_id": "doc_004" },
            "transaction_costs": {
              "amount": 150.00,
              "source_type": "estimate",
              "requires_validation": true
            }
          }
        }
      }
    ],

    "real_estate": [
      {
        "id": "asset_re_01",
        "owner_id": "tp_01",
        "description": "Verhuurpand Kerkstraat 12",
        "address": "Kerkstraat 12, 1012 AB Amsterdam",
        "type": "rented_residential",
        "ownership_percentage": 50,
        "ownership_note": "50% eigendom, andere 50% is van broer",

        "yearly_data": {
          "2023": {
            "woz_value": {
              "amount": 550000.00,
              "reference_date": "2022-01-01",
              "source_doc_id": "doc_005"
            },
            "economic_value": {
              "amount": 560000.00,
              "source_type": "client_estimate",
              "source_snippet": "marktwaarde is denk ik 560k"
            },
            "rental_income_gross": { "amount": 18000.00, "source_doc_id": "doc_006" },
            "maintenance_costs": { "amount": 4500.00, "source_doc_id": "doc_007" },
            "property_tax": {
              "amount": null,
              "requires_validation": true,
              "validation_note": "OZB bedrag ontbreekt"
            }
          }
        }
      }
    ],

    "other_assets": [
      {
        "id": "asset_other_01",
        "owner_id": "tp_01",
        "description": "VvE Reservefonds",
        "type": "vve_share",

        "yearly_data": {
          "2023": {
            "value_jan_1": { "amount": 3200.00, "source_doc_id": "doc_008" }
          }
        }
      }
    ]
  },

  "debts": [
    {
      "id": "debt_01",
      "owner_id": "tp_01",
      "description": "Verhuurhypotheek Rabo",
      "linked_asset_id": "asset_re_01",
      "lender": "Rabobank",
      "ownership_percentage": 50,

      "yearly_data": {
        "2023": {
          "value_jan_1": { "amount": 250000.00, "source_doc_id": "doc_009" },
          "value_dec_31": { "amount": 245000.00, "source_doc_id": "doc_009" },
          "interest_paid": { "amount": 8500.00, "source_doc_id": "doc_010" },
          "interest_rate": { "percentage": 3.5, "source_doc_id": "doc_009" }
        }
      }
    }
  ],

  "tax_authority_data": {
    "2023": {
      "source_doc_id": "doc_011",
      "document_type": "definitieve_aanslag",
      "document_date": "2024-05-15",

      "per_person": {
        "tp_01": {
          "allocation_percentage": 60,
          "total_assets_box3": 280000.00,
          "total_debts_box3": 125000.00,
          "exempt_amount": 57000.00,
          "taxable_base": 98000.00,
          "deemed_return": 5800.00,
          "tax_assessed": 1856.00
        },
        "fp_01": {
          "allocation_percentage": 40,
          "total_assets_box3": 186666.00,
          "total_debts_box3": 0,
          "exempt_amount": 57000.00,
          "taxable_base": 72666.00,
          "deemed_return": 4500.00,
          "tax_assessed": 1440.00
        }
      },

      "household_totals": {
        "total_assets_gross": 723200.00,
        "total_debts": 250000.00,
        "net_assets": 473200.00,
        "total_exempt": 114000.00,
        "taxable_base": 359200.00,
        "total_tax_assessed": 3296.00
      }
    }
  },

  "year_summaries": {
    "2023": {
      "status": "ready_for_calculation",
      "completeness": {
        "bank_savings": "complete",
        "investments": "complete",
        "real_estate": "incomplete",
        "debts": "complete",
        "tax_return": "complete"
      },
      "missing_items": [
        {
          "field": "assets.real_estate[0].yearly_data.2023.property_tax",
          "description": "OZB bedrag voor Kerkstraat 12",
          "severity": "low",
          "action": "ask_client"
        }
      ],
      "calculated_totals": {
        "total_assets_jan_1": 723200.00,
        "actual_return": {
          "bank_interest": 625.50,
          "investment_gain": 12600.00,
          "dividends": 2400.00,
          "rental_income_net": 13500.00,
          "debt_interest_paid": -8500.00,
          "total": 20625.50
        },
        "deemed_return_from_tax_authority": 10300.00,
        "difference": 10325.50,
        "indicative_refund": 3304.16,
        "is_profitable": true
      }
    },
    "2022": {
      "status": "incomplete",
      "missing_items": [
        {
          "field": "tax_authority_data.2022",
          "description": "Aangifte IB 2022 ontbreekt",
          "severity": "critical",
          "action": "ask_client"
        }
      ]
    }
  },

  "validation_flags": [
    {
      "id": "flag_001",
      "field_path": "assets.investments[0].yearly_data.2023.transaction_costs",
      "type": "requires_validation",
      "message": "Transactiekosten zijn geschat, verifiëren met jaaroverzicht",
      "severity": "medium",
      "created_at": "2025-12-09T10:30:00Z"
    }
  ],

  "manual_overrides": [
    {
      "id": "override_001",
      "field_path": "assets.bank_savings[0].yearly_data.2023.interest_received.amount",
      "original_value": 600.00,
      "override_value": 625.50,
      "reason": "Gecorrigeerd na ontvangst definitief jaaroverzicht",
      "created_at": "2025-12-09T14:00:00Z",
      "created_by": "user"
    }
  ]
}
```

---

## 4. TypeScript Types

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// BOX 3 BLUEPRINT - TypeScript Types
// ═══════════════════════════════════════════════════════════════════════════

// ─── Data Point (elke waarde met source tracking) ───
interface DataPoint<T = number> {
  amount: T;
  source_doc_id?: string;
  source_type?: 'document' | 'email' | 'client_estimate' | 'calculation' | 'estimate';
  source_snippet?: string;
  confidence?: number;  // 0.0 - 1.0
  requires_validation?: boolean;
  validation_note?: string;
}

// ─── Persons ───
interface Person {
  id: string;  // "tp_01" | "fp_01"
  name: string | null;
  bsn_masked: string | null;
  date_of_birth: string | null;
  email?: string | null;
}

interface FiscalEntity {
  taxpayer: Person;
  fiscal_partner: {
    has_partner: boolean;
    id?: string;
    name?: string | null;
    bsn_masked?: string | null;
    date_of_birth?: string | null;
  };
}

// ─── Assets ───
type OwnerRef = string;  // "tp_01" | "fp_01" | "joint"

interface BankSavingsAsset {
  id: string;
  owner_id: OwnerRef;
  description: string;
  account_masked?: string;
  bank_name?: string;
  is_joint_account: boolean;
  ownership_percentage: number;
  is_green_investment: boolean;

  yearly_data: Record<string, {
    value_jan_1?: DataPoint;
    value_dec_31?: DataPoint;
    interest_received?: DataPoint;
    currency_result?: DataPoint;
  }>;
}

interface InvestmentAsset {
  id: string;
  owner_id: OwnerRef;
  description: string;
  institution?: string;
  type: 'stocks' | 'bonds' | 'funds' | 'crypto' | 'other';
  ownership_percentage: number;

  yearly_data: Record<string, {
    value_jan_1?: DataPoint;
    value_dec_31?: DataPoint;
    dividend_received?: DataPoint;
    deposits?: DataPoint;
    withdrawals?: DataPoint;
    realized_gains?: DataPoint;
    transaction_costs?: DataPoint;
  }>;
}

interface RealEstateAsset {
  id: string;
  owner_id: OwnerRef;
  description: string;
  address: string;
  type: 'rented_residential' | 'rented_commercial' | 'vacation_home' | 'land' | 'other';
  ownership_percentage: number;
  ownership_note?: string;

  yearly_data: Record<string, {
    woz_value?: DataPoint & { reference_date?: string };
    economic_value?: DataPoint;
    rental_income_gross?: DataPoint;
    maintenance_costs?: DataPoint;
    property_tax?: DataPoint;
    insurance?: DataPoint;
    other_costs?: DataPoint;
  }>;
}

interface OtherAsset {
  id: string;
  owner_id: OwnerRef;
  description: string;
  type: 'vve_share' | 'claims' | 'rights' | 'other';

  yearly_data: Record<string, {
    value_jan_1?: DataPoint;
    value_dec_31?: DataPoint;
    income_received?: DataPoint;
  }>;
}

interface Assets {
  bank_savings: BankSavingsAsset[];
  investments: InvestmentAsset[];
  real_estate: RealEstateAsset[];
  other_assets: OtherAsset[];
}

// ─── Debts ───
interface Debt {
  id: string;
  owner_id: OwnerRef;
  description: string;
  lender?: string;
  linked_asset_id?: string;
  ownership_percentage: number;

  yearly_data: Record<string, {
    value_jan_1?: DataPoint;
    value_dec_31?: DataPoint;
    interest_paid?: DataPoint;
    interest_rate?: DataPoint<number>;  // percentage
  }>;
}

// ─── Tax Authority Data ───
interface TaxAuthorityPersonData {
  allocation_percentage: number;
  total_assets_box3: number;
  total_debts_box3: number;
  exempt_amount: number;
  taxable_base: number;
  deemed_return: number;
  tax_assessed: number;
}

interface TaxAuthorityYearData {
  source_doc_id: string;
  document_type: 'aangifte' | 'voorlopige_aanslag' | 'definitieve_aanslag';
  document_date?: string;

  per_person: Record<string, TaxAuthorityPersonData>;

  household_totals: {
    total_assets_gross: number;
    total_debts: number;
    net_assets: number;
    total_exempt: number;
    taxable_base: number;
    total_tax_assessed: number;
  };
}

// ─── Year Summary ───
type CompletenessStatus = 'complete' | 'incomplete' | 'not_applicable';
type YearStatus = 'no_data' | 'incomplete' | 'ready_for_calculation' | 'complete';

interface MissingItem {
  field: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'ask_client' | 'search_documents' | 'manual_entry';
}

interface CalculatedTotals {
  total_assets_jan_1: number;
  actual_return: {
    bank_interest: number;
    investment_gain: number;
    dividends: number;
    rental_income_net: number;
    debt_interest_paid: number;
    total: number;
  };
  deemed_return_from_tax_authority: number;
  difference: number;
  indicative_refund: number;
  is_profitable: boolean;
}

interface YearSummary {
  status: YearStatus;
  completeness: {
    bank_savings: CompletenessStatus;
    investments: CompletenessStatus;
    real_estate: CompletenessStatus;
    debts: CompletenessStatus;
    tax_return: CompletenessStatus;
  };
  missing_items: MissingItem[];
  calculated_totals?: CalculatedTotals;
}

// ─── Validation & Overrides ───
interface ValidationFlag {
  id: string;
  field_path: string;
  type: 'requires_validation' | 'low_confidence' | 'inconsistency';
  message: string;
  severity: 'low' | 'medium' | 'high';
  created_at: string;
  resolved_at?: string;
}

interface ManualOverride {
  id: string;
  field_path: string;
  original_value: number | string | null;
  override_value: number | string;
  reason: string;
  created_at: string;
  created_by: string;
}

// ─── Complete Blueprint ───
interface Box3Blueprint {
  schema_version: string;

  fiscal_entity: FiscalEntity;
  assets: Assets;
  debts: Debt[];
  tax_authority_data: Record<string, TaxAuthorityYearData>;
  year_summaries: Record<string, YearSummary>;

  validation_flags: ValidationFlag[];
  manual_overrides: ManualOverride[];
}
```

---

## 5. Wat de LLM moet doen

Elke LLM call krijgt dezelfde instructie:

> **"Analyseer de aangeleverde bronnen en vul/verrijk de blueprint JSON."**

### Intake Call
- Input: Lege blueprint template + intake mail + uploads
- Output: Ingevulde blueprint met alle gevonden data

### Aanvulling Call
- Input: Bestaande blueprint + nieuw document
- Output: Verrijkte blueprint (voeg toe / update bestaande items)

### Hervalidatie Call
- Input: Bestaande blueprint + alle documenten + nieuwe context
- Output: Herziene blueprint (kan waarden corrigeren)

---

## 6. Wat de Backend doet (geen LLM)

De backend doet alle **berekeningen** deterministisch:

```typescript
function calculateYearSummary(
  blueprint: Box3Blueprint,
  year: string,
  forfaitaireRendementen: ForfaitaireRendementen
): YearSummary {
  // 1. Tel alle bezittingen op (value_jan_1)
  // 2. Tel alle werkelijke rendementen op
  // 3. Haal forfaitair rendement uit tax_authority_data
  // 4. Bereken verschil
  // 5. Pas tarief toe → indicatieve teruggave
  // 6. Bepaal status en missing items
}
```

---

## 7. Migratie van oude structuur

De oude `box3_validator_sessions` tabel blijft bestaan. Nieuwe dossiers gebruiken het nieuwe schema. Later kunnen we een migratie script schrijven.

```typescript
// Pseudo-code migratie
function migrateOldSession(old: Box3ValidatorSession): Box3Blueprint {
  const blueprint = createEmptyBlueprint();

  // Map oude validationResult naar nieuwe structuur
  if (old.validationResult?.gevonden_data) {
    // ... extract en map data
  }

  // Map oude attachments naar documents tabel
  for (const att of old.attachments || []) {
    // ... create document records
  }

  return blueprint;
}
```

---

## Volgende stappen

1. [ ] Review deze specificatie
2. [ ] Drizzle schema toevoegen aan `shared/schema.ts`
3. [ ] Zod validatie schemas schrijven
4. [ ] LLM prompt voor intake schrijven
5. [ ] Normalizer function schrijven (LLM output → blueprint)
6. [ ] UI componenten aanpassen
