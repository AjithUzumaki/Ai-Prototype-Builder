"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  text: string;
};

type SitePage = {
  slug: string;
  label: string;
  code: string;
};

type Viewport = "desktop" | "tablet" | "mobile";
type Panel = "chat" | "preview";

const STYLE_PRESETS = [
  { id: "", label: "Auto" },
  { id: "Editorial / magazine — large type, generous whitespace, serif headlines", label: "Editorial" },
  { id: "Soft luxury — cream, charcoal, gold accents, slow elegant motion", label: "Luxury" },
  { id: "Playful product — bold color, rounded cards, bouncy micro-interactions", label: "Playful" },
  { id: "Brutalist — raw type, hard edges, high contrast, almost no decoration", label: "Brutalist" },
  { id: "Calm SaaS — cool neutrals, clear hierarchy, product-demo feel", label: "SaaS" },
];

const EXAMPLE_PROMPTS = [
  "A boutique coffee roaster in Kyoto — hero with steam, tasting notes, and a shop CTA",
  "Portfolio for a motion designer — dark, cinematic, case-study grid",
  "Wellness retreat landing — soft greens, booking form, slow scroll reveals",
];

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "page"
  );
}

function withNavBridge(html: string): string {
  const bridge = `
<script>
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#page:"]') : null;
    if (!a) return;
    e.preventDefault();
    var slug = a.getAttribute("href").slice(6);
    if (window.parent) {
      window.parent.postMessage({ type: "ppb-navigate", slug: slug }, "*");
    }
  });
</script>`;
  const lower = html.toLowerCase();
  const idx = lower.lastIndexOf("</body>");
  if (idx === -1) return html + bridge;
  return html.slice(0, idx) + bridge + html.slice(idx);
}

