import { NextResponse } from "next/server";
import { type CommitImportRow, commitImport } from "@/server/import/commit";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Commit rows that were parsed and mapped client-side (the CSV parser is a pure
 * module reused on both sides). Bad rows are dropped defensively here too.
 */
export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = await request.json().catch(() => null);
  if (
    body == null ||
    typeof body !== "object" ||
    !Array.isArray((body as { rows?: unknown }).rows)
  ) {
    return NextResponse.json({ error: "Expected { accountName, rows[] }" }, { status: 400 });
  }
  const { accountName, rows } = body as { accountName?: unknown; rows: unknown[] };

  const clean: CommitImportRow[] = [];
  for (const raw of rows) {
    if (raw == null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const amount = Number(r.amount);
    if (typeof r.date !== "string" || !ISO_DATE.test(r.date)) continue;
    if (!Number.isFinite(amount) || amount === 0) continue;
    clean.push({
      date: r.date,
      description: typeof r.description === "string" ? r.description : "",
      amount,
      currency: typeof r.currency === "string" ? r.currency : "ILS",
      memo: typeof r.memo === "string" ? r.memo : null,
    });
  }

  if (clean.length === 0) {
    return NextResponse.json({ error: "No valid rows to import" }, { status: 400 });
  }

  const result = commitImport(workspaceId, {
    source: "csv",
    accountName: typeof accountName === "string" ? accountName : "Imported",
    rows: clean,
  });
  return NextResponse.json(result);
}
