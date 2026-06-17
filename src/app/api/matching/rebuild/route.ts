import { NextResponse } from "next/server";
import { getConnectedCardIssuers } from "@/server/db/queries/bank-credentials";
import { reclassifyCardPayments } from "@/server/db/queries/financial-events";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { warnings } = reclassifyCardPayments(workspaceId, getConnectedCardIssuers(workspaceId));
  return NextResponse.json({ ok: true, warnings });
}
