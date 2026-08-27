import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { html } = body as { html?: string };

    if (!html || typeof html !== "string") {
      return NextResponse.json({ error: "Missing html" }, { status: 400 });
    }

    const id = randomUUID();
    const pathname = `previews/${id}.html`;

    await put(pathname, html, {
      access: "public",
      contentType: "text/html",
      addRandomSuffix: false,
    });

    // Point Figma at our own proxy route (real webpage behavior),
    // not the raw blob file URL (which gets treated as a download).
    const previewUrl = `${req.nextUrl.origin}/api/preview/${id}`;

    return NextResponse.json({ url: previewUrl });
  } catch (err: any) {
    console.error("Save preview error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to save preview" },
      { status: 500 }
    );
  }
}