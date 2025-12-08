# Workflow UX Redesign Plan

## Probleem

De huidige workflow UI heeft verschillende UX problemen:
1. **Te veel knoppen** op één rij (Herlaad Prompts, Express Mode, Rapport Aanpassen, Bekijk Wijzigingen)
2. **Contextloze acties** - "Rapport Aanpassen" en "Bekijk Wijzigingen" horen bij Express Mode maar staan altijd zichtbaar
3. **Verticale scroll overload** - 8+ stages in één lange pagina
4. **Sidebar alleen op grote schermen** - Navigatie verdwijnt op kleinere schermen
5. **Onduidelijke flow** - Waar ben ik? Wat is de volgende stap?

## User Feedback

- **Express Mode** → hoort bij Stage 3, kan daar blijven als actie
- **Express Mode tag** → Als dossier met Express Mode is gegenereerd, toon dit als badge/tag
- **Bekijk Wijzigingen** → gekoppeld aan Express Mode, toont wat is doorgevoerd + revert optie
- **Rapport Aanpassen** → ook Express Mode gerelateerd
- **Herlaad Prompts** → developer actie, verbergen achter "..." menu of settings
- **Mobile/responsive** → zeer belangrijk, wordt actief gebruikt

## Oplossing: CRM-Style Tab Navigation

Geïnspireerd door Salesforce, Zendesk, HubSpot:

### Nieuwe Layout Structuur

**Desktop:**
```
┌─────────────────────────────────────────────────────────────┐
│ WORKFLOW HEADER (compact)                                   │
│ [Icon] Fiscale Rapport | 4/8 ✓ | [Express Mode Badge] [⚙️] │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ STAGE TABS (horizontal, scrollable)                         │
│ [1a ✓] ─ [2 ✓] ─ [3 ✓] ─ [4a ✓] ─ [4b ●] ─ [4c] ─ [4f] ─ [6] │
│  Info    Cmplx   Gen    Bron    Fisc    Scen   Comm   Sum  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ACTIVE STAGE CONTENT (één stage tegelijk)                   │
│                                                             │
│ Stage 3: Rapport Generatie                    [Status]      │
│ ───────────────────────────────────────────────────────     │
│                                                             │
│ [Stage-specifieke acties: Express Mode, Rapport Aanpassen]  │
│ [Input sectie]                                              │
│ [Output sectie]                                             │
│                                                             │
│ [← Vorige]                              [Volgende →]        │
└─────────────────────────────────────────────────────────────┘
```

**Mobile (swipeable):**
```
┌─────────────────────┐
│ 4/8 ✓ │ [⚙️]       │
├─────────────────────┤
│ ← [3 Gen] [4a●] →  │  ← horizontaal scrollable tabs
├─────────────────────┤
│                     │
│ 4a. Bronnen         │
│ Specialist          │
│                     │
│ [Uitvoeren]         │
│                     │
│ [Output...]         │
│                     │
│ [← Vorige] [Next →] │
└─────────────────────┘
```

### Belangrijkste Wijzigingen

#### 1. Horizontale Stage Tabs (nieuw component)
**File:** `client/src/components/workflow/WorkflowStageTabs.tsx`

- Horizontale tab bar met alle stages
- Visual states: completed (✓ groen), current (● blauw), pending (○ grijs), error (✗ rood)
- Scrollable op kleinere schermen (touch swipe support)
- Klikbaar om direct naar stage te gaan
- Connector lijnen tussen tabs (zoals een progress stepper)

#### 2. Single-Stage View (refactor)
**File:** `client/src/components/workflow/WorkflowView.tsx`

- Toon slechts 1 stage tegelijk (geen accordeon meer)
- Tab click = wissel naar die stage
- Vorige/Volgende navigatie onderaan elke stage
- Keyboard navigatie (← →)

#### 3. Contextual Actions per Stage
**File:** `client/src/components/workflow/WorkflowProgressHeader.tsx`

Vereenvoudig header naar:
- Progress indicator (compact: "4/8 ✓")
- Express Mode badge (als gebruikt)
- Settings menu (⚙️) met:
  - Herlaad Prompts
  - Developer Tools toggle
  - Andere minder-gebruikte opties

**Stage 3 specifieke acties:**
- Express Mode knop (start auto-run van alle review stages)
- Rapport Aanpassen knop

**Express Mode Panel (na completion):**
- Bekijk Wijzigingen
- Revert opties per stage
- Overzicht van auto-approved changes

#### 4. Verwijder Sidebar Navigator
**File:** `client/src/components/workflow/StageGroupNavigator.tsx`

- Niet meer nodig met horizontale tabs
- Bespaart horizontale ruimte
- Tabs zijn altijd zichtbaar (ook mobile)

### Files om te wijzigen

