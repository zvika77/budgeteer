// Dependency-free CSV/TSV parsing and smart column mapping for local-first
// imports. No DB access and no `server-only` import so it can be unit-tested
// directly (and reused on both client preview and server commit). Built to
// swallow the messy reality of Israeli bank/credit exports: BOMs, quoted
// fields, comma/semicolon/tab delimiters, dd/mm/yyyy dates, ₪ and thousands
// separators, and separate debit/credit (חובה/זכות) columns.

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

const DELIMITERS = [",", "\t", ";"] as const;
type Delimiter = (typeof DELIMITERS)[number];

/** Pick the delimiter that appears most consistently across the first lines. */
export function detectDelimiter(text: string): Delimiter {
  const sample = text.replace(/^﻿/, "").split(/\r?\n/).slice(0, 5);
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    let score = 0;
    for (const line of sample) {
      if (line.trim() === "") continue;
      score += line.split(d).length - 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * RFC-4180-ish parser: handles quoted fields with embedded delimiters,
 * newlines, and escaped quotes (""). The first non-empty row is the header.
 */
export function parseDelimited(text: string, delimiter?: Delimiter): ParsedTable {
  const clean = text.replace(/^﻿/, "");
  const delim = delimiter ?? detectDelimiter(clean);
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    // Skip blank lines (a single empty field).
    if (!(record.length === 1 && record[0].trim() === "")) records.push(record);
    record = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      pushField();
    } else if (ch === "\n") {
      pushRecord();
    } else if (ch === "\r") {
      // handled by the \n branch; ignore lone CR
    } else {
      field += ch;
    }
  }
  // Flush trailing field/record (file may not end in a newline).
  if (field !== "" || record.length > 0) pushRecord();

  if (records.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = records;
  const width = headers.length;
  // Normalize ragged rows to the header width so index access is safe.
  const normalized = rows.map((r) => {
    if (r.length === width) return r;
    const copy = r.slice(0, width);
    while (copy.length < width) copy.push("");
    return copy;
  });
  return { headers: headers.map((h) => h.trim()), rows: normalized };
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export type ColumnRole =
  | "date"
  | "amount"
  | "debit"
  | "credit"
  | "description"
  | "memo"
  | "category";

export interface ColumnMapping {
  date: number | null;
  /** A single signed amount column (negative = expense). */
  amount: number | null;
  /** Money-out column (Israeli חובה). Used when there is no single amount column. */
  debit: number | null;
  /** Money-in column (Israeli זכות). */
  credit: number | null;
  description: number | null;
  memo: number | null;
  category: number | null;
}

// Header keyword hints, English + Hebrew. Order matters: more specific first.
const HEADER_HINTS: Record<ColumnRole, RegExp[]> = {
  date: [/date/i, /תאריך/, /יום/],
  debit: [/debit/i, /חובה/, /חיוב/, /withdrawal/i, /payment/i, /משיכ/],
  credit: [/credit/i, /זכות/, /deposit/i, /הפקד/, /זיכוי/],
  amount: [/amount/i, /sum/i, /סכום/, /charge/i, /total/i, /ש"ח/, /₪/],
  description: [
    /description/i,
    /payee/i,
    /business/i,
    /merchant/i,
    /name/i,
    /תיאור/,
    /בית עסק/,
    /שם/,
    /פרטים/,
    /details/i,
  ],
  memo: [/memo/i, /note/i, /comment/i, /הערה/, /הערות/],
  category: [/category/i, /קטגוריה/, /סוג/],
};

function matchHeader(header: string, role: ColumnRole): boolean {
  return HEADER_HINTS[role].some((re) => re.test(header));
}

/**
 * Best-effort guess of which column plays which role, from header names with a
 * value-based fallback (a column whose cells parse as dates/numbers). Never
 * assigns the same index to two roles.
 */
export function guessMapping(table: ParsedTable): ColumnMapping {
  const { headers, rows } = table;
  const used = new Set<number>();
  const take = (idx: number | null): number | null => {
    if (idx == null || idx < 0 || used.has(idx)) return null;
    used.add(idx);
    return idx;
  };

  const byHeader = (role: ColumnRole): number | null => {
    for (let i = 0; i < headers.length; i++) {
      if (!used.has(i) && matchHeader(headers[i], role)) return i;
    }
    return null;
  };

  const date = take(byHeader("date"));
  const debit = take(byHeader("debit"));
  const credit = take(byHeader("credit"));
  const amount = debit == null && credit == null ? take(byHeader("amount")) : null;
  const category = take(byHeader("category"));
  const description = take(byHeader("description"));
  const memo = take(byHeader("memo"));

  const sample = rows.slice(0, 20);
  const valueGuess = (predicate: (cells: string[]) => boolean): number | null => {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const cells = sample.map((r) => r[i] ?? "").filter((c) => c.trim() !== "");
      if (cells.length > 0 && predicate(cells)) return i;
    }
    return null;
  };

  return {
    date: date ?? take(valueGuess((cells) => cells.every((c) => parseDate(c) != null))),
    amount:
      amount ??
      (debit == null && credit == null
        ? take(valueGuess((cells) => cells.every((c) => parseAmount(c) != null)))
        : null),
    debit,
    credit,
    description:
      description ?? take(valueGuess((cells) => cells.some((c) => /[A-Za-z֐-׿]/.test(c)))),
    memo,
    category,
  };
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

/** Parse a date in dd/mm/yyyy, yyyy-mm-dd, dd.mm.yyyy or dd-mm-yyyy to ISO (YYYY-MM-DD). */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return null;

  // ISO first (yyyy-mm-dd or yyyy/mm/dd), possibly with a time suffix.
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return toIso(Number(y), Number(m), Number(d));
  }

  // Day-first: dd/mm/yyyy, dd.mm.yyyy, dd-mm-yy (the Israeli default).
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    const [, d, m, yRaw] = dmy;
    const y = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    return toIso(y, Number(m), Number(d));
  }
  return null;
}

function toIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 1900 || y > 2200) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parse a money string to a number. Strips currency symbols/codes and thousands
 * separators; treats parentheses and a trailing/leading minus as negative.
 * Returns null when there is no parseable number.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (s === "") return null;
  const negative = /\(.*\)/.test(s) || /-/.test(s);
  // Drop everything that isn't a digit or a decimal separator.
  s = s.replace(/[^\d.,]/g, "");
  if (s === "") return null;
  // If both separators appear, the last one is the decimal separator.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    s = s.split(thousandsSep).join("");
    if (decimalSep === ",") s = s.replace(",", ".");
  } else if (lastComma > -1) {
    // Only commas: decimal if exactly 1-2 digits follow the last comma.
    const after = s.length - lastComma - 1;
    s = after <= 2 ? s.replace(",", ".") : s.split(",").join("");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : Math.abs(n);
}

// ---------------------------------------------------------------------------
// Row building
// ---------------------------------------------------------------------------

export interface ImportedRow {
  date: string;
  description: string;
  /** Signed: negative = expense (money out), positive = income (money in). */
  amount: number;
  currency: string;
  memo: string | null;
  categoryName: string | null;
}

export interface RowError {
  line: number;
  reason: string;
}

export interface BuildResult {
  rows: ImportedRow[];
  errors: RowError[];
}

export interface BuildOptions {
  defaultCurrency?: string;
  /** When debit/credit columns are used, debit is money out (expense). */
  mapping: ColumnMapping;
}

/** Turn a parsed table + mapping into clean, signed import rows. */
export function buildImportRows(table: ParsedTable, opts: BuildOptions): BuildResult {
  const { mapping } = opts;
  const currency = opts.defaultCurrency ?? "ILS";
  const rows: ImportedRow[] = [];
  const errors: RowError[] = [];

  if (mapping.date == null) {
    return { rows, errors: [{ line: 0, reason: "no-date-column" }] };
  }
  if (mapping.amount == null && mapping.debit == null && mapping.credit == null) {
    return { rows, errors: [{ line: 0, reason: "no-amount-column" }] };
  }

  table.rows.forEach((cells, i) => {
    const line = i + 2; // 1-based, +1 for the header row
    const date = parseDate(cells[mapping.date as number] ?? "");
    if (!date) {
      errors.push({ line, reason: "bad-date" });
      return;
    }

    let amount: number | null = null;
    if (mapping.amount != null) {
      amount = parseAmount(cells[mapping.amount] ?? "");
    } else {
      const debit = mapping.debit != null ? parseAmount(cells[mapping.debit] ?? "") : null;
      const credit = mapping.credit != null ? parseAmount(cells[mapping.credit] ?? "") : null;
      if (debit != null || credit != null) {
        amount = (credit != null ? Math.abs(credit) : 0) - (debit != null ? Math.abs(debit) : 0);
      }
    }
    if (amount == null || amount === 0) {
      errors.push({ line, reason: "bad-amount" });
      return;
    }

    const description =
      mapping.description != null ? (cells[mapping.description] ?? "").trim() : "";
    const memo = mapping.memo != null ? (cells[mapping.memo] ?? "").trim() || null : null;
    const categoryName =
      mapping.category != null ? (cells[mapping.category] ?? "").trim() || null : null;

    rows.push({
      date,
      description: description || "Imported transaction",
      amount,
      currency,
      memo,
      categoryName,
    });
  });

  return { rows, errors };
}
