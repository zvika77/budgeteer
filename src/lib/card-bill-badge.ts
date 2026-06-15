import type { EventRole } from "@/lib/types";

export type CardBillBadgeState = { matched: true; cardNumber: string } | { matched: false } | null;

export function getCardBillBadgeState(
  eventRole: EventRole | null,
  kind: "expense" | "income" | "transfer",
  matchedCardNumber: string | null,
): CardBillBadgeState {
  if (eventRole !== "bill_payment") {
    return null;
  }
  if (kind === "transfer" && matchedCardNumber !== null) {
    return { matched: true, cardNumber: matchedCardNumber };
  }
  return { matched: false };
}
