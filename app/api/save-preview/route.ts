import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
      return NextResponse.json(
        {
          error:
            "Figma export needs Vercel Blob. In Vercel: Storage → Blob → Create, then redeploy so BLOB_READ_WRITE_TOKEN is available.",
        },
        { status: 500 }
      );
    }

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
