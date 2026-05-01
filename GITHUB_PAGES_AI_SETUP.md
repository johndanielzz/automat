# MAT AI On GitHub Pages

If your public website pages are hosted on `github.io`, MAT AI now supports two valid modes.

## Option 1. GitHub smart mode only

This requires no backend.

What works:

- website help
- catalog-grounded part suggestions
- practical symptom guidance
- WhatsApp handoff

What is limited:

- no cloud LLM replies
- no true image understanding from uploaded photos

To use this mode, leave both of these blank:

```js
globalThis.__MAT_AI_API_BASE__ = "";
```

```html
<meta name="mat-ai-api-base" content="">
```

The page will load its own site knowledge plus the live Firebase catalog directly in the browser.

## Option 2. GitHub Pages + live backend

If you want advanced AI replies and real photo analysis, connect a backend.

Deploy this same repo to Vercel and make sure these endpoints work:

- `/api/health`
- `/api/mat-ai/context`
- `/api/mat-ai/chat`

Example backend URL:

`https://mat-auto-ai.vercel.app`

Then set either:

```js
globalThis.__MAT_AI_API_BASE__ = "https://mat-auto-ai.vercel.app";
```

or:

```html
<meta name="mat-ai-api-base" content="https://mat-auto-ai.vercel.app">
```

## Important

Do not put `NVIDIA_API_KEY` in frontend JavaScript or HTML.

Keep it only on the backend.
