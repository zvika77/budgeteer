import { describe, expect, test } from "bun:test";
import {
  jerusalemToday,
  monthEnd,
  monthStart,
  shiftMonth,
  toJerusalemDate,
} from "@/server/lib/date-utils";

describe("toJerusalemDate", () => {
  test("summer evening UTC rolls to next Jerusalem day", () => {
    expect(toJerusalemDate("2026-05-31T21:00:00.000Z")).toBe("2026-06-01");
    expect(toJerusalemDate("2026-04-30T21:00:00.000Z")).toBe("2026-05-01");
  });
  test("winter evening UTC rolls to next Jerusalem day", () => {
    expect(toJerusalemDate("2025-12-31T22:00:00.000Z")).toBe("2026-01-01");
  });
  test("midday UTC stays on the same Jerusalem day", () => {
    expect(toJerusalemDate("2026-05-15T10:00:00.000Z")).toBe("2026-05-15");
  });
});

describe("month-range helpers", () => {
  test("monthStart returns first of month", () => {
    expect(monthStart("2026-05-31")).toBe("2026-05-01");
  });
  test("monthEnd returns last day, handling 30/31/28", () => {
    expect(monthEnd("2026-05-15")).toBe("2026-05-31");
    expect(monthEnd("2026-04-10")).toBe("2026-04-30");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
  });
  test("shiftMonth moves by N months keeping first-of-month", () => {
    expect(shiftMonth("2026-05-01", -1)).toBe("2026-04-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
  });
  test("jerusalemToday returns a YYYY-MM-DD string", () => {
    expect(jerusalemToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
