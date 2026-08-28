import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
    pexels: Boolean(process.env.PEXELS_API_KEY?.trim()),
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()),
  });
}
