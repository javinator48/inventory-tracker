"use client";

import type { Item } from "@/db/schema";
import type { ProductInfo } from "@/lib/types";
import { Field, Input, Textarea } from "./ui";

const FIELDS = [
  "name",
  "brand",
  "model",
  "category",
  "condition",
  "quantity",
  "location",
  "purchasePrice",
  "purchaseDate",
  "msrp",
  "estimatedValue",
  "askingPrice",
  "soldPrice",
  "soldDate",
  "soldPlatform",
  "upc",
  "description",
  "notes",
] as const;

export type ItemFormValues = Record<(typeof FIELDS)[number], string>;

export const CONDITIONS = ["New", "Like new", "Good", "Fair", "Poor"];

export function emptyValues(): ItemFormValues {
  const v = Object.fromEntries(FIELDS.map((f) => [f, ""])) as ItemFormValues;
  v.quantity = "1";
  return v;
}

export function valuesFromItem(item: Item): ItemFormValues {
  const v = emptyValues();
  for (const f of FIELDS) {
    const raw = item[f];
    v[f] = raw == null ? "" : String(raw);
  }
  return v;
}

export function valuesFromProduct(p: ProductInfo, base = emptyValues()): ItemFormValues {
  const str = (s: string | number | null) => (s == null ? "" : String(s));
  return {
    ...base,
    name: p.name,
    brand: str(p.brand) || base.brand,
    model: str(p.model) || base.model,
    category: str(p.category) || base.category,
    description: str(p.description) || base.description,
    upc: str(p.upc) || base.upc,
    msrp: str(p.msrp) || base.msrp,
    estimatedValue: str(p.estimatedValue) || base.estimatedValue,
  };
}

/** Converts form strings to the JSON the items API expects (empty → null). */
export function toPayload(v: ItemFormValues) {
  const out: Record<string, string | number | null> = {};
  for (const f of FIELDS) out[f] = v[f].trim() === "" ? null : v[f].trim();
  out.quantity = Math.max(1, Number(v.quantity) || 1);
  return out;
}

export function ItemForm({
  values,
  onChange,
  status,
  categories,
}: {
  values: ItemFormValues;
  onChange: (v: ItemFormValues) => void;
  status: Item["status"];
  categories: string[];
}) {
  const bind = (f: keyof ItemFormValues) => ({
    value: values[f],
    onChange: (e: { target: { value: string } }) => onChange({ ...values, [f]: e.target.value }),
  });
  const moneyProps = { type: "number", inputMode: "decimal" as const, min: 0, step: "0.01", placeholder: "0.00" };

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Name *" className="col-span-2">
        <Input {...bind("name")} required placeholder="e.g. Sony WH-1000XM5 headphones" />
      </Field>
      <Field label="Brand">
        <Input {...bind("brand")} />
      </Field>
      <Field label="Model">
        <Input {...bind("model")} />
      </Field>
      <Field label="Category">
        <Input {...bind("category")} list="category-options" placeholder="Electronics" />
        <datalist id="category-options">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="Condition">
        <Input {...bind("condition")} list="condition-options" placeholder="Good" />
        <datalist id="condition-options">
          {CONDITIONS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>

      <Field label="Purchase price">
        <Input {...bind("purchasePrice")} {...moneyProps} />
      </Field>
      <Field label="Purchase date">
        <Input {...bind("purchaseDate")} type="date" />
      </Field>
      <Field label="MSRP">
        <Input {...bind("msrp")} {...moneyProps} />
      </Field>
      <Field label="Estimated value">
        <Input {...bind("estimatedValue")} {...moneyProps} />
      </Field>

      {status === "for_sale" && (
        <Field label="Asking price" className="col-span-2">
          <Input {...bind("askingPrice")} {...moneyProps} />
        </Field>
      )}
      {status === "sold" && (
        <>
          <Field label="Sold price">
            <Input {...bind("soldPrice")} {...moneyProps} />
          </Field>
          <Field label="Sold date">
            <Input {...bind("soldDate")} type="date" />
          </Field>
          <Field label="Sold on" className="col-span-2">
            <Input {...bind("soldPlatform")} placeholder="eBay, Facebook Marketplace…" />
          </Field>
        </>
      )}

      <Field label="Quantity">
        <Input {...bind("quantity")} type="number" inputMode="numeric" min={1} step={1} />
      </Field>
      <Field label="Location">
        <Input {...bind("location")} placeholder="Garage, shelf 2" />
      </Field>
      <Field label="Barcode (UPC)" className="col-span-2">
        <Input {...bind("upc")} inputMode="numeric" />
      </Field>
      <Field label="Description" className="col-span-2">
        <Textarea {...bind("description")} />
      </Field>
      <Field label="Notes" className="col-span-2">
        <Textarea {...bind("notes")} placeholder="Serial number, accessories, receipt location…" />
      </Field>
    </div>
  );
}
