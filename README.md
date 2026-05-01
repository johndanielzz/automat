# MAT Auto

Mat Auto is a static-first automotive marketplace with a server-backed MAT AI assistant for:

- car issue diagnosis
- car photo analysis
- part recommendations
- website/order/help questions

## Important hosting note

GitHub Pages alone cannot run MAT AI securely because the NVIDIA API key must stay on the server.

Use this setup:

- GitHub: store the code
- Vercel: host the website and `/api/*` backend

## Publish flow

1. Push the `automat-main` folder to a GitHub repository
2. Import that GitHub repository into Vercel
3. If Vercel asks for a root directory, choose `automat-main`
4. Add these environment variables in Vercel:
   - `NVIDIA_API_KEY`
   - `MAT_AI_MODEL`
   - `MAT_AUTO_FIREBASE_DATABASE_URL`
   - `MAT_AI_CONFIG_SECRET`
   - `MAT_AI_SETUP_KEY`
5. Deploy

## Runtime AI key upload

If you do not want to keep the provider key only in deploy-time environment variables, the backend now supports an admin runtime upload flow.

Required backend env vars:

- `MAT_AI_CONFIG_SECRET`
- `MAT_AI_SETUP_KEY`

Then open `admin.html`, go to `AI Settings`, enter:

- your backend URL
- your backend setup key
- your AI provider key

The backend stores the provider key encrypted in Firebase and uses it for MAT AI chat requests.

## AI setup files

- `mat-ai.html`
- `mat-ai.js`
- `mat-ai.css`
- `server.js`
- `api/[...path].js`
- `vercel.json`

## Deployment guides

- `DEPLOY_GITHUB_VERCEL.md`
- `GITHUB_PAGES_AI_SETUP.md`
