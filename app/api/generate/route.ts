import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Free-tier Gemini model. See README for how to change this.
const MODEL = "gemini-3.6-flash";
// Used automatically if the primary model is overloaded — a currently
// supported, typically less congested model, as a reliability safety net.
const FALLBACK_MODEL = "gemini-2.5-flash-lite";

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

function buildSystemPrompt(otherPages: { slug: string; label: string }[]) {
  const pageList = otherPages.length
    ? otherPages.map((p) => `- slug: "${p.slug}", label: "${p.label}"`).join("\n")
    : "(none yet — this may be the only page so far)";

  return `You are a senior frontend engineer who builds interactive website prototypes as part of a MULTI-PAGE site.

Rules — follow exactly:
1. Output ONE complete, self-contained HTML document for THIS page only. Inline all CSS in a <style> tag and all JS in a <script> tag. No external frameworks, no external JS files.
2. Never use markdown code fences or any explanation text. Output raw HTML starting with <!DOCTYPE html> and nothing else, no preamble or trailing commentary.
3. Include real, working animations appropriate to the request: CSS transitions on hover/focus, scroll-triggered reveals (IntersectionObserver), smooth page-load entrance, and micro-interactions on buttons/links. Respect prefers-reduced-motion.
4. Make the layout fully responsive (mobile, tablet, desktop).
5. Use semantic HTML, visible keyboard focus states, and reasonable color contrast.
6. If an image is supplied, treat it as the design reference: match its layout, palette, and content as closely as possible.
7. For any image that should look like a real photograph (people, animals, nature, food, products, architecture, interiors, etc.), use this EXACT format for the src attribute: src="pexels:<short descriptive search phrase>" — for example src="pexels:lion in savanna" or src="pexels:fine dining plated steak" or src="pexels:modern minimalist living room". Write a specific, accurate search phrase that genuinely matches what the image should show — this will be used to fetch a real matching photo. Do NOT use picsum.photos or any other placeholder URL for photographic content.
8. For simple decorative or abstract placeholder shapes where the actual content doesn't matter (e.g. a generic colored block), you may use https://picsum.photos/seed/<word>/<w>/<h> — never invent other external image URLs.
9. If asked to refine existing code, return the FULL updated HTML document with the requested change applied — never a diff or partial snippet.
10. Pick fonts from Google Fonts via a <link> tag if a distinctive typeface improves the design; otherwise use clean system fonts.
11. Give the design a real point of view (a considered palette, real type scale, one signature visual moment) rather than a generic template.
12. Keep scope realistic for a single response: one focused page (not a dozen dense sections) unless explicitly asked for a long page. Always finish the document completely — a valid ending </html> tag is mandatory, even if that means a simpler design.
13. Write markup so it converts cleanly into design tools (e.g. Figma import plugins):
    - Prefer simple flexbox or CSS grid for layout; avoid complex nested positioning tricks.
    - Give every major section a clear, semantic class name (e.g. "hero-section", "nav-bar", "pricing-card") instead of generic or utility-soup class names.
    - Load fonts via a standard <link> tag (Google Fonts or system fonts); avoid custom @font-face or JS-injected font loading.
    - Avoid using ::before/::after pseudo-elements for anything visually important — use real HTML elements instead.
    - Keep nesting shallow — aim for no more than 3-4 div levels deep per section.

MULTI-PAGE NAVIGATION — important:
This page is part of a larger site. Other pages that already exist in this site:
${pageList}

- If this page's nav bar or content needs to link to one of those EXISTING pages, use an anchor tag with href="#page:<slug>" using the exact slug listed above. Example: <a href="#page:about">About</a>.
- If this page's design calls for a link to a page that does NOT exist yet (e.g. you're building a nav bar and want a "Contact" link but no contact page exists), you may still add it as href="#page:contact" using a sensible new slug (lowercase, hyphenated) — the app will offer to generate that page when the user clicks it. Only do this for genuinely useful additional pages, not a huge invented sitemap.
- For links to a section on THIS SAME page (not a different page), use a normal same-page anchor like href="#pricing" pointing at an element with that id — do not prefix these with "page:".
- Never use href="#page:" pointing at this page's own slug.`;
}

function extractHtml(raw: string): string {
  // Strip markdown fences if the model adds them despite instructions.
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  return candidate.trim();
}

