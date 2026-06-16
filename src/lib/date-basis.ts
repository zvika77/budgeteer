export type DateBasis = "purchase" | "billing";

export const DEFAULT_DATE_BASIS: DateBasis = "purchase";

export function isDateBasis(value: string | null | undefined): value is DateBasis {
  return value === "purchase" || value === "billing";
}

export function dateBasisColumn(basis: DateBasis, alias = ""): string {
  return basis === "billing"
    ? `COALESCE(${alias}billing_local_date, ${alias}local_date)`
    : `${alias}local_date`;
}
