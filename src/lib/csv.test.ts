import { describe, expect, test } from "bun:test";

import {
  buildImportRows,
  detectDelimiter,
  guessMapping,
  parseAmount,
  parseDate,
  parseDelimited,
} from "./csv";

describe("parseDelimited", () => {
  test("parses a simple comma file and trims the header", () => {
    const t = parseDelimited("Date, Amount, Description\n2026-01-02,-50,Coffee\n");
    expect(t.headers).toEqual(["Date", "Amount", "Description"]);
    expect(t.rows).toEqual([["2026-01-02", "-50", "Coffee"]]);
  });

  test("handles quoted fields with embedded commas and quotes", () => {
    const t = parseDelimited('a,b\n"Hello, world","She said ""hi"""\n');
    expect(t.rows[0]).toEqual(["Hello, world", 'She said "hi"']);
  });

  test("strips a UTF-8 BOM and skips blank lines", () => {
    const t = parseDelimited("﻿a,b\n1,2\n\n3,4\n");
    expect(t.headers).toEqual(["a", "b"]);
    expect(t.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  test("detects tab and semicolon delimiters", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
  });

  test("pads ragged rows to the header width", () => {
    const t = parseDelimited("a,b,c\n1,2\n");
    expect(t.rows[0]).toEqual(["1", "2", ""]);
  });
});

describe("parseDate", () => {
  test("parses ISO and day-first formats", () => {
    expect(parseDate("2026-03-09")).toBe("2026-03-09");
    expect(parseDate("09/03/2026")).toBe("2026-03-09");
    expect(parseDate("9.3.2026")).toBe("2026-03-09");
    expect(parseDate("09-03-26")).toBe("2026-03-09");
  });

  test("rejects nonsense", () => {
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate("45/13/2026")).toBeNull();
  });
});

describe("parseAmount", () => {
  test("handles currency symbols, thousands separators and negatives", () => {
    expect(parseAmount("₪1,234.50")).toBe(1234.5);
    expect(parseAmount("-50")).toBe(-50);
    expect(parseAmount("(120.00)")).toBe(-120);
    expect(parseAmount("1.234,56")).toBe(1234.56); // European style
    expect(parseAmount("250")).toBe(250);
  });

  test("returns null for empty/non-numeric", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("guessMapping", () => {
  test("maps an English single-amount file by header", () => {
    const t = parseDelimited("Date,Description,Amount\n2026-01-02,Coffee,-12\n");
    const m = guessMapping(t);
    expect(m.date).toBe(0);
    expect(m.description).toBe(1);
    expect(m.amount).toBe(2);
    expect(m.debit).toBeNull();
  });

  test("maps a Hebrew debit/credit file", () => {
    const t = parseDelimited(
      "תאריך,תיאור,חובה,זכות\n01/02/2026,מכולת,120,\n05/02/2026,משכורת,,9000\n",
    );
    const m = guessMapping(t);
    expect(m.date).toBe(0);
    expect(m.description).toBe(1);
    expect(m.debit).toBe(2);
    expect(m.credit).toBe(3);
    expect(m.amount).toBeNull();
  });
});

describe("buildImportRows", () => {
  test("signs a single amount column (negative = expense)", () => {
    const t = parseDelimited(
      "Date,Description,Amount\n2026-01-02,Coffee,-12\n2026-01-03,Salary,9000\n",
    );
    const { rows, errors } = buildImportRows(t, { mapping: guessMapping(t) });
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({ date: "2026-01-02", description: "Coffee", amount: -12 });
    expect(rows[1]).toMatchObject({ amount: 9000 });
  });

  test("derives sign from debit/credit columns", () => {
    const t = parseDelimited(
      "תאריך,תיאור,חובה,זכות\n01/02/2026,מכולת,120,\n05/02/2026,משכורת,,9000\n",
    );
    const { rows } = buildImportRows(t, { mapping: guessMapping(t) });
    expect(rows[0].amount).toBe(-120); // debit -> expense
    expect(rows[1].amount).toBe(9000); // credit -> income
  });

  test("collects errors for bad rows without aborting the batch", () => {
    const t = parseDelimited("Date,Description,Amount\nnope,Coffee,-12\n2026-01-03,Salary,9000\n");
    const { rows, errors } = buildImportRows(t, { mapping: guessMapping(t) });
    expect(rows).toHaveLength(1);
    expect(errors[0]).toMatchObject({ reason: "bad-date" });
  });
});
