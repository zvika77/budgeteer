# OpenRouter AI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenRouter as a first-class AI provider so users can power both transaction categorization and the chat assistant with an OpenRouter API key.

**Architecture:** OpenRouter is OpenAI-compatible, reached via the `@openrouter/ai-sdk-provider` Vercel-AI-SDK provider. The same provider drives chat (existing AI-SDK path in `chat-model.ts`) and categorization (`generateText` from the installed `ai` package). A new `OpenRouterProvider` mirrors `GeminiProvider`; UI mirrors the existing Gemini surfaces in the setup wizard and settings, adding a curated model list plus a free-text custom-model field. A small pure helper module resolves the effective model id and validates the key, shared by both UI surfaces and unit-tested.

**Tech Stack:** Next.js 16, TypeScript strict, Vercel AI SDK (`ai`, `@openrouter/ai-sdk-provider`), better-sqlite3 settings, next-intl, Bun test.

---

### Task 1: Add dependency and types

**Files:**
- Modify: `package.json` (via `bun add`)
- Modify: `src/lib/types.ts` (add `OpenRouterModelInfo`, `RECOMMENDED_OPENROUTER_MODELS`, extend `AppSettings`)

- [ ] **Step 1: Install the provider package**

Run:
```bash
bun add @openrouter/ai-sdk-provider
```
Expected: package added to `dependencies` in `package.json`, no errors.

- [ ] **Step 2: Add the model-info type and curated list**

In `src/lib/types.ts`, directly after the `RECOMMENDED_GEMINI_MODELS` array (ends near line 690), add:

```typescript
export interface OpenRouterModelInfo {
  name: string;
  description: string;
  recommended?: boolean;
}

export const RECOMMENDED_OPENROUTER_MODELS: OpenRouterModelInfo[] = [
  {
    name: "anthropic/claude-3.5-haiku",
    description: "Fast, low-cost Claude. Best default for categorization.",
    recommended: true,
  },
  {
    name: "anthropic/claude-3.7-sonnet",
    description: "Higher-quality Claude for more nuanced categorization.",
  },
  {
    name: "openai/gpt-4o-mini",
    description: "Cheap, capable non-Anthropic option.",
  },
  {
    name: "google/gemini-2.0-flash-001",
    description: "Fast, budget-friendly Google option.",
  },
];
```

- [ ] **Step 3: Extend the provider union and settings shape**

In `src/lib/types.ts`, change the `AppSettings` interface:

```typescript
export interface AppSettings {
  currentBalance: number | null;
  balanceDate: string | null;
  monthsToSync: number;
  aiProvider: "claude" | "gemini" | "ollama" | "openrouter" | "none";
  geminiModel: string;
  openRouterModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  showBrowser: boolean;
  paydayDay: number;
  monthlyTarget: number | null;
  autoSyncEnabled: boolean;
  autoSyncTime: string;
  treatAtmAsTransfers: boolean;
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run tsc --noEmit`
Expected: errors only in files not yet updated (settings query, api.ts, UI). This is expected mid-task; the union/field changes themselves must not produce syntax errors in `types.ts`. If `types.ts` itself errors, fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src/lib/types.ts
git commit -m "feat: add OpenRouter dependency and types"
```

---

### Task 2: Pure helper module (TDD)

A small pure module shared by both UI surfaces and the setup validation. No `server-only` so it is importable by client components and by Bun tests (per project memory, only pure-logic modules are unit-testable).

**Files:**
- Create: `src/lib/openrouter.ts`
- Test: `src/lib/openrouter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/openrouter.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { isValidOpenRouterKey, resolveOpenRouterModel } from "@/lib/openrouter";

