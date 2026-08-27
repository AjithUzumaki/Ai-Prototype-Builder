import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { html, slug } = body as { html?: string; slug?: string };

    if (!html || typeof html !== "string") {
      return NextResponse.json({ error: "Missing html" }, { status: 400 });
    }

    const safeSlug = (slug || "page").replace(/[^a-z0-9-]/gi, "-");
    const fileName = `previews/${safeSlug}-${Date.now()}.html`;

    const blob = await put(fileName, html, {
      access: "public",
      contentType: "text/html",
    });

    return NextResponse.json({ url: blob.url });
  } catch (err: any) {
    console.error("Save preview error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to save preview" },
      { status: 500 }
    );
  }
}