| File | Actie |
|------|-------|
| `WorkflowStageTabs.tsx` | **NIEUW** - Horizontale tab navigatie component |
| `WorkflowView.tsx` | Refactor naar single-stage view + tabs integratie |
| `WorkflowProgressHeader.tsx` | Compact maken + settings menu toevoegen |
| `WorkflowStageCard.tsx` | Aanpassen voor full-width single view |
| `StageGroupNavigator.tsx` | Verwijderen (vervangen door tabs) |
| `ExpressModeButton.tsx` | Verplaatsen naar Stage 3 content |

### Component Details

**WorkflowStageTabs.tsx (NIEUW):**
```tsx
interface WorkflowStageTabsProps {
  stages: StageConfig[];
  currentStage: string;
  stageResults: Record<string, any>;
  onStageSelect: (stageKey: string) => void;
}

// Visual: horizontale stepper met connector lijnen
// States: completed | current | processing | pending | error | blocked
// Labels: korte namen (Info, Complex, Rapport, etc.)
// Mobile: horizontaal scrollable met touch
```

**Settings Menu (⚙️):**
```tsx
// DropdownMenu met:
// - Herlaad Prompts
// - Developer Tools aan/uit
// - Reset Workflow (danger)
```

### Mobile Responsive Design

- **Tabs:** Horizontaal scrollable, touch swipe
- **Current tab:** Auto-scroll into view
- **Stage content:** Full width, geen sidebar
- **Navigation:** Sticky bottom bar met ← → knoppen
- **Breakpoints:**
  - Mobile: < 640px (sm)
  - Tablet: 640-1024px
  - Desktop: > 1024px

## Implementatie Volgorde

### Fase 1: Tab Component + View Toggle
1. Maak `WorkflowStageTabs.tsx` met horizontale tabs
2. Maak `WorkflowViewToggle.tsx` (Per Stap / Alle Stappen toggle)
3. Voeg tabs + toggle toe aan WorkflowView (boven huidige content)
4. Test tab navigatie werkt

### Fase 2: Single Stage View
5. Refactor WorkflowView naar single-stage weergave (als "Per Stap" actief)
6. Behoud accordeon als "Alle Stappen" view
7. Voeg Vorige/Volgende navigatie toe onderaan single stage

### Fase 3: Header Cleanup + Express Mode
8. Maak WorkflowProgressHeader compact
9. Voeg settings menu toe (⚙️) met Herlaad Prompts etc
10. Verplaats Express Mode knop naar Stage 3 content
11. Maak `ExpressModeCompleteBanner.tsx` voor na completion
12. Voeg ⚡ badges toe aan express-completed stages

### Fase 4: Cleanup & Polish
13. Verwijder StageGroupNavigator (vervangen door tabs)
14. Mobile responsive testing
15. Keyboard navigatie (← →)
16. Test alle flows (manual, express mode, adjustment)

## Geschatte Impact

- **Files gewijzigd:** ~7
- **Nieuwe componenten:** 3 (WorkflowStageTabs, WorkflowViewToggle, ExpressModeCompleteBanner)
- **Verwijderd:** 1 (StageGroupNavigator)
- **Breaking changes:** Nee, beide views beschikbaar (toggle)

## Beslissingen

1. **View Toggle:** Ja, toggle tussen "Per Stap" (single) en "Alle Stappen" (accordeon)
2. **Express Mode Results:** Prominent bovenaan als banner/card na completion, duidelijk gekoppeld aan Express Mode run

### Express Mode Flow (verduidelijking)

```
VOOR Express Mode:
┌─────────────────────────────────────────────────────────────┐
│ [Tabs: 1a ✓ - 2 ✓ - 3 ● - 4a - 4b - 4c - 4f - 6]           │
├─────────────────────────────────────────────────────────────┤
│ Stage 3: Rapport Generatie                    [Voltooid ✓]  │
│                                                             │
│ [🚀 Express Mode]  [✏️ Rapport Aanpassen]                   │
│                                                             │
│ Output: ...                                                 │
└─────────────────────────────────────────────────────────────┘

NA Express Mode (alle review stages auto-completed):
┌─────────────────────────────────────────────────────────────┐
│ ⚡ EXPRESS MODE VOLTOOID                    [Bekijk Details] │
│ 5 stages automatisch doorlopen • 12 wijzigingen doorgevoerd │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ [Tabs: 1a ✓ - 2 ✓ - 3 ✓ - 4a ✓ - 4b ✓ - 4c ✓ - 4f ✓ - 6]   │
│                                      ⚡ badges op express   │
├─────────────────────────────────────────────────────────────┤
│ Stage 4f: Hoofd Communicatie                  [Express ⚡]   │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

### View Toggle

```
┌─────────────────────────────────────────────────────────────┐
│ [Per Stap ○] [Alle Stappen ●]                    [⚙️]       │
└─────────────────────────────────────────────────────────────┘

Per Stap = Single stage view met tabs (default, mobile-friendly)
Alle Stappen = Accordeon view voor power users die overview willen
```
