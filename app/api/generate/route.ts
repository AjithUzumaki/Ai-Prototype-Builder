import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Free-tier Gemini model. See README for how to change this.
const MODEL = "gemini-3.6-flash";

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
7. For placeholder images, use https://picsum.photos/seed/<word>/<w>/<h> — never invent other external image URLs.
8. If asked to refine existing code, return the FULL updated HTML document with the requested change applied — never a diff or partial snippet.
9. Pick fonts from Google Fonts via a <link> tag if a distinctive typeface improves the design; otherwise use clean system fonts.
10. Give the design a real point of view (a considered palette, real type scale, one signature visual moment) rather than a generic template.
11. Keep scope realistic for a single response: one focused page (not a dozen dense sections) unless explicitly asked for a long page. Always finish the document completely — a valid ending </html> tag is mandatory, even if that means a simpler design.
12. Write markup so it converts cleanly into design tools (e.g. Figma import plugins):
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

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: buildSystemPrompt(otherPages || []),
        maxOutputTokens: 32000,
      },
    });

    const raw = response.text ?? "";
    const html = extractHtml(raw);

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

    return NextResponse.json({ code: html });
  } catch (err: any) {
    console.error("Generate error:", err);
    return NextResponse.json(
      { error: err?.message || "Generation failed" },
      { status: 500 }
    );
  }
}