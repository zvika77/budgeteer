import { NextResponse } from "next/server";
import { markOnboarded } from "@/server/lib/app-state";

export async function POST() {
  markOnboarded();
  return NextResponse.json({ success: true });
}