export default function Home() {
  const [pages, setPages] = useState<SitePage[]>([
    { slug: "home", label: "Home", code: "" },
  ]);
  const [activeSlug, setActiveSlug] = useState("home");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Describe the website you want, or attach a design image. Add more pages with the + tab — nav links between pages will work automatically.",
    },
  ]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<{ base64: string; mediaType: string; name: string } | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingPage, setAddingPage] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [stylePreset, setStylePreset] = useState("");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [mobilePanel, setMobilePanel] = useState<Panel>("chat");
  const [setup, setSetup] = useState<{ gemini: boolean; pexels: boolean; blob: boolean } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newPageInputRef = useRef<HTMLInputElement>(null);

  const [figmaLoading, setFigmaLoading] = useState(false);
  const [figmaPopupUrl, setFigmaPopupUrl] = useState<string | null>(null);
  const figmaPopupRef = useRef<HTMLDivElement>(null);

  const activePage = pages.find((p) => p.slug === activeSlug)!;

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then(setSetup)
      .catch(() => setSetup(null));
  }, []);

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || e.data.type !== "ppb-navigate") return;
      const slug = e.data.slug as string;
      setPages((prev) => {
        if (prev.some((p) => p.slug === slug)) return prev;
        const label = slug
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        return [...prev, { slug, label, code: "" }];
      });
      setActiveSlug(slug);
      setMobilePanel("preview");
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (figmaPopupRef.current && !figmaPopupRef.current.contains(e.target as Node)) {
        setFigmaPopupUrl(null);
      }
    }
    if (figmaPopupUrl) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [figmaPopupUrl]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      setImage({ base64, mediaType: file.type, name: file.name });
    };
    reader.readAsDataURL(file);
  }

  const lastPromptRef = useRef<string>("");
  const lastImageRef = useRef<{ base64: string; mediaType: string; name: string } | null>(null);

  async function performGenerate(
    promptText: string,
    imgOverride?: { base64: string; mediaType: string; name: string } | null
  ) {
    setError(null);
    setLoading(true);
    setMobilePanel("preview");

    const otherPages = pages
      .filter((p) => p.slug !== activeSlug)
      .map((p) => ({ slug: p.slug, label: p.label }));

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptText,
          imageBase64: imgOverride?.base64,
          imageMediaType: imgOverride?.mediaType,
          previousCode: activePage.code || undefined,
          currentPageLabel: activePage.label,
          otherPages,
          stylePreset: stylePreset || undefined,
        }),
      });

      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error(
          "The server did not return JSON. On Vercel this usually means a timeout or missing GEMINI_API_KEY. Try a shorter prompt, then check env vars."
        );
      }

      if (!res.ok) {
        throw new Error(data.error || "Generation failed");
      }

      setPages((prev) =>
        prev.map((p) => (p.slug === activeSlug ? { ...p, code: data.code } : p))
      );
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: activePage.code
            ? `Updated "${activePage.label}" — check the preview.`
            : `Here's your "${activePage.label}" page — check the preview.`,
        },
      ]);
      setImage(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Couldn't generate that: ${err.message}` },
      ]);
      setMobilePanel("chat");
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!input.trim() && !image) return;
    const promptText = input.trim() || "Build a prototype based on the attached image.";

    lastPromptRef.current = promptText;
    lastImageRef.current = image;

    setMessages((m) => [...m, { role: "user", text: promptText }]);
    setInput("");

    await performGenerate(promptText, image);
  }

  async function handleRetry() {
    if (loading || !lastPromptRef.current) return;
    setMessages((m) => [...m, { role: "user", text: `Retry: ${lastPromptRef.current}` }]);
    await performGenerate(lastPromptRef.current, lastImageRef.current);
  }

  function handleClearChat() {
    setMessages([
      {
        role: "assistant",
        text: "Describe the website you want, or attach a design image. Add more pages with the + tab — nav links between pages will work automatically.",
      },
    ]);
    setError(null);
    setInput("");
    setImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleDownload() {
    if (!activePage.code) return;
    const blob = new Blob([activePage.code], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activePage.slug}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopyForFigma() {
    if (!activePage.code || figmaLoading) return;
    setFigmaLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/save-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: activePage.code, slug: activePage.slug }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to prepare Figma link");
      }

      await navigator.clipboard.writeText(data.url);
      setFigmaPopupUrl(data.url);
    } catch (err: any) {
      setError(err.message || "Couldn't prepare the Figma link.");
    } finally {
      setFigmaLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function confirmNewPage() {
    const label = newPageName.trim();
    if (!label) {
      setAddingPage(false);
      return;
    }
    const slug = slugify(label);
    setPages((prev) => {
      if (prev.some((p) => p.slug === slug)) return prev;
      return [...prev, { slug, label, code: "" }];
    });
    setActiveSlug(slug);
    setNewPageName("");
    setAddingPage(false);
  }

  const previewHtml = useMemo(
    () => (activePage.code ? withNavBridge(activePage.code) : ""),
    [activePage.code]
  );

  const viewportWidth =
    viewport === "mobile" ? "390px" : viewport === "tablet" ? "768px" : "100%";

  return (
    <main className="h-screen w-screen flex flex-col md:flex-row bg-ink text-paper font-body overflow-hidden">
      <div className="md:hidden flex border-b border-line">
        <button
          type="button"
          onClick={() => setMobilePanel("chat")}
          className={`flex-1 py-3 text-xs uppercase tracking-wider ${
            mobilePanel === "chat" ? "text-violet border-b-2 border-violet" : "text-mist"
          }`}
        >
          Chat
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel("preview")}
          className={`flex-1 py-3 text-xs uppercase tracking-wider ${
            mobilePanel === "preview" ? "text-violet border-b-2 border-violet" : "text-mist"
          }`}
        >
          Preview
        </button>
      </div>

      <section
        className={`${
          mobilePanel === "chat" ? "flex" : "hidden"
        } md:flex w-full md:w-[400px] shrink-0 border-r border-line flex-col min-h-0`}
      >
        <header className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-semibold tracking-tight">Prototype</h1>
            <p className="text-xs text-mist mt-0.5">Describe it. Sketch it. Watch it animate.</p>
          </div>
          <button
            onClick={handleClearChat}
            className="shrink-0 text-xs px-2.5 py-1.5 rounded-md border border-line text-mist hover:text-paper hover:border-mist transition-colors"
            type="button"
          >
            Clear
          </button>
        </header>

        {setup && !setup.gemini && (
          <div className="mx-4 mt-4 text-xs leading-relaxed rounded-md border border-amber/40 bg-amber/10 text-amber px-3 py-2">
            Gemini is not configured on this deployment. Add <span className="font-mono">GEMINI_API_KEY</span> in Vercel env vars and redeploy.
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="text-[11px] text-mist font-mono uppercase tracking-wider">
            Editing: <span className="text-violet">{activePage.label}</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setStylePreset(preset.id)}
                className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                  stylePreset === preset.id
                    ? "border-violet text-violet bg-violet/10"
                    : "border-line text-mist hover:text-paper"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {messages.map((m, i) => (
            <div
              key={i}
              className={`text-sm leading-relaxed ${
                m.role === "user" ? "text-paper" : "text-mist"
              }`}
            >
              <span className="block text-[10px] uppercase tracking-wider mb-1 text-violet font-mono">
                {m.role === "user" ? "You" : "Prototype"}
              </span>
              {m.text}
            </div>
          ))}

          {!activePage.code && !loading && messages.length < 3 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-mist font-mono">
                Try one
              </div>
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setInput(prompt)}
                  className="block w-full text-left text-xs text-mist border border-line rounded-md px-3 py-2 hover:border-violet hover:text-paper transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {loading && (
            <div className="space-y-2">
              <div className="flex gap-1.5 items-center pt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-violet pulse-dot" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-violet pulse-dot" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-violet pulse-dot" style={{ animationDelay: "300ms" }} />
              </div>
              <p className="text-xs text-mist">Building the page — this can take 20–40 seconds.</p>
            </div>
          )}
        </div>

        <div className="border-t border-line p-4 space-y-2">
          {image && (
            <div className="flex items-center justify-between text-xs bg-panel border border-line rounded-md px-3 py-2">
              <span className="truncate text-mist font-mono">{image.name}</span>
              <button
                onClick={() => setImage(null)}
                className="text-mist hover:text-paper ml-2"
                aria-label="Remove image"
              >
                ✕
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 h-10 w-10 rounded-md border border-line hover:border-violet flex items-center justify-center text-mist hover:text-violet transition-colors"
              aria-label="Attach image"
              type="button"
            >
              +
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleFileChange}
            />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                activePage.code
                  ? `Refine "${activePage.label}"...`
                  : `Describe the "${activePage.label}" page...`
              }
              rows={2}
              className="flex-1 resize-none bg-panel border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-violet transition-colors placeholder:text-mist/60"
            />
            <button
              onClick={handleSend}
              disabled={loading}
              className="shrink-0 h-10 px-4 rounded-md bg-violet text-ink font-medium text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
              type="button"
            >
              {loading ? "..." : "Send"}
            </button>
          </div>
          {error && (
            <div className="space-y-2">
              <p className="text-xs text-amber">{error}</p>
              <button
                onClick={handleRetry}
                disabled={loading}
                className="text-xs px-3 py-1.5 rounded-md border border-violet text-violet hover:bg-violet/10 disabled:opacity-40 transition-colors"
                type="button"
              >
                {loading ? "Retrying..." : "Retry"}
              </button>
            </div>
          )}
        </div>
      </section>

      <section
        className={`${
          mobilePanel === "preview" ? "flex" : "hidden"
        } md:flex flex-1 flex-col min-h-0`}
      >
        <header className="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 overflow-x-auto">
            {pages.map((p) => (
              <button
                key={p.slug}
                onClick={() => setActiveSlug(p.slug)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-md border transition-colors ${
                  p.slug === activeSlug
                    ? "border-violet text-violet bg-violet/10"
                    : "border-line text-mist hover:text-paper hover:border-mist"
                } ${!p.code ? "italic" : ""}`}
                type="button"
              >
                {p.label}
                {!p.code && " ·"}
              </button>
            ))}
            {addingPage ? (
              <input
                ref={newPageInputRef}
                autoFocus
                value={newPageName}
                onChange={(e) => setNewPageName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmNewPage();
                  if (e.key === "Escape") {
                    setAddingPage(false);
                    setNewPageName("");
                  }
                }}
                onBlur={confirmNewPage}
                placeholder="Page name..."
                className="shrink-0 text-xs px-3 py-1.5 rounded-md bg-panel border border-violet outline-none w-28"
              />
            ) : (
              <button
                onClick={() => setAddingPage(true)}
                className="shrink-0 text-xs px-2.5 py-1.5 rounded-md border border-line text-mist hover:text-violet hover:border-violet transition-colors"
                type="button"
                aria-label="Add page"
              >
                +
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex rounded-md border border-line overflow-hidden">
              {(["desktop", "tablet", "mobile"] as Viewport[]).map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setViewport(size)}
                  className={`text-[10px] px-2 py-1.5 capitalize ${
                    viewport === size ? "bg-violet/15 text-violet" : "text-mist"
                  }`}
                >
                  {size === "desktop" ? "Desk" : size === "tablet" ? "Tab" : "Mob"}
                </button>
              ))}
            </div>

            <div className="relative">
              <button
                onClick={handleCopyForFigma}
                disabled={!activePage.code || figmaLoading}
                className="shrink-0 text-xs px-3 py-1.5 rounded-md border border-line hover:border-violet disabled:opacity-30 transition-colors"
                type="button"
              >
                {figmaLoading ? "Preparing..." : "Copy for Figma"}
              </button>

              {figmaPopupUrl && (
                <div
                  ref={figmaPopupRef}
                  className="absolute right-0 z-50 mt-2 w-72 rounded-md border border-line bg-panel p-4 text-xs text-paper shadow-xl"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold text-paper">Link copied!</span>
                    <button
                      onClick={() => setFigmaPopupUrl(null)}
                      className="text-mist hover:text-paper"
                      aria-label="Close"
                      type="button"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="mb-2 text-mist">Bring this design into Figma as editable layers:</p>
                  <ol className="list-decimal space-y-1 pl-4 text-mist">
                    <li>Open Figma, go to Plugins</li>
                    <li>
                      Search for <span className="text-violet">html.to.design</span>
                    </li>
                    <li>Paste the copied link and click Import</li>
                  </ol>
                </div>
              )}
            </div>

            <button
              onClick={handleDownload}
              disabled={!activePage.code}
              className="shrink-0 text-xs px-3 py-1.5 rounded-md border border-line hover:border-violet disabled:opacity-30 transition-colors"
              type="button"
            >
              HTML
            </button>
          </div>
        </header>
        <div className="flex-1 bg-[#cfc8bf] flex items-stretch justify-center overflow-auto">
          {activePage.code ? (
            <iframe
              key={`${activeSlug}-${viewport}`}
              title={`preview-${activeSlug}`}
              srcDoc={previewHtml}
              sandbox="allow-scripts"
              className="h-full border-0 bg-white shadow-xl"
              style={{ width: viewportWidth, maxWidth: "100%" }}
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-ink/50 text-sm font-mono text-center px-8 bg-paper">
              {loading
                ? "Generating..."
                : `"${activePage.label}" hasn't been generated yet — describe it in the chat`}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
