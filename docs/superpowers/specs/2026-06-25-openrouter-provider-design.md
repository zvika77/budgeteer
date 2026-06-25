# OpenRouter AI provider

## Goal

Let users power Budgeteer's AI features with an OpenRouter API key, giving
access to Claude, GPT, Gemini, and many other models through a single key. This
is a first-class AI provider alongside Claude, Gemini, and Ollama, with full
parity: it powers both transaction categorization during sync and the chat
assistant.

## Background

OpenRouter exposes an OpenAI-compatible API at `https://openrouter.ai/api/v1`,
not the Anthropic Messages API. The existing `@anthropic-ai/sdk` and
`@ai-sdk/anthropic` clients point at `https://api.anthropic.com` and reject an
OpenRouter key (`sk-or-...`) with a 401, and cannot be repointed because the
request/response formats differ. OpenRouter therefore needs its own provider.

## Dependency

Add `@openrouter/ai-sdk-provider`. It returns a Vercel AI SDK provider usable
for both:

- Chat (already AI-SDK based via `createChatModel`).
- Categorization, via `generateText` from the already-installed `ai` package.

This avoids pulling in a separate `openai` SDK. One new dependency only.

## Server layer

### `src/server/ai/providers/openrouter.ts`

`OpenRouterProvider implements AIProvider`. Constructor takes `(apiKey, model)`.
`categorize()` reuses the shared `SYSTEM_PROMPT`, `buildCategorizationPrompt`,
and `parseCategorizationResponse` exactly like `GeminiProvider`. It calls
`generateText` from `ai` with `createOpenRouter({ apiKey })(model)`, passing the
system prompt and user prompt, then parses the returned text.

### `src/server/ai/factory.ts`

Add an `openrouter` branch. Read `ai_openrouter_key_encrypted` / `_iv` /
`_auth_tag` (decrypt), and `ai_openrouter_model`. Return
`new OpenRouterProvider(apiKey, model)`. If key settings are missing, return
`null` (same contract as Claude/Gemini).

### `src/server/ai/chat-model.ts`

Add an `openrouter` branch. Decrypt the key the same way, read the model, and
return `createOpenRouter({ apiKey })(model)`.

## Settings keys

- `ai_openrouter_key_encrypted`, `ai_openrouter_key_iv`,
  `ai_openrouter_key_auth_tag` (AES-256-GCM via existing `encrypt`/`decrypt`).
- `ai_openrouter_model` (plaintext).

## Types

- Extend the provider union (`"claude" | "gemini" | "ollama" | "none"`) to
  include `"openrouter"` everywhere it appears: `saveAIConfig` in
  `src/lib/api.ts`, the POST body type in `src/app/api/setup/ai/route.ts`, and
  the `AIChoice` types in `ai-step.tsx` and `ai-section.tsx`.
- Add `RECOMMENDED_OPENROUTER_MODELS` to `src/lib/types.ts`, mirroring
  `RECOMMENDED_GEMINI_MODELS` (`{ name, description, recommended? }`):
  - `anthropic/claude-3.5-haiku` — recommended, default. Cheap, matches the
    current Claude default behavior.
  - `anthropic/claude-3.7-sonnet` — higher quality.
  - `openai/gpt-4o-mini` — cheap non-Anthropic option.
  - `google/gemini-2.0-flash-001` — fast Google option.

## Setup route (`/api/setup/ai`)

Accept `openRouterApiKey` and `openRouterModel` in the body. If
`provider === "openrouter"` and no key is supplied, return a 400 ("Enter an
OpenRouter API key."). When a key is present, encrypt and store it under the
`ai_openrouter_key_*` settings. Store `openRouterModel` under
`ai_openrouter_model`.

## UI

Both the setup wizard (`src/components/setup/ai-step.tsx`) and settings
(`src/components/settings/ai-section.tsx`) get an OpenRouter provider row.

- New tint entry in `TINTS` and a `ProviderMeta` entry in `PROVIDERS` (icon,
  title/tagline i18n keys, not marked recommended).
- Reuse the existing `ApiKeyConfig` component. Placeholder `sk-or-v1-...`, get
  key link `https://openrouter.ai/keys`.
- Inside `ApiKeyConfig`, render an OpenRouter model section: curated cards in
  the `GeminiModelPicker` pattern, plus a free-text "or paste a model id" input
  that, when non-empty, overrides the card selection. The effective model id is
  the custom field if filled, otherwise the selected card.
- State: `openRouterKey`, `showOpenRouterKey`, `openRouterModel` (selected
  card), `openRouterCustomModel` (free text).
- Validation (`canContinue`): key matches `/^sk-or-/` and the effective model id
  is non-empty.
- `handleSave` passes `openRouterApiKey` and `openRouterModel` (the effective
  id) when the choice is `openrouter`.

## i18n

Add new keys to every locale file under `messages/` so `bun run i18n:check`
passes: provider title, tagline, key label, get-key link text, model-picker
label, and custom-model field label/placeholder. Reuse existing shared keys
(encrypted note, show/hide) where they already exist.

## Error handling

OpenRouter API errors surface the same way as the other providers:

- Chat: failures propagate through the existing SSE/route error path; the
  "AI provider not configured" 400 already covers a missing/invalid config.
- Categorization: per-batch failures are already swallowed by the sync flow, so
  a bad key or unknown model degrades to "uncategorized" rather than crashing
  the sync.

## Out of scope

- Live model listing from the OpenRouter API (the curated list + custom field
  covers it).
- Per-model pricing display.
- Migrating Claude/Gemini to go through OpenRouter.

## Verification

- `bun run ci` (format, typecheck, i18n, knip, react-doctor, tests).
- Manual: configure OpenRouter in the setup wizard and settings, run a sync to
  confirm categorization, and send a chat message to confirm the assistant
  responds. Per CLAUDE.md, regenerate any affected README screenshots from mock
  data in the same PR.