// Finds src="pexels:<query>" occurrences and replaces them with real photo URLs.
async function resolvePexelsImages(html: string): Promise<string> {
  const regex = /src="pexels:([^"]+)"/g;
  const matches = Array.from(html.matchAll(regex));

  if (matches.length === 0) return html;

  if (!PEXELS_API_KEY) {
    // No key configured — fall back to picsum so the page still renders something.
    return html.replace(regex, (_match, query: string) => {
      const seed = encodeURIComponent(query.trim().replace(/\s+/g, "-"));
      return `src="https://picsum.photos/seed/${seed}/800/600"`;
    });
  }

  const uniqueQueries = Array.from(new Set(matches.map((m) => m[1].trim())));
  const queryToUrl = new Map<string, string>();

  await Promise.all(
    uniqueQueries.map(async (query) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(
          `https://api.pexels.com/v1/search?query=${encodeURIComponent(
            query
          )}&per_page=1&orientation=landscape`,
          {
            headers: { Authorization: PEXELS_API_KEY as string },
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);
        const data = await res.json();
        const photoUrl =
          data?.photos?.[0]?.src?.large2x ||
          data?.photos?.[0]?.src?.large ||
          data?.photos?.[0]?.src?.medium;

        if (photoUrl) {
          queryToUrl.set(query, photoUrl);
        } else {
          const seed = encodeURIComponent(query.replace(/\s+/g, "-"));
          queryToUrl.set(query, `https://picsum.photos/seed/${seed}/800/600`);
        }
      } catch {
        const seed = encodeURIComponent(query.replace(/\s+/g, "-"));
        queryToUrl.set(query, `https://picsum.photos/seed/${seed}/800/600`);
      }
    })
  );

  return html.replace(regex, (_match, query: string) => {
    const url = queryToUrl.get(query.trim()) || "https://picsum.photos/seed/fallback/800/600";
    return `src="${url}"`;
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      prompt,
      imageBase64,
      imageMediaType,
      previousCode,
      currentPageLabel,
      otherPages,
    } = body as {
      prompt: string;
      imageBase64?: string;
      imageMediaType?: string;
      previousCode?: string;
      currentPageLabel?: string;
      otherPages?: { slug: string; label: string }[];
    };

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    let instructionText = prompt;
    if (previousCode) {
      instructionText = `Here is the current full HTML for the "${currentPageLabel || "current"}" page:\n\n${previousCode}\n\nApply this change and return the full updated HTML document for this page:\n${prompt}`;
    } else if (currentPageLabel) {
      instructionText = `Generate the "${currentPageLabel}" page for this site.\n\n${prompt}`;
    }

    const parts: any[] = [{ text: instructionText }];

    if (imageBase64 && imageMediaType) {
      parts.push({
        inlineData: {
          data: imageBase64,
          mimeType: imageMediaType,
        },
      });
    }

    async function callModel(modelName: string) {
      return Promise.race([
        ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: buildSystemPrompt(otherPages || []),
            maxOutputTokens: 16000,
          },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("MODEL_TIMEOUT")), 15000)
        ),
      ]) as any;
    }

    function isOverloadError(err: any) {
      const msg = String(err?.message || err || "");
      return (
        msg === "MODEL_TIMEOUT" ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("503") ||
        msg.includes("overloaded")
      );
    }

    let response;
    let lastErr: any = null;

    // Attempt order: primary, primary again, then fallback model.
    // Total worst case stays comfortably under Vercel's 60s limit.
    const attempts = [MODEL, MODEL, FALLBACK_MODEL];

    for (let i = 0; i < attempts.length; i++) {
      try {
        response = await callModel(attempts[i]);
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err;
        if (!isOverloadError(err)) throw err;
        if (i < attempts.length - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    if (lastErr) {
      return NextResponse.json(
        {
          error:
            "The AI model is currently experiencing high demand across all available models. Please wait a minute and try again.",
        },
        { status: 503 }
      );
    }

    const raw = response.text ?? "";
    let html = extractHtml(raw);

    if (!html) {
      return NextResponse.json(
        { error: "Model returned no usable HTML" },
        { status: 502 }
      );
    }

    if (!html.trim().toLowerCase().endsWith("</html>")) {
      return NextResponse.json(
        {
          error:
            "The generated page got cut off before it finished (too ambitious for one response). Try a simpler or shorter description, or ask again.",
        },
        { status: 502 }
      );
    }

    // Replace pexels: markers with real, relevant photo URLs.
    html = await resolvePexelsImages(html);

    return NextResponse.json({ code: html });
  } catch (err: any) {
    console.error("Generate error:", err);
    return NextResponse.json(
      { error: err?.message || "Generation failed" },
      { status: 500 }
    );
  }
}