# Deploy MAT Auto From GitHub To Vercel

This project is ready to be deployed from GitHub to Vercel, including the MAT AI backend at `/api/*`.

## What this setup does

- Serves your website pages directly from Vercel
- Runs the MAT AI backend as a Vercel serverless function
- Keeps the NVIDIA API key on the server side instead of exposing it in browser code

## Before you deploy

Make sure these files stay in the repo:

- `vercel.json`
- `api/[...path].js`
- `server.js`
- `mat-ai.html`
- `mat-ai.js`

Do not commit your local `.env` file.

## 1. Push the project to GitHub

Upload the `automat-main` project to a GitHub repository.

If this repo contains other folders too, set the Vercel project root to:

`automat-main`

## 2. Import the repo into Vercel

In Vercel:

1. Click `Add New...`
2. Click `Project`
3. Import your GitHub repository
4. If prompted for the Root Directory, choose `automat-main`

Framework preset:

- Use `Other`

Build settings:

- Build command: leave blank
- Output directory: leave blank
- Install command: `npm install`

## 3. Add environment variables in Vercel

In `Project Settings -> Environment Variables`, add:

- `NVIDIA_API_KEY`
- `MAT_AI_MODEL`
- `MAT_AUTO_FIREBASE_DATABASE_URL`

Recommended values:

- `MAT_AI_MODEL=meta/llama-4-maverick-17b-128e-instruct`
- `MAT_AUTO_FIREBASE_DATABASE_URL=https://automat-gm-default-rtdb.firebaseio.com`

## 4. Deploy

Once deployed, these should work on your Vercel domain:

- `/index.html`
- `/mat-ai.html`
- `/api/health`
- `/api/mat-ai/context`

## 5. Quick test after deploy

Open:

- `https://your-domain.vercel.app/api/health`

You should get JSON with `"status":"ok"`.

Then open:

- `https://your-domain.vercel.app/mat-ai.html`

MAT AI should load without asking for any terminal command.

## Common issues

### MAT AI shows HTML instead of JSON

Cause:

- the API function did not deploy correctly
- or the site is being opened from a static preview instead of the Vercel deployment

Fix:

- confirm `/api/health` returns JSON
- confirm the Vercel Root Directory is `automat-main` if needed
- confirm the environment variables are set

### MAT AI loads but cannot answer

Cause:

- missing `NVIDIA_API_KEY`
- invalid NVIDIA key
- missing Firebase database URL

Fix:

- recheck Vercel environment variables
- redeploy after saving env vars

### Catalog knowledge is incomplete

Cause:

- MAT AI only knows what is currently in your Firebase catalog

Fix:

- add more products in your live database through the admin flow

## Notes

GitHub Pages alone is not enough for this AI feature, because GitHub Pages is static hosting and cannot safely store the NVIDIA API key.

Official GitHub Pages docs:

- https://docs.github.com/pages/getting-started-with-github-pages/what-is-github-pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
