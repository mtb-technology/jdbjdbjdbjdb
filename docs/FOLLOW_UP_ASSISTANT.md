# Follow-Up Assistant

> **Status**: Production
> **Doel**: Fiscaal adviseurs helpen snel te reageren op klant follow-up vragen na oplevering van een adviesrapport

---

## 1. Overzicht

De Follow-Up Assistant is een AI-gedreven tool met drie operationele modi:

| Modus | Beschrijving | Gebruik |
|-------|--------------|---------|
| **Met Rapport** | Analyseer klantvragen op basis van dossier + rapport | Bestaande klanten met JDB rapport |
| **Simpele Email** | Beantwoord emails zonder rapport (met bijlagen) | Algemene email assistentie |
| **Extern Rapport** | AI-ondersteund bewerken van externe rapporten | Non-JDB rapporten aanpassen |

```
┌─────────────────────────────────────────────────────────────────────┐
│  FOLLOW-UP ASSISTANT                                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │ Met Rapport │  │Simpele Email│  │Extern Rapport│               │
│  │             │  │             │  │              │                │
│  │ Dossier +   │  │ Email +     │  │ Rapport +    │               │
│  │ Rapport +   │  │ Bijlagen    │  │ Instructie   │               │
│  │ Klantemail  │  │             │  │              │                │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘               │
│         │                │                │                        │
│         ▼                ▼                ▼                        │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    AI ANALYSE                                │  │
│  │  • Vraag extractie                                          │  │
│  │  • Scope classificatie (IN_SCOPE / OUT_OF_SCOPE)            │  │
│  │  • Concept email generatie                                  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│         │                                                          │
│         ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  OUTPUT: Analyse + Concept Email                            │  │
│  │  • Kopieer naar klembord                                    │  │
│  │  • Verfijn met feedback                                     │  │
│  │  • Bewaar in sessie                                         │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Kernbestanden

| Bestand | Doel |
|---------|------|
| [client/src/pages/follow-up-assistant.tsx](../client/src/pages/follow-up-assistant.tsx) | **Hoofd UI pagina** (~1640 regels) |
| [server/routes.ts](../server/routes.ts) (regels 270-599) | API endpoints |
| [shared/schema.ts](../shared/schema.ts) | Database tabellen |
| [client/src/components/assistant/SessionSidebar.tsx](../client/src/components/assistant/SessionSidebar.tsx) | Sessie lijst sidebar |
| [client/src/components/assistant/AssistantSettingsModal.tsx](../client/src/components/assistant/AssistantSettingsModal.tsx) | AI instellingen modal |
| [client/src/components/assistant/ExternalReportTab.tsx](../client/src/components/assistant/ExternalReportTab.tsx) | Extern rapport editor |

---

## 3. Database Schema

### `followUpSessions` - Sessie context

```typescript
{
  id: UUID,
  caseId: UUID | null,           // Optionele link naar reports tabel
  clientName: string,            // "Jan de Vries"
  dossierData: jsonb,            // Originele dossier data (eenmalig opgeslagen)
  rapportContent: text,          // Volledige rapport tekst
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### `followUpThreads` - Email conversaties

```typescript
{
  id: UUID,
  sessionId: UUID,               // FK → followUpSessions (cascade delete)
  emailThread: text,             // Klantemail(s)
  aiAnalysis: jsonb,             // { vraag_van_klant, scope_status, samenvatting }
  conceptEmail: jsonb,           // { onderwerp, body }
  threadNumber: text,            // "1", "2", "3" voor ordening
  createdAt: timestamp
}
```

**Relatie**: Eén sessie → meerdere threads (conversatie historie)

---

## 4. API Endpoints

### Email Generatie

#### `POST /api/assistant/generate`

**Doel**: Genereer AI response met dossier + rapport context

**Request**:
```typescript
{
  systemPrompt: string,   // Instructies voor AI
  userInput: string,      // Dossier + rapport + email (max 200KB)
  model: string           // "gemini-3-pro-preview" | "gpt-4o" | etc.
}
```

**Response**:
```typescript
{
  analyse: {
    vraag_van_klant: string,
    scope_status: "IN_SCOPE" | "OUT_OF_SCOPE",
    inhoudelijke_samenvatting_antwoord: string
  },
  concept_email: {
    onderwerp: string,
    body: string
  }
}
```

#### `POST /api/assistant/simple-email`

**Doel**: Genereer response van email + bijlagen (geen dossier nodig)

**Request**: FormData met:
- `emailThread`: string
- `systemPrompt`: string
- `model`: string
- `files[]`: File[] (max 10 bestanden, 25MB totaal)

**Ondersteunde bestandstypes**:
- PDF (tekst extractie, Vision fallback voor scans)
- Afbeeldingen (JPG, PNG) → Vision API
- Tekstbestanden (TXT)

**Response**: Zelfde structuur + `_debug` object

### Sessie Management

| Endpoint | Method | Beschrijving |
|----------|--------|--------------|
| `/api/follow-up/sessions` | GET | Lijst alle sessies |
| `/api/follow-up/sessions/:id` | GET | Haal sessie + threads op |
| `/api/follow-up/sessions` | POST | Maak nieuwe sessie |
| `/api/follow-up/sessions/:id` | DELETE | Verwijder sessie (cascade) |
| `/api/follow-up/sessions/:id/threads` | POST | Voeg thread toe aan sessie |

---

## 5. AI Workflow: "Met Rapport" Modus

### Stap 1: Input Verzamelen

```
┌─────────────────────────────────────────┐
│ USER INPUT                              │
│                                         │
│ [DOSSIER]                              │
│ Naam: Jan de Vries                     │
│ Situatie: Box 3 bezwaar 2022...        │
│                                         │
│ [RAPPORT]                              │
│ ## 1. Inleiding                        │
│ Op basis van uw aangeleverde...        │
│                                         │
│ [KLANTEMAIL]                           │
│ Beste adviseur,                        │
│ Ik heb nog een vraag over...           │
└─────────────────────────────────────────┘
```

### Stap 2: Scope Classificatie

De AI bepaalt of de vraag binnen of buiten de scope van het rapport valt:

| Classificatie | Betekenis | Response Type |
|---------------|-----------|---------------|
| **IN_SCOPE** | Vraag kan beantwoord worden uit rapport | Inhoudelijk antwoord met citaat |
| **OUT_OF_SCOPE** | Vraag vereist nieuwe analyse | Commerciële email met prijsindicatie |

### Stap 3: Email Generatie

**IN_SCOPE Response**:
```
Beste Jan,

Dank voor uw vraag over [onderwerp]. Zoals u kunt terugvinden in
sectie 2.3 van het rapport:

"[Citaat uit rapport]"

Dit betekent voor uw situatie dat [uitleg].

Met vriendelijke groet,
[Adviseur]
```

**OUT_OF_SCOPE Response**:
```
Beste Jan,

Dank voor uw interessante vervolgvraag over [onderwerp].

Dit betreft echter een nieuwe analyse die buiten het oorspronkelijke
adviesrapport valt. Graag bied ik u aan dit als vervolgadvies
uit te werken.

De kosten hiervoor bedragen €225,- incl. BTW.

Laat u mij weten of u hier gebruik van wilt maken?

Met vriendelijke groet,
[Adviseur]
```

### Stap 4: Verfijning (Optioneel)

```
┌──────────────────────────────────────┐
│ FEEDBACK LOOP                        │
│                                      │
│ Gegenereerde email                   │
│         │                            │
│         ▼                            │
│ Gebruiker feedback:                  │
│ "Maak korter en informeler"          │
│         │                            │
│         ▼                            │
│ AI herschrijft alleen email          │
│ (analyse blijft behouden)            │
│         │                            │
│         ▼                            │
│ Verbeterde email                     │
└──────────────────────────────────────┘
```

---

## 6. AI Workflow: "Simpele Email" Modus

### Bestandsverwerking

```
┌─────────────────────────────────────────────────────────────────┐
│ FILE PROCESSING PIPELINE                                        │
│                                                                 │
│ Bestand                                                         │
│    │                                                            │
│    ├─► PDF ─────┬─► Veel tekst? ─► pdf-parse extractie         │
│    │            └─► Weinig tekst? ─► Vision API (scan)         │
│    │                                                            │
│    ├─► Image ───────────────────────► Vision API (base64)      │
│    │                                                            │
│    └─► TXT ─────────────────────────► Direct lezen             │
│                                                                 │
│ Output: Geëxtraheerde tekst + vision attachments array         │
└─────────────────────────────────────────────────────────────────┘
```

### Prompt Structuur

```
## Email Thread:
{emailThread}

## Bijlages ({n} documenten):
{extracted_text_or_"documenten via vision"}
```

---

## 7. Sessie Beheer

### Sessie Lifecycle

```
1. NIEUWE SESSIE
   ├─ Vul in: Klantnaam + Dossier + Rapport
   ├─ Klik "Bewaar Sessie"
   └─ → POST /api/follow-up/sessions

2. GENEREER EMAIL
   ├─ Plak klantemail
   ├─ Klik "Genereer"
   └─ → Thread wordt automatisch opgeslagen

3. LAAD SESSIE
   ├─ Klik sessie in sidebar
   ├─ → GET /api/follow-up/sessions/:id
   └─ Formulier + historie worden geladen

4. NIEUWE FOLLOW-UP
   ├─ Plak nieuwe klantemail
   ├─ Klik "Genereer"
   └─ → Nieuwe thread toegevoegd

5. VERWIJDER SESSIE
   ├─ Klik delete icon
   ├─ Bevestig in dialog
   └─ → DELETE (cascade naar threads)
```

### Thread Historie UI

```
┌─────────────────────────────────────────────────────────────────┐
│ EERDERE GEGENEREERDE EMAILS                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Thread #3                                    [IN_SCOPE]        │
│ ─────────────────────────────────────────────────────────      │
│ Vraag: "Wat bedoelt u met forfaitair rendement?"              │
│ RE: Verduidelijking forfaitair rendement                       │
│ ▼ [Bekijk volledige email]                                     │
│                                                                 │
│ Thread #2                                    [OUT_OF_SCOPE]    │
│ ─────────────────────────────────────────────────────────      │
│ Vraag: "Kunt u ook mijn partner adviseren?"                   │
│ RE: Vervolgadvies fiscaal partner                              │
│ ▼ [Bekijk volledige email]                                     │
│                                                                 │
│ Thread #1                                    [IN_SCOPE]        │
│ ─────────────────────────────────────────────────────────      │
│ ...                                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Extern Rapport Tab

### Doel

AI-ondersteund bewerken van rapporten die niet in Portal JDB zijn gemaakt.

### Flow

```
1. PASTE RAPPORT
   └─ Plak extern rapport in tekstveld

2. GEEF INSTRUCTIE
   └─ "Maak de toon formeler" / "Voeg sectie over X toe"

3. AI GENEREERT AANPASSINGEN
   └─ JSON met voorgestelde wijzigingen per paragraaf

4. REVIEW WIJZIGINGEN
   ├─ Per wijziging: Accepteren / Bewerken / Afwijzen
   └─ Diff preview tussen origineel en nieuw

5. PAS TOE
   └─ Geaccepteerde wijzigingen worden doorgevoerd

6. ITEREER
   └─ Herhaal voor verdere verfijning
```

### API Endpoints

| Endpoint | Method | Beschrijving |
|----------|--------|--------------|
| `/api/external-reports` | GET | Lijst externe sessies |
| `/api/external-reports` | POST | Maak nieuwe sessie |
| `/api/external-reports/:id/adjust` | POST | Genereer aanpassingen |
| `/api/external-reports/:id/accept` | POST | Commit wijzigingen |
| `/api/external-reports/:id` | DELETE | Verwijder sessie |

---

## 9. AI Configuratie

### Beschikbare Modellen

| Provider | Models | Gebruik |
|----------|--------|---------|
| **Google** | gemini-3-pro-preview, gemini-2.5-pro, gemini-2.5-flash | Default |
| **OpenAI** | gpt-4o, gpt-4o-mini, o3-mini | Alternatief |

### Default Settings

```typescript
// Met Rapport
{
  model: "gemini-3-pro-preview",
  thinkingLevel: "medium"
}

// Simpele Email
{
  model: "gemini-3-pro-preview",
  temperature: 0.3,
  topK: 40,
  maxOutputTokens: 8192
}
```

### System Prompts

**Met Rapport** (DEFAULT_FISCAL_ASSISTANT_PROMPT):
- Rol: "Senior Fiscaal Assistent"
- Taken: Vraag analyseren, scope bepalen, email genereren
- Output: IN_SCOPE (inhoudelijk) of OUT_OF_SCOPE (commercieel)

**Simpele Email** (DEFAULT_SIMPLE_EMAIL_PROMPT):
- Rol: "E-mail Assistent"
- Taken: Vraag analyseren, bijlagen samenvatten, email genereren
- Classificatie: informatievraag | actieverzoek | bevestigingsverzoek | opvolging

---

## 10. Frontend State Management

De Follow-Up Assistant gebruikt React hooks (geen Redux/Zustand):

```typescript
// Sessie state
const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
const [clientName, setClientName] = useState('');
const [sessionThreads, setSessionThreads] = useState<Thread[]>([]);

// Input state (per tab)
const [dossierData, setDossierData] = useState('');
const [rapportContent, setRapportContent] = useState('');
const [emailThread, setEmailThread] = useState('');

// Output state
const [analysis, setAnalysis] = useState<Analysis | null>(null);
const [conceptEmail, setConceptEmail] = useState<Email | null>(null);

// Settings state
const [aiModel, setAiModel] = useState('gemini-3-pro-preview');
const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
```

---

## 11. Debugging Tips

### DevTools Panel

In de UI is een "Developer Tools" sectie beschikbaar die toont:
- Volledige verzonden prompt
- Bijlage namen en types
- Aantal vision attachments
- Ruwe AI response

### Common Issues

| Probleem | Oorzaak | Oplossing |
|----------|---------|-----------|
| "Input te groot" | > 200KB user input | Kort dossier/rapport in |
| "Geen JSON in response" | AI geeft plaintext | Check model, verhoog maxOutputTokens |
| "Bijlage niet verwerkt" | Onbekend bestandstype | Alleen PDF/JPG/PNG/TXT ondersteund |
| "Sessie niet geladen" | Session ID niet gevonden | Check of sessie bestaat in DB |
| "Vision timeout" | Grote afbeeldingen | Verklein afbeeldingen voor upload |

### Logs Bekijken

```bash
# Backend logs (AI calls)
grep "assistant/generate" logs/server.log

# Database queries
grep "followUpSessions" logs/server.log
```

---

## 12. Uitbreiden

### Nieuwe Analyse Type Toevoegen

1. **Update system prompt** in `follow-up-assistant.tsx`:
   ```typescript
   const NEW_ANALYSIS_PROMPT = `
     Je bent een [nieuwe rol]...
   `;
   ```

2. **Voeg tab toe** aan de UI

3. **Optioneel: Nieuwe API endpoint** als processing anders is

### Nieuwe Bestandstype Ondersteunen

1. **Update `/api/assistant/simple-email`** in `server/routes.ts`

2. **Voeg extractie logica toe**:
   ```typescript
   if (file.mimetype === 'application/new-type') {
     extractedText = await extractNewType(file.buffer);
   }
   ```

3. **Update frontend validatie** in `follow-up-assistant.tsx`
