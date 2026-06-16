import { describe, expect, test } from "bun:test";
import { DEFAULT_DATE_BASIS, dateBasisColumn, isDateBasis } from "@/lib/date-basis";

describe("date-basis helpers", () => {
  test("default basis is purchase", () => {
    expect(DEFAULT_DATE_BASIS).toBe("purchase");
  });

  test("isDateBasis validates values", () => {
    expect(isDateBasis("purchase")).toBe(true);
    expect(isDateBasis("billing")).toBe(true);
    expect(isDateBasis("nope")).toBe(false);
    expect(isDateBasis(null)).toBe(false);
    expect(isDateBasis(undefined)).toBe(false);
  });

  test("dateBasisColumn returns local_date for purchase", () => {
    expect(dateBasisColumn("purchase")).toBe("local_date");
    expect(dateBasisColumn("purchase", "t.")).toBe("t.local_date");
  });

  test("dateBasisColumn coalesces billing onto local_date for billing", () => {
    expect(dateBasisColumn("billing")).toBe("COALESCE(billing_local_date, local_date)");
    expect(dateBasisColumn("billing", "t.")).toBe("COALESCE(t.billing_local_date, t.local_date)");
  });
});
