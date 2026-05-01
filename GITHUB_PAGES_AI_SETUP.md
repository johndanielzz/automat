# MAT AI If Your Frontend Is On GitHub Pages

If your public website pages are hosted on `github.io`, the MAT AI page cannot call NVIDIA directly from the browser because the API key must stay private.

## Correct setup

- Frontend pages: GitHub Pages
- AI backend: Vercel
- MAT AI page calls the Vercel API URL

## 1. Deploy the backend to Vercel

Deploy this same repo to Vercel and make sure these endpoints work:

- `/api/health`
- `/api/mat-ai/context`
- `/api/mat-ai/chat`

Example backend URL:

`https://mat-auto-ai.vercel.app`

## 2. Point the GitHub Pages frontend at that backend

Open `mat-ai.html` and set:

```html
<meta name="mat-ai-api-base" content="https://mat-auto-ai.vercel.app">
```

That tells the frontend exactly where the live MAT AI backend is.

## 3. Redeploy GitHub Pages

After that, `mat-ai.html` on GitHub Pages will send AI requests to your Vercel backend instead of trying to find a same-origin `/api` route that does not exist on GitHub Pages.

## Important

Do not put `NVIDIA_API_KEY` in frontend JavaScript or HTML.

Keep it only in Vercel environment variables.
