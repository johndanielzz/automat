"use strict";

// Point this to your live Vercel deployment only if the frontend is hosted
// somewhere different from the backend origin.
//
// Example:
// globalThis.__MAT_AI_API_BASE__ = "https://your-mat-auto-backend.vercel.app";
//
// Leave this blank when the full site is deployed on Vercel, because the
// public page and `/api/*` will already share the same origin.
globalThis.__MAT_AI_API_BASE__ = globalThis.__MAT_AI_API_BASE__ || "";
