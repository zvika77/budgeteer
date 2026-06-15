import { describe, expect, test } from "bun:test";

import { getCardBillBadgeState } from "@/lib/card-bill-badge";

describe("getCardBillBadgeState", () => {
  test("returns null for non-bill-payment roles", () => {
    expect(getCardBillBadgeState("debit", "expense", null)).toBeNull();
    expect(getCardBillBadgeState("purchase", "expense", null)).toBeNull();
    expect(getCardBillBadgeState(null, "expense", null)).toBeNull();
  });

  test("returns matched when kind is transfer and card number is known", () => {
    const state = getCardBillBadgeState("bill_payment", "transfer", "8682");
    expect(state).toEqual({ matched: true, cardNumber: "8682" });
  });

  test("returns unmatched when kind is expense (no statement found)", () => {
    const state = getCardBillBadgeState("bill_payment", "expense", null);
    expect(state).toEqual({ matched: false });
  });

  test("returns unmatched when transfer but matchedCardNumber is null (edge case)", () => {
    const state = getCardBillBadgeState("bill_payment", "transfer", null);
    expect(state).toEqual({ matched: false });
  });
});
