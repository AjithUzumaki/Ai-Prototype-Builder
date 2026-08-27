import { head } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const pathname = `previews/${params.id}.html`;
    const blob = await head(pathname);
    const res = await fetch(blob.url);

    if (!res.ok) {
      return new NextResponse("Preview not found", { status: 404 });
    }

    const html = await res.text();

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (err: any) {
    console.error("Preview fetch error:", err);
    return new NextResponse("Preview not found", { status: 404 });
  }
}