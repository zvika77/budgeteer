import { NextResponse } from "next/server";
import {
  deleteManualCardBillLink,
  upsertManualCardBillLink,
} from "@/server/db/queries/manual-card-bill-links";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json().catch(() => ({}))) as {
    billId?: unknown;
    accountNumber?: unknown;
  };
  const billId = Number(body.billId);
  const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber : "";
  if (!Number.isFinite(billId) || billId <= 0 || accountNumber === "") {
    return NextResponse.json({ error: "billId and accountNumber are required" }, { status: 400 });
  }
  upsertManualCardBillLink(workspaceId, billId, accountNumber);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json().catch(() => ({}))) as { billId?: unknown };
  const billId = Number(body.billId);
  if (!Number.isFinite(billId) || billId <= 0) {
    return NextResponse.json({ error: "billId is required" }, { status: 400 });
  }
  deleteManualCardBillLink(workspaceId, billId);
  return NextResponse.json({ ok: true });
}
