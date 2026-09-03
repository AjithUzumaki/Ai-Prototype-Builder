import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const FALLBACK_MODELS = [
  "gemini-2.5-flash-lite",
];

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it in Vercel → Project → Settings → Environment Variables, then redeploy."
    );
  }
  return new GoogleGenAI({ apiKey });
}

function buildSystemPrompt(
  otherPages: { slug: string; label: string }[],
  stylePreset?: string
) {
  const pageList = otherPages.length
    ? otherPages.map((p) => `- slug: "${p.slug}", label: "${p.label}"`).join("\n")
    : "(none yet — this may be the only page so far)";

  const styleHint = stylePreset
    ? `Visual direction for this page: ${stylePreset}. Commit to that aesthetic in type, color, spacing, and motion.`
    : "Give the design a real point of view (a considered palette, real type scale, one signature visual moment) rather than a generic template.";

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
11. ${styleHint}
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
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  return candidate.trim();
}

function responseText(response: any): string {
  if (typeof response?.text === "string" && response.text.trim()) {
    return response.text;
  }

  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .filter((part: any) => part && !part.thought && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("")
    .trim();
}

function looksComplete(html: string): boolean {
  const lower = html.trim().toLowerCase();
  return lower.includes("<!doctype html") && lower.endsWith("</html>");
}

async function resolvePexelsImages(html: string): Promise<string> {
  const regex = /src="pexels:([^"]+)"/g;
  const matches = Array.from(html.matchAll(regex));

  if (matches.length === 0) return html;

  if (!PEXELS_API_KEY) {
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
        const timeoutId = setTimeout(() => controller.abort(), 4000);

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
    const url =
      queryToUrl.get(query.trim()) || "https://picsum.photos/seed/fallback/800/600";
    return `src="${url}"`;
  });
}

function friendlyGeminiError(err: any): { message: string; status: number } {
  const msg = String(err?.message || err || "");
  const status = Number(err?.status || err?.statusCode || 0);

  if (msg.includes("GEMINI_API_KEY is not set")) {
    return { message: msg, status: 500 };
  }
  if (status === 401 || msg.includes("API_KEY_INVALID") || msg.includes("401")) {
    return {
      message:
        "Gemini rejected the API key. Check GEMINI_API_KEY in Vercel env vars (Google AI Studio key, not a Cloud service account).",
      status: 401,
    };
  }
  if (status === 429 || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("429")) {
    return {
      message:
        "Gemini rate limit hit. Wait a minute, or check quota in Google AI Studio.",
      status: 429,
    };
  }
  if (msg.includes("not found") || msg.includes("NOT_FOUND") || status === 404) {
    return {
      message:
        "The Gemini model name is not available on this key. Check GEMINI_MODEL is unset or valid in Vercel env vars.",
      status: 502,
    };
  }
  if (
    msg === "MODEL_TIMEOUT" ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("503") ||
    msg.includes("overloaded")
  ) {
    return {
      message:
        "The AI model is busy or timed out. Wait a moment and try a shorter prompt.",
      status: 503,
    };
  }

  return { message: msg || "Generation failed", status: 500 };
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
      stylePreset,
    } = body as {
      prompt: string;
      imageBase64?: string;
      imageMediaType?: string;
      previousCode?: string;
      currentPageLabel?: string;
      otherPages?: { slug: string; label: string }[];
      stylePreset?: string;
    };

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const ai = getClient();

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
      const isGemini3 = modelName.startsWith("gemini-3");
      return Promise.race([
        ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: buildSystemPrompt(otherPages || [], stylePreset),
            maxOutputTokens: 24000,
            ...(isGemini3
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
          },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("MODEL_TIMEOUT")), 45000)
        ),
      ]) as any;
    }

    function isRetryable(err: any) {
      const msg = String(err?.message || err || "");
      return (
        msg === "MODEL_TIMEOUT" ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("503") ||
        msg.includes("overloaded") ||
        msg.includes("NOT_FOUND") ||
        msg.includes("not found")
      );
    }

    let response;
    let lastErr: any = null;
    const attempts = [MODEL, ...FALLBACK_MODELS.filter((m) => m !== MODEL)];

    for (let i = 0; i < attempts.length; i++) {
      try {
        response = await callModel(attempts[i]);
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err;
        if (!isRetryable(err) || i === attempts.length - 1) {
          const mapped = friendlyGeminiError(err);
          return NextResponse.json(
            { error: mapped.message },
            { status: mapped.status }
          );
        }
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    if (lastErr) {
      const mapped = friendlyGeminiError(lastErr);
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    const raw = responseText(response);
    let html = extractHtml(raw);

    if (!html) {
      return NextResponse.json(
        { error: "Model returned no usable HTML. Try again with a shorter prompt." },
        { status: 502 }
      );
    }

    if (!looksComplete(html)) {
      return NextResponse.json(
        {
          error:
            "The generated page was cut off before it finished. Try a simpler description, or ask for fewer sections.",
        },
        { status: 502 }
      );
    }

    html = await resolvePexelsImages(html);

    return NextResponse.json({ code: html });
  } catch (err: any) {
    console.error("Generate error:", err);
    const mapped = friendlyGeminiError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}