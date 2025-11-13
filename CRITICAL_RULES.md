# ⚠️ CRITICAL SYSTEM RULES

**Deze regels zijn ABSOLUUT en mogen NOOIT worden overtreden.**

---

## 🔥 REGEL #1: GEEN FALLBACK PROMPTS

### **Waarom:**
Fallback prompts ondermijnen de **kwaliteit** van het hele systeem. Als een prompt niet is geconfigureerd, betekent dit dat:
- De admin vergeten is deze in te stellen
- De prompt mogelijk verouderd of incorrect is
- De kwaliteit van de AI output onvoorspelbaar wordt

### **Wat te doen:**
✅ **CORRECT**: Throw een duidelijke error met instructies voor de admin
```typescript
if (!prompt || prompt.trim().length === 0) {
  throw new Error(
    `❌ FATAL: Prompt niet geconfigureerd in Settings. ` +
    `Ga naar Settings en configureer de prompt voor stage "${stageName}".`
  );
}
```

❌ **FOUT**: Fallback naar hardcoded default prompt
```typescript
// NEVER DO THIS!
const prompt = configPrompt || "Je bent een expert..."; // ❌ WRONG!
```

### **Consequentie van overtreding:**
- Kwaliteit van AI output degradeert ongemerkt
- Admin denkt dat systeem werkt terwijl het suboptimaal presteert
- Debugging wordt onmogelijk want het is onduidelijk welke prompt werd gebruikt

---

## 🔥 REGEL #2: VALIDEER PROMPT CONFIGS BIJ STARTUP

### **Waarom:**
Het systeem moet **direct** falen bij incomplete configuratie, niet halverwege een productie run.

### **Wat te doen:**
✅ **CORRECT**: Valideer bij het laden van active config
```typescript
async getActivePromptConfig(): Promise<PromptConfigRecord | undefined> {
  const config = await db.select()...;
  if (config) {
    this.validatePromptConfig(config); // THROWS if incomplete
  }
  return config;
}
```

❌ **FOUT**: Alleen warnings loggen
```typescript
// NEVER DO THIS!
if (!prompt) {
  console.warn("Missing prompt"); // ❌ WRONG! Should THROW
}
```

---

## 🔥 REGEL #3: FAIL FAST, FAIL LOUD

### **Waarom:**
Stille failures leiden tot degradatie in productie. Beter een crash tijdens development dan stille failure in productie.

### **Wat te doen:**
- ✅ Throw errors met **duidelijke** instructies hoe op te lossen
- ✅ Gebruik emoji's voor visibility (❌, ⚠️, 🔥)
- ✅ Geef de exacte locatie waar te fixen (bijv: "Ga naar Settings > Editor prompt")

---

## 📝 CHECKLIST: Voordat je Prompt Logic Toevoegt

- [ ] Is er een fallback prompt? → **VERWIJDER DEZE**
- [ ] Throw ik een error als prompt leeg is? → **JA**
- [ ] Is de error message duidelijk waar te fixen? → **JA**
- [ ] Valideer ik de config bij startup? → **JA**
- [ ] Zijn placeholders geblokkeerd? → **JA**

---

## 🎯 VOORBEELD: Correcte Implementatie

```typescript
// ✅ CORRECT: No fallbacks, hard failures with clear instructions
private async buildPrompt(stage: string): Promise<string> {
  const config = await getActivePromptConfig();
  const stageConfig = config[stage];

  // FAIL HARD if not configured
  if (!stageConfig?.prompt || stageConfig.prompt.trim().length === 0) {
    throw new Error(
      `❌ FATAL: Prompt voor stage "${stage}" niet geconfigureerd. ` +
      `Ga naar Settings en configureer de prompt. ` +
      `Het systeem is geblokkeerd tot dit is opgelost.`
    );
  }

  // FAIL HARD if placeholder
  if (stageConfig.prompt.includes('PLACEHOLDER')) {
    throw new Error(
      `❌ FATAL: Prompt voor stage "${stage}" bevat PLACEHOLDER tekst. ` +
      `Vervang deze met een echte prompt in Settings.`
    );
  }

  return stageConfig.prompt;
}
```

---

**Deze regels zijn opgesteld door de gebruiker en moeten ALTIJD worden nageleefd.**
**Datum: 2025-11-11**
