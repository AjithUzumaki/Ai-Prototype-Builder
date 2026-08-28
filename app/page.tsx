"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  text: string;
};

type SitePage = {
  slug: string;
  label: string;
  code: string; // "" until generated
};

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "page";
}

// Injects a small script so clicks on internal nav links (href="#page:slug")
// talk to the parent app instead of doing nothing inside the sandboxed iframe.
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
      text: "Describe the website you want, or attach a design image. Add more pages with the + tab above the preview — nav links between pages will work automatically.",
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newPageInputRef = useRef<HTMLInputElement>(null);

  // Figma export state
  const [figmaLoading, setFigmaLoading] = useState(false);
  const [figmaPopupUrl, setFigmaPopupUrl] = useState<string | null>(null);
  const figmaPopupRef = useRef<HTMLDivElement>(null);

  const activePage = pages.find((p) => p.slug === activeSlug)!;

  // Listen for in-preview nav clicks and switch tabs (creating a blank page if needed).
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
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Close the Figma popup on outside click
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

  async function handleSend() {
    if (!input.trim() && !image) return;
    const promptText = input.trim() || "Build a prototype based on the attached image.";

    setMessages((m) => [...m, { role: "user", text: promptText }]);
    setInput("");
    setError(null);
    setLoading(true);

    const otherPages = pages
      .filter((p) => p.slug !== activeSlug)
      .map((p) => ({ slug: p.slug, label: p.label }));

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptText,
          imageBase64: image?.base64,
          imageMediaType: image?.mediaType,
          previousCode: activePage.code || undefined,
          currentPageLabel: activePage.label,
          otherPages,
        }),
      });

      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error(
          "Server had trouble responding — this usually means high demand right now. Please try again in a moment."
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
    } finally {
      setLoading(false);
    }
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

  return (
    <main className="h-screen w-screen flex bg-ink text-paper font-body overflow-hidden">
      {/* Chat panel */}
      <section className="w-[400px] shrink-0 border-r border-line flex flex-col">
        <header className="px-5 py-4 border-b border-line">
          <h1 className="font-display text-lg font-semibold tracking-tight">
            Prototype
          </h1>
          <p className="text-xs text-mist mt-0.5">
            Describe it. Sketch it. Watch it animate.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="text-[11px] text-mist font-mono uppercase tracking-wider">
            Editing: <span className="text-violet">{activePage.label}</span>
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
          {loading && (
            <div className="flex gap-1.5 items-center pt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-violet pulse-dot" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-violet pulse-dot" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-violet pulse-dot" style={{ animationDelay: "300ms" }} />
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
          {error && <p className="text-xs text-amber">{error}</p>}
        </div>
      </section>

      {/* Preview panel */}
      <section className="flex-1 flex flex-col">
        <header className="px-5 py-3 border-b border-line flex items-center justify-between gap-4">
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
                  <p className="mb-2 text-mist">
                    Bring this design into Figma as editable layers:
                  </p>
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
              Download HTML
            </button>
          </div>
        </header>
        <div className="flex-1 bg-paper">
          {activePage.code ? (
            <iframe
              key={activeSlug}
              title={`preview-${activeSlug}`}
              srcDoc={previewHtml}
              sandbox="allow-scripts"
              className="w-full h-full border-0"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-ink/40 text-sm font-mono text-center px-8">
              "{activePage.label}" hasn't been generated yet — describe it in the chat
            </div>
          )}
        </div>
      </section>
    </main>
  );
}