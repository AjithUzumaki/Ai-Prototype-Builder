# Prototype — AI Website Generator

Describe a website (or attach a design image), and get back a live, animated,
clickable HTML/CSS/JS prototype rendered right in the browser.

## How it works

- **Frontend** (`app/page.tsx`): a chat UI on the left, a live preview `<iframe>` on the right.
- **Backend** (`app/api/generate/route.ts`): a Next.js API route that calls the
  Anthropic API with your prompt (and image, if attached) and asks it to return
  one complete, self-contained HTML file with inline CSS/JS and real animations.
- **Refine loop**: every follow-up message sends the *current* generated code back
  to the model along with your new instruction, so you can iterate ("make the
  hero animation slower", "switch to a dark theme") without starting over.
- The generated HTML renders in a sandboxed `<iframe>` — this is what makes it a
  real, interactive prototype rather than a screenshot.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Add your Anthropic API key**

   Copy `.env.example` to `.env.local` and paste in your key:

   ```bash
   cp .env.example .env.local
   ```

   Get a key at https://console.anthropic.com (Anthropic API, not claude.ai).

3. **Run it locally**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000

## Deploying

This is a standard Next.js app — the easiest path is
[Vercel](https://vercel.com):

```bash
npm i -g vercel
vercel
```

Add `ANTHROPIC_API_KEY` as an environment variable in your Vercel project
settings (Project → Settings → Environment Variables). Never commit your real
`.env.local` — it's already in `.gitignore`.

## Where to take it next

- **Auth + saved projects**: add a database (Supabase/Postgres is fastest) and
  save `{ prompt, image, code }` per user so people can come back to past
  prototypes.
- **Streaming**: switch the API route to `anthropic.messages.stream(...)` and
  stream tokens to the frontend so the code appears as it's generated instead
  of all at once.
- **Export as React**: add a second model call that converts the generated
  HTML into a React component, for users who want real code to build on.
- **Templates/starting styles**: let users pick a starting aesthetic
  (minimal, brutalist, playful) that gets folded into the system prompt.
- **Rate limiting**: since every generation costs API credits, add per-user
  limits before you open this up publicly (Vercel KV or Upstash work well for
  simple rate limiting).

## Cost note

Each generation is one API call with up to 8000 output tokens (more if you
attach images). Check current Claude API pricing at
https://docs.claude.com before setting usage limits for real users.