describe("resolveOpenRouterModel", () => {
  it("prefers a non-empty custom model id over the selected one", () => {
    expect(resolveOpenRouterModel("  openai/gpt-4o  ", "anthropic/claude-3.5-haiku")).toBe(
      "openai/gpt-4o",
    );
  });

  it("falls back to the selected model when custom is blank", () => {
    expect(resolveOpenRouterModel("   ", "anthropic/claude-3.5-haiku")).toBe(
      "anthropic/claude-3.5-haiku",
    );
  });

  it("returns an empty string when both are blank", () => {
    expect(resolveOpenRouterModel("", "")).toBe("");
  });
});

describe("isValidOpenRouterKey", () => {
  it("accepts keys with the sk-or- prefix", () => {
    expect(isValidOpenRouterKey("sk-or-v1-abc123")).toBe(true);
  });

  it("rejects keys without the prefix", () => {
    expect(isValidOpenRouterKey("sk-ant-api03-abc")).toBe(false);
    expect(isValidOpenRouterKey("")).toBe(false);
    expect(isValidOpenRouterKey("  sk-or-v1-abc  ")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/openrouter.test.ts`
Expected: FAIL — cannot find module `@/lib/openrouter`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/openrouter.ts`:

```typescript
export function resolveOpenRouterModel(custom: string, selected: string): string {
  const trimmed = custom.trim();
  return trimmed.length > 0 ? trimmed : selected;
}

export function isValidOpenRouterKey(key: string): boolean {
  return /^sk-or-/.test(key.trim());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/openrouter.test.ts`
Expected: PASS — 5 assertions across 5 `it` blocks.

- [ ] **Step 5: Commit**

```bash
git add src/lib/openrouter.ts src/lib/openrouter.test.ts
git commit -m "feat: add OpenRouter key and model helpers"
```

---

### Task 3: Server provider

**Files:**
- Create: `src/server/ai/providers/openrouter.ts`

- [ ] **Step 1: Write the provider**

Create `src/server/ai/providers/openrouter.ts`:

```typescript
import "server-only";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { parseCategorizationResponse } from "@/server/ai/lib/parse-response";
import { buildCategorizationPrompt, SYSTEM_PROMPT } from "@/server/ai/prompts";
import type {
  AIProvider,
  CategoryForCategorization,
  CategoryMapping,
  PastCorrection,
  TransactionForCategorization,
} from "@/server/ai/types";

export class OpenRouterProvider implements AIProvider {
  private model: ReturnType<ReturnType<typeof createOpenRouter>>;

  constructor(apiKey: string, modelId: string) {
    this.model = createOpenRouter({ apiKey })(modelId);
  }

  async categorize(
    transactions: TransactionForCategorization[],
    categories: CategoryForCategorization[],
    options?: { allowProposals?: boolean; pastCorrections?: PastCorrection[] },
  ): Promise<CategoryMapping[]> {
    const allowProposals = options?.allowProposals ?? false;
    const prompt = buildCategorizationPrompt(
      transactions,
      categories,
      allowProposals,
      options?.pastCorrections ?? [],
    );

    const { text } = await generateText({
      model: this.model,
      system: SYSTEM_PROMPT,
      prompt,
    });

    return parseCategorizationResponse(
      text,
      categories.map((c) => c.name),
      allowProposals,
    );
  }
}
```

- [ ] **Step 2: Typecheck the new file**

Run: `bun run tsc --noEmit`
Expected: no new errors originating from `src/server/ai/providers/openrouter.ts`. If `createOpenRouter`'s return type does not chain as written, adjust the `model` field type to `Parameters<typeof generateText>[0]["model"]` and assign `this.model = createOpenRouter({ apiKey }).chat(modelId)` or `(modelId)` per the installed package's API (inspect `node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts` to confirm the call signature).

- [ ] **Step 3: Commit**

```bash
git add src/server/ai/providers/openrouter.ts
git commit -m "feat: add OpenRouter categorization provider"
```

---

### Task 4: Wire factory and chat-model

**Files:**
- Modify: `src/server/ai/factory.ts`
- Modify: `src/server/ai/chat-model.ts`

- [ ] **Step 1: Add the factory branch**

In `src/server/ai/factory.ts`, add the import at the top with the other provider imports:

```typescript
import { OpenRouterProvider } from "@/server/ai/providers/openrouter";
```

Then add this branch immediately before the `if (provider === "ollama")` branch:

```typescript
  if (provider === "openrouter") {
    const encryptedKey = getSetting("ai_openrouter_key_encrypted");
    const iv = getSetting("ai_openrouter_key_iv");
    const authTag = getSetting("ai_openrouter_key_auth_tag");

    if (!encryptedKey || !iv || !authTag) return null;

    const apiKey = decrypt({
      encrypted: Buffer.from(encryptedKey, "hex"),
      iv: Buffer.from(iv, "hex"),
      authTag: Buffer.from(authTag, "hex"),
    });

    const model = getSetting("ai_openrouter_model") ?? RECOMMENDED_OPENROUTER_MODELS[0].name;
    return new OpenRouterProvider(apiKey, model);
  }
```

Update the existing top import from `@/lib/types` to also pull in the model list:

```typescript
import { RECOMMENDED_GEMINI_MODELS, RECOMMENDED_OPENROUTER_MODELS } from "@/lib/types";
```

- [ ] **Step 2: Add the chat-model branch**

In `src/server/ai/chat-model.ts`, add the import near the top:

```typescript
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
```

and extend the existing `@/lib/types` import:

```typescript
import { RECOMMENDED_GEMINI_MODELS, RECOMMENDED_OPENROUTER_MODELS } from "@/lib/types";
```

(If `RECOMMENDED_GEMINI_MODELS` is not currently imported in `chat-model.ts`, only add `RECOMMENDED_OPENROUTER_MODELS`.)

Add this branch immediately before the `if (provider === "ollama")` branch:

```typescript
  if (provider === "openrouter") {
    const encryptedKey = getSetting("ai_openrouter_key_encrypted");
    const iv = getSetting("ai_openrouter_key_iv");
    const authTag = getSetting("ai_openrouter_key_auth_tag");

    if (!encryptedKey || !iv || !authTag) return null;

    const apiKey = decrypt({
      encrypted: Buffer.from(encryptedKey, "hex"),
      iv: Buffer.from(iv, "hex"),
      authTag: Buffer.from(authTag, "hex"),
    });

    const model = getSetting("ai_openrouter_model") ?? RECOMMENDED_OPENROUTER_MODELS[0].name;
    return createOpenRouter({ apiKey })(model);
  }
```

- [ ] **Step 3: Typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors in `factory.ts` or `chat-model.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/server/ai/factory.ts src/server/ai/chat-model.ts
git commit -m "feat: wire OpenRouter into AI factory and chat model"
```

---

### Task 5: Surface the model in settings query

**Files:**
- Modify: `src/server/db/queries/settings.ts`

- [ ] **Step 1: Add the default constant and import**

In `src/server/db/queries/settings.ts`, update the `@/lib/types` import to include the OpenRouter list (it already imports `RECOMMENDED_GEMINI_MODELS`):

```typescript
import { RECOMMENDED_GEMINI_MODELS, RECOMMENDED_OPENROUTER_MODELS } from "@/lib/types";
```

Below the existing `DEFAULT_GEMINI_MODEL` constant (line 78), add:

```typescript
const DEFAULT_OPENROUTER_MODEL = RECOMMENDED_OPENROUTER_MODELS[0].name;
```

- [ ] **Step 2: Return the model in `getAppSettings`**

In the returned object of `getAppSettings` (after the `geminiModel` line), add:

```typescript
    openRouterModel: getGlobalSetting("ai_openrouter_model") ?? DEFAULT_OPENROUTER_MODEL,
```

- [ ] **Step 3: Typecheck**

Run: `bun run tsc --noEmit`
Expected: `settings.ts` satisfies `AppSettings` (the new required `openRouterModel` field is now present).

- [ ] **Step 4: Commit**

```bash
git add src/server/db/queries/settings.ts
git commit -m "feat: expose OpenRouter model in app settings"
```

---

### Task 6: Setup route and API client type

**Files:**
- Modify: `src/app/api/setup/ai/route.ts`
- Modify: `src/lib/api.ts` (`saveAIConfig` signature)

- [ ] **Step 1: Extend the route body and persistence**

In `src/app/api/setup/ai/route.ts`, change the body type and add validation + persistence.

Body type:

```typescript
  const body = (await request.json()) as {
    provider: "claude" | "gemini" | "ollama" | "openrouter" | "none";
    claudeApiKey?: string;
    geminiApiKey?: string;
    geminiModel?: string;
    openRouterApiKey?: string;
    openRouterModel?: string;
    ollamaUrl?: string;
    ollamaModel?: string;
  };
```

Add validation after the existing gemini check:

```typescript
  if (body.provider === "openrouter" && !body.openRouterApiKey) {
    return NextResponse.json({ error: "Enter an OpenRouter API key." }, { status: 400 });
  }
```

Add persistence after the gemini key block:

```typescript
  if (body.openRouterApiKey) {
    const { encrypted, iv, authTag } = encrypt(body.openRouterApiKey);
    setSetting("ai_openrouter_key_encrypted", encrypted.toString("hex"));
    setSetting("ai_openrouter_key_iv", iv.toString("hex"));
    setSetting("ai_openrouter_key_auth_tag", authTag.toString("hex"));
  }
```

Add the model persistence next to the `geminiModel` line:

```typescript
  if (body.openRouterModel) setSetting("ai_openrouter_model", body.openRouterModel);
```

- [ ] **Step 2: Extend `saveAIConfig` in the API client**

In `src/lib/api.ts`, change the `saveAIConfig` config type:

```typescript
export function saveAIConfig(config: {
  provider: "claude" | "gemini" | "ollama" | "openrouter" | "none";
  claudeApiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
}) {
```

(Leave the body unchanged — it already forwards the whole config as JSON.)

- [ ] **Step 3: Typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors in the route or `api.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/setup/ai/route.ts src/lib/api.ts
git commit -m "feat: persist OpenRouter config via setup route"
```

---

### Task 7: Setup wizard UI

**Files:**
- Modify: `src/components/setup/ai-step.tsx`

- [ ] **Step 1: Add provider metadata, tint, and state**

In `src/components/setup/ai-step.tsx`:

Add `"openrouter"` to the `AIChoice` union type:

```typescript
type AIChoice = "claude" | "gemini" | "ollama" | "openrouter" | "none";
```

Add a tint entry to `TINTS` (between `gemini` and `ollama`):

```typescript
  openrouter: { bg: "#e7dbf6", mid: "#a98ed8", ink: "#4a3370" },
```

Add a `PROVIDERS` entry after the `gemini` entry:

```typescript
  {
    id: "openrouter",
    titleKey: "aiProviderOpenRouterTitle",
    taglineKey: "aiProviderOpenRouterTagline",
    icon: "⊹",
  },
```

Add imports from helpers and types at the top:

```typescript
import { isValidOpenRouterKey, resolveOpenRouterModel } from "@/lib/openrouter";
```

and extend the `@/lib/types` import to include `RECOMMENDED_OPENROUTER_MODELS`.

Add state inside `AIStep`, next to the gemini state:

```typescript
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);
  const [openRouterModel, setOpenRouterModel] = useState(RECOMMENDED_OPENROUTER_MODELS[0].name);
  const [openRouterCustomModel, setOpenRouterCustomModel] = useState("");
```

- [ ] **Step 2: Compute the effective model and validation**

Below the existing `trimmedGeminiKey` line, add:

```typescript
  const trimmedOpenRouterKey = openRouterKey.trim();
  const effectiveOpenRouterModel = resolveOpenRouterModel(openRouterCustomModel, openRouterModel);
```

Extend `canContinue` by adding this clause to the `||` chain:

```typescript
    (choice === "openrouter" &&
      isValidOpenRouterKey(trimmedOpenRouterKey) &&
      effectiveOpenRouterModel.length > 0) ||
```

- [ ] **Step 3: Pass config in `handleSave`**

In the `saveAIConfig({ ... })` call inside `handleSave`, add:

```typescript
        openRouterApiKey: choice === "openrouter" ? trimmedOpenRouterKey : undefined,
        openRouterModel: choice === "openrouter" ? effectiveOpenRouterModel : undefined,
```

- [ ] **Step 4: Render the OpenRouter config block**

In the providers `.map`, add a render branch after the `{p.id === "gemini" && ( ... )}` block:

```tsx
                    {p.id === "openrouter" && (
                      <ApiKeyConfig
                        id="openrouter-api-key"
                        apiKey={openRouterKey}
                        setApiKey={setOpenRouterKey}
                        showKey={showOpenRouterKey}
                        setShowKey={setShowOpenRouterKey}
                        placeholder="sk-or-v1-..."
                        getKeyUrl="https://openrouter.ai/keys"
                      >
                        <OpenRouterModelPicker
                          model={openRouterModel}
                          setModel={setOpenRouterModel}
                          customModel={openRouterCustomModel}
                          setCustomModel={setOpenRouterCustomModel}
                        />
                      </ApiKeyConfig>
                    )}
```

- [ ] **Step 5: Add the `OpenRouterModelPicker` component**

Add this component next to `GeminiModelPicker`:

```tsx
function OpenRouterModelPicker({
  model,
  setModel,
  customModel,
  setCustomModel,
}: {
  model: string;
  setModel: (v: string) => void;
  customModel: string;
  setCustomModel: (v: string) => void;
}) {
  const t = useTranslations("setup");
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {t("aiOllamaPickModel")}
        </Label>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {RECOMMENDED_OPENROUTER_MODELS.map((m) => (
            <button
              key={m.name}
              type="button"
              onClick={() => {
                setModel(m.name);
                setCustomModel("");
              }}
              className={`rounded-lg border bg-background p-2 text-start transition-colors ${
                customModel.trim() === "" && model === m.name
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="truncate text-[11px] font-bold tracking-tight">{m.name}</span>
                {m.recommended && (
                  <span className="rounded-full bg-primary/10 px-1 py-0 text-[8px] font-bold uppercase tracking-wider text-primary">
                    {t("aiModelRecommendedBadge")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{m.description}</p>
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <Label
          htmlFor="openrouter-custom-model"
          className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground"
        >
          {t("aiOpenRouterCustomModelLabel")}
        </Label>
        <Input
          id="openrouter-custom-model"
          value={customModel}
          onChange={(e) => setCustomModel(e.target.value)}
          placeholder="anthropic/claude-3.5-haiku"
          className="font-mono text-[12px]"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck and lint-format**

Run: `bun run tsc --noEmit && bun run format`
Expected: no type errors; formatter rewrites as needed.

- [ ] **Step 7: Commit**

```bash
git add src/components/setup/ai-step.tsx
git commit -m "feat: add OpenRouter to setup wizard"
```

---

### Task 8: Settings UI

**Files:**
- Modify: `src/components/settings/ai-section.tsx`

- [ ] **Step 1: Add imports and state**

In `src/components/settings/ai-section.tsx`:

Extend the `@/lib/types` import to include `RECOMMENDED_OPENROUTER_MODELS`, and add:

```typescript
import { resolveOpenRouterModel } from "@/lib/openrouter";
```

In `AIForm`, add state next to the gemini state:

```typescript
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [openRouterModel, setOpenRouterModel] = useState(settings.openRouterModel);
  const [openRouterCustomModel, setOpenRouterCustomModel] = useState("");
```

Update `missingKey` to require a key for OpenRouter too:

```typescript
  const missingKey =
    (provider === "claude" && !apiKey) ||
    (provider === "gemini" && !geminiKey) ||
    (provider === "openrouter" && !openRouterKey);
```

- [ ] **Step 2: Send OpenRouter config in the mutation**

In the `saveAIConfig({ ... })` call, add:

```typescript
        openRouterApiKey: provider === "openrouter" && openRouterKey ? openRouterKey : undefined,
        openRouterModel:
          provider === "openrouter"
            ? resolveOpenRouterModel(openRouterCustomModel, openRouterModel)
            : undefined,
```

In the mutation `onSuccess`, also clear the key:

```typescript
      setOpenRouterKey("");
```

- [ ] **Step 3: Add the provider option button**

In the provider options array (the `[{ id: "claude" ... }, ...]` list), add after the `gemini` entry:

```typescript
            {
              id: "openrouter" as const,
              title: t("providerOpenRouterTitle"),
              desc: t("providerOpenRouterDesc"),
            },
```

Change the grid to fit five options — update the wrapper `className` on the grid `div` from `lg:grid-cols-4` to `lg:grid-cols-3`:

```tsx
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
```

- [ ] **Step 4: Render the OpenRouter card**

Add this block after the `{provider === "gemini" && ( ... )}` card:

```tsx
      {provider === "openrouter" && (
        <SettingCard
          title={t("openRouterKeyCardTitle")}
          description={t("openRouterKeyCardDescription")}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="openrouter-key">{t("apiKeyLabel")}</Label>
              <Input
                id="openrouter-key"
                type="password"
                value={openRouterKey}
                onChange={(e) => setOpenRouterKey(e.target.value)}
                placeholder="sk-or-v1-..."
              />
              <p className="text-xs text-muted-foreground">{t("apiKeyRequiredHint")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("modelLabel")}</Label>
              <Select
                value={openRouterModel}
                onValueChange={(v) => {
                  if (v) {
                    setOpenRouterModel(v);
                    setOpenRouterCustomModel("");
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {RECOMMENDED_OPENROUTER_MODELS.map((m) => (
                    <SelectItem key={m.name} value={m.name}>
                      {m.recommended ? `${m.name} (${t("recommendedTag")})` : m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {RECOMMENDED_OPENROUTER_MODELS.find((m) => m.name === openRouterModel)?.description ??
                  ""}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="openrouter-custom-model">{t("openRouterCustomModelLabel")}</Label>
              <Input
                id="openrouter-custom-model"
                value={openRouterCustomModel}
                onChange={(e) => setOpenRouterCustomModel(e.target.value)}
                placeholder="anthropic/claude-3.5-haiku"
              />
              <p className="text-xs text-muted-foreground">{t("openRouterCustomModelHint")}</p>
            </div>
          </div>
        </SettingCard>
      )}
```

- [ ] **Step 5: Typecheck and format**

Run: `bun run tsc --noEmit && bun run format`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/ai-section.tsx
git commit -m "feat: add OpenRouter to settings"
```

---

### Task 9: i18n keys

Add every new key to BOTH `src/i18n/messages/en.json` and `src/i18n/messages/he.json` so `bun run i18n:check` passes. Hebrew values are real translations (the app is English-first for Phase 1, but the key MUST exist in both files or the check fails).

**Files:**
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/he.json`

- [ ] **Step 1: Add `setup` namespace keys**

In the `"setup"` object of `en.json` (near the other `aiProvider*` keys, ~line 770), add:

```json
    "aiProviderOpenRouterTitle": "OpenRouter",
    "aiProviderOpenRouterTagline": "One key, hundreds of models (Claude, GPT, more)",
    "aiOpenRouterCustomModelLabel": "Or paste a model id",
```

In the `"setup"` object of `he.json`, add the same keys:

```json
    "aiProviderOpenRouterTitle": "OpenRouter",
    "aiProviderOpenRouterTagline": "מפתח אחד, מאות מודלים (Claude, GPT ועוד)",
    "aiOpenRouterCustomModelLabel": "או הדביקו מזהה מודל",
```

- [ ] **Step 2: Add `settings.ai` namespace keys**

In the `"settings"` -> `"ai"` object of `en.json` (near `providerGeminiTitle`, ~line 509), add:

```json
      "providerOpenRouterTitle": "OpenRouter",
      "providerOpenRouterDesc": "One key for Claude, GPT, Gemini, and more. Bring your own OpenRouter key.",
      "openRouterKeyCardTitle": "OpenRouter API key",
      "openRouterKeyCardDescription": "Paste your key from openrouter.ai/keys. It's encrypted at rest with AES-256-GCM.",
      "openRouterCustomModelLabel": "Custom model id",
      "openRouterCustomModelHint": "Optional. Overrides the picker above with any OpenRouter model id.",
```

In the `"settings"` -> `"ai"` object of `he.json`, add:

```json
      "providerOpenRouterTitle": "OpenRouter",
      "providerOpenRouterDesc": "מפתח אחד ל-Claude, GPT, Gemini ועוד. השתמשו במפתח OpenRouter שלכם.",
      "openRouterKeyCardTitle": "מפתח API של OpenRouter",
      "openRouterKeyCardDescription": "הדביקו את המפתח מ-openrouter.ai/keys. מאוחסן מוצפן עם AES-256-GCM.",
      "openRouterCustomModelLabel": "מזהה מודל מותאם",
      "openRouterCustomModelHint": "אופציונלי. דורס את הבחירה למעלה עם כל מזהה מודל של OpenRouter.",
```

- [ ] **Step 3: Run the i18n check**

Run: `bun run i18n:check`
Expected: PASS — no missing or orphan keys. If it reports a missing key, the same key is absent from one of the two files; add it there.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/messages/en.json src/i18n/messages/he.json
git commit -m "feat: add OpenRouter i18n strings"
```

---

### Task 10: Full CI gate and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full CI gate**

Run: `bun run ci`
Expected: PASS for format:check, i18n:check, knip, react:doctor, and tests. Common failures and fixes:
- knip "unused" on `RECOMMENDED_OPENROUTER_MODELS` or helpers — confirm they are imported in the UI files from Tasks 7 and 8.
- knip "unlisted dependency" — confirm `@openrouter/ai-sdk-provider` is in `package.json` `dependencies` (Task 1).
- format:check — run `bun run format` and re-commit.

- [ ] **Step 2: Manual end-to-end check (dev server)**

Run: `bun dev` (serves on 127.0.0.1:3000).

Verify, with a real OpenRouter key:
1. Settings -> AI: select OpenRouter, paste a `sk-or-` key, pick `anthropic/claude-3.5-haiku`, Save. Confirm the success toast and that reloading shows OpenRouter selected with the chosen model.
2. Open the chat assistant, send a message, confirm a response streams back (this exercises `chat-model.ts`).
3. Trigger a sync (or re-categorize) with uncategorized transactions present and confirm categories are assigned (this exercises `OpenRouterProvider.categorize`).
4. In the custom-model field, enter `openai/gpt-4o-mini`, Save, and confirm chat still responds (this exercises `resolveOpenRouterModel` override).

- [ ] **Step 3: Update README + screenshots (per CLAUDE.md PR rules)**

If the setup/settings screens are shown in `README.md` or `public/screenshots/*.png`, regenerate the affected screenshots from a throwaway MOCK database (`BUDGETEER_DATA_DIR` pointed at synthetic data — never real account data) and update any README copy that lists AI providers to mention OpenRouter.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "docs: mention OpenRouter provider in README"
```

(Skip this commit if no README/screenshot changes were needed.)

---

## Notes for the implementer

- Per project memory, `better-sqlite3` will not load under `bun test`; only the pure-logic helper in Task 2 is unit-tested. Everything else is verified via `tsc`, the CI gate, and the manual dev-server checks in Task 10.
- Follow project conventions strictly: `import "server-only"` at the top of every `src/server/` file, no comments anywhere, no em dashes, conventional commit messages, no lint/type suppression directives.
- The branch `feat/openrouter-provider` is already checked out.
