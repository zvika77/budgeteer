import { NextResponse } from "next/server";
import { listBankAccounts } from "@/server/db/queries/bank-accounts";
import { queryTransactions, type TransactionKindFilter } from "@/server/db/queries/transactions";
import { commitImport } from "@/server/import/commit";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

function parseKind(raw: string | null): TransactionKindFilter | undefined {
  if (raw === "expense" || raw === "income" || raw === "all") {
    return raw;
  }
  return undefined;
}

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);

  // Support multi-id filter ("?categoryIds=1&categoryIds=2") for parent
  // category drilldowns (parent expands to its children client-side).
  const categoryIds = searchParams.getAll("categoryIds").flatMap((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? [n] : [];
  });

  const credentialIds = searchParams.getAll("credentialIds").flatMap((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? [n] : [];
  });

  // Resolve selected bank_accounts.id values to their (credentialId,
  // accountNumber) pairs. Account keys take precedence over credentialIds.
  const accountIds = new Set(
    searchParams.getAll("accountIds").flatMap((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? [n] : [];
    }),
  );
  const accountKeys =
    accountIds.size > 0
      ? listBankAccounts(workspaceId)
          .filter((a) => accountIds.has(a.id))
          .map((a) => ({ credentialId: a.credentialId, accountNumber: a.accountNumber }))
      : undefined;

  const result = queryTransactions(workspaceId, {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    category: searchParams.has("category") ? Number(searchParams.get("category")) : undefined,
    categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
    sort: searchParams.get("sort") ?? undefined,
    order: (searchParams.get("order") as "asc" | "desc") ?? undefined,
    limit: searchParams.has("limit") ? Number(searchParams.get("limit")) : undefined,
    offset: searchParams.has("offset") ? Number(searchParams.get("offset")) : undefined,
    kind: parseKind(searchParams.get("kind")),
    provider: searchParams.get("provider") ?? undefined,
    credentialIds: credentialIds.length > 0 ? credentialIds : undefined,
    accountKeys,
  });

  return NextResponse.json(result);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Manually add a single transaction. `amount` is signed (negative = expense). */
export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = await request.json().catch(() => null);
  if (body == null || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { date, description, amount, accountName, currency } = body as Record<string, unknown>;
  const amountNum = Number(amount);
  if (typeof date !== "string" || !ISO_DATE.test(date)) {
    return NextResponse.json({ error: "A valid date (YYYY-MM-DD) is required" }, { status: 400 });
  }
  if (!Number.isFinite(amountNum) || amountNum === 0) {
    return NextResponse.json({ error: "A non-zero amount is required" }, { status: 400 });
  }

  const result = commitImport(workspaceId, {
    source: "manual",
    accountName: typeof accountName === "string" ? accountName : "Manual",
    rows: [
      {
        date,
        description: typeof description === "string" ? description : "",
        amount: amountNum,
        currency: typeof currency === "string" ? currency : "ILS",
      },
    ],
  });
  return NextResponse.json(result);
}
