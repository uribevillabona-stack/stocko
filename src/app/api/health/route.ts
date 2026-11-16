import { NextResponse } from "next/server";
import { pool } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    await pool.query("select 1");
    return NextResponse.json({
      ok: true,
      database: "up",
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        database: "down",
        time: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
