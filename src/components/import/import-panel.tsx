"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileUp, PencilLine, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, InputGroup } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Locale } from "@/i18n/routing";
import { createManualTransaction, type ImportResult, importCsvRows } from "@/lib/api";
import {
  buildImportRows,
  type ColumnMapping,
  guessMapping,
  type ParsedTable,
  parseDelimited,
} from "@/lib/csv";
import { formatCurrency } from "@/lib/formatters";

type ImportField = "date" | "amount" | "debit" | "credit" | "description";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ImportPanel({ onImported }: { onImported?: (result: ImportResult) => void }) {
  const t = useTranslations("import");
  return (
    <Tabs defaultValue="file" className="w-full">
      <TabsList className="w-full">
        <TabsTrigger value="file">
          <FileUp /> {t("tabFile")}
        </TabsTrigger>
        <TabsTrigger value="manual">
          <PencilLine /> {t("tabManual")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="file">
        <CsvImport onImported={onImported} />
      </TabsContent>
      <TabsContent value="manual">
        <ManualEntry onImported={onImported} />
      </TabsContent>
    </Tabs>
  );
}

function CsvImport({ onImported }: { onImported?: (result: ImportResult) => void }) {
  const t = useTranslations("import");
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [accountName, setAccountName] = useState("");
  const [saving, setSaving] = useState(false);

  function ingest(text: string) {
    const parsed = parseDelimited(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      toast.error(t("parseError"));
      return;
    }
    setTable(parsed);
    setMapping(guessMapping(parsed));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setAccountName(file.name.replace(/\.[^.]+$/, ""));
    ingest(await file.text());
  }

  const built = useMemo(
    () => (table && mapping ? buildImportRows(table, { mapping }) : null),
    [table, mapping],
  );
  const ready = built?.rows.length ?? 0;
  const skipped = built?.errors.length ?? 0;

  async function commit() {
    if (!built || ready === 0) {
      toast.error(t("nothingToImport"));
      return;
    }
    setSaving(true);
    try {
      const result = await importCsvRows(accountName.trim() || "Imported", built.rows);
      queryClient.invalidateQueries();
      toast.success(t("importedToast", { added: result.added, account: result.accountName }));
      reset();
      onImported?.(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("parseError"));
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setTable(null);
    setMapping(null);
    setAccountName("");
  }

  if (!table || !mapping) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-primary/12 text-primary">
            <Upload className="size-5" />
          </span>
          <span className="text-sm font-medium">{t("chooseFile")}</span>
          <span className="text-xs text-muted-foreground">{t("fileHint")}</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <div className="space-y-1.5">
          <Label htmlFor="paste">{t("orPaste")}</Label>
          <textarea
            id="paste"
            rows={4}
            placeholder={t("pastePlaceholder")}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onChange={(e) => {
              const v = e.target.value.trim();
              if (v.includes("\n")) ingest(e.target.value);
            }}
          />
        </div>
      </div>
    );
  }

  const hasAmount = mapping.amount != null || mapping.debit != null || mapping.credit != null;
  const canImport = mapping.date != null && hasAmount && ready > 0;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="account-name">{t("accountNameLabel")}</Label>
        <Input
          id="account-name"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder={t("accountNamePlaceholder")}
        />
      </div>

      <div>
        <div className="mb-2 text-sm font-medium">{t("mapTitle")}</div>
        <p className="mb-3 text-xs text-muted-foreground">{t("mapHint")}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <ColumnSelect
            field="date"
            label={t("colDate")}
            headers={table.headers}
            value={mapping.date}
            onChange={(i) => setMapping({ ...mapping, date: i })}
          />
          <ColumnSelect
            field="amount"
            label={t("colAmount")}
            headers={table.headers}
            value={mapping.amount}
            onChange={(i) => setMapping({ ...mapping, amount: i, debit: null, credit: null })}
          />
          <ColumnSelect
            field="description"
            label={t("colDescription")}
            headers={table.headers}
            value={mapping.description}
            onChange={(i) => setMapping({ ...mapping, description: i })}
          />
          <ColumnSelect
            field="debit"
            label={t("colDebit")}
            headers={table.headers}
            value={mapping.debit}
            onChange={(i) => setMapping({ ...mapping, debit: i, amount: null })}
          />
          <ColumnSelect
            field="credit"
            label={t("colCredit")}
            headers={table.headers}
            value={mapping.credit}
            onChange={(i) => setMapping({ ...mapping, credit: i, amount: null })}
          />
        </div>
      </div>

      {built && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">{t("previewTitle")}</span>
            <span className="text-xs text-muted-foreground">
              {t("rowsReady", { count: ready })}
              {skipped > 0 ? ` · ${t("rowsSkipped", { count: skipped })}` : ""}
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {built.rows.slice(0, 6).map((r, i) => (
                  <tr key={`${r.date}-${i}`}>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
                      {r.date}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-1.5">{r.description}</td>
                    <td
                      className={`px-3 py-1.5 text-end tabular-nums ${r.amount < 0 ? "text-foreground" : "text-status-on-track"}`}
                    >
                      {r.amount < 0 ? "-" : "+"}
                      {formatCurrency(r.amount, r.currency, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" onClick={reset} disabled={saving}>
          <ArrowLeft /> {t("back")}
        </Button>
        <Button onClick={commit} disabled={!canImport || saving}>
          {saving ? t("importing") : t("importButton")}
        </Button>
      </div>
      {!canImport && ready === 0 && (
        <p className="text-end text-xs text-status-over">{t("needDateAmount")}</p>
      )}
    </div>
  );
}

function ColumnSelect({
  field,
  label,
  headers,
  value,
  onChange,
}: {
  field: ImportField;
  label: string;
  headers: string[];
  value: number | null;
  onChange: (index: number | null) => void;
}) {
  const t = useTranslations("import");
  return (
    <div className="space-y-1">
      <Label htmlFor={`col-${field}`}>{label}</Label>
      <Select
        value={value == null ? "none" : String(value)}
        onValueChange={(v) => onChange(v == null || v === "none" ? null : Number(v))}
      >
        <SelectTrigger id={`col-${field}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t("colNone")}</SelectItem>
          {headers.map((h, i) => (
            <SelectItem key={`${h}-${i}`} value={String(i)}>
              {h || `#${i + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ManualEntry({ onImported }: { onImported?: (result: ImportResult) => void }) {
  const t = useTranslations("import");
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [accountName, setAccountName] = useState("");
  const [saving, setSaving] = useState(false);

  const parsedAmount = Number(amount);
  const valid =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function submit() {
    if (!valid) return;
    setSaving(true);
    try {
      const signed = kind === "expense" ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);
      const result = await createManualTransaction({
        date,
        description: description.trim(),
        amount: signed,
        accountName: accountName.trim() || "Manual",
      });
      queryClient.invalidateQueries();
      toast.success(t("addedToast"));
      setDescription("");
      setAmount("");
      onImported?.(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("parseError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("manualHint")}</p>
      <Tabs value={kind} onValueChange={(v) => v && setKind(v as "expense" | "income")}>
        <TabsList className="w-full">
          <TabsTrigger value="expense">{t("manualExpense")}</TabsTrigger>
          <TabsTrigger value="income">{t("manualIncome")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="m-date">{t("manualDate")}</Label>
          <Input id="m-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-amount">{t("manualAmount")}</Label>
          <InputGroup prefix="₪">
            <Input
              id="m-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-end tabular-nums"
            />
          </InputGroup>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="m-desc">{t("manualDescription")}</Label>
        <Input
          id="m-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("manualDescriptionPlaceholder")}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="m-account">{t("accountNameLabel")}</Label>
        <Input
          id="m-account"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder={t("accountNamePlaceholder")}
        />
      </div>
      <div className="flex justify-end pt-1">
        <Button onClick={submit} disabled={!valid || saving}>
          {saving ? t("adding") : t("addButton")}
        </Button>
      </div>
    </div>
  );
}

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {children}
    </label>
  );
}
