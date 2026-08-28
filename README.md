# Prototype — AI Website Generator

Describe a website (or attach a design image) and get a live, animated HTML prototype in the browser.

## Setup

1. Install dependencies (`Node 20+` required):

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in keys:

   ```bash
   copy .env.example .env.local
   ```

   | Variable | Required | Where to get it |
   | --- | --- | --- |
   | `GEMINI_API_KEY` | Yes | [Google AI Studio](https://aistudio.google.com/apikey) |
   | `PEXELS_API_KEY` | Recommended | [Pexels API](https://www.pexels.com/api/) — real photos in generated pages |
   | `BLOB_READ_WRITE_TOKEN` | Only for Figma export | Vercel → Storage → Blob |
   | `GEMINI_MODEL` | Optional | Defaults to `gemini-3.6-flash`. Set `gemini-2.5-flash` if your key cannot use 3.6 |

3. Run locally:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000

## Deploy on Vercel

This is a Next.js app. Connect the GitHub repo in Vercel, then:

1. **Environment variables** (Project → Settings → Environment Variables) — set at least `GEMINI_API_KEY` and `PEXELS_API_KEY` for Production, Preview, and Development. Redeploy after saving.
2. **Node.js** — Vercel should pick Node 20 from `.nvmrc`. If the build fails on Node 18, set Node.js Version to **20.x** in Project Settings.
3. **Do not** set `ANTHROPIC_API_KEY`. This app uses Gemini.
4. **Figma export** — add a Blob store so `BLOB_READ_WRITE_TOKEN` exists. Download HTML still works without it.

If generation fails on the live site, the most common causes are:

- Keys added only locally, not in Vercel
- Gemini quota / invalid key
- Prompt too large, so the function hits the 60s limit — try a shorter description

## How it works

- Chat + live preview in `app/page.tsx`
- Gemini generates one self-contained HTML page in `app/api/generate/route.ts`
- `src="pexels:query"` markers are replaced with real Pexels photos
- Follow-up messages send the current HTML back so you can refine
- Multi-page nav uses `#page:slug` links inside the iframe
