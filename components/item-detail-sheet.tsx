"use client";

import { BadgeDollarSign, ImagePlus, Pencil, RefreshCw, Star, Tag, Trash2, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import type { ItemWithImages } from "@/db/schema";
import { api, jsonBody, money, resizeImage, signedMoney } from "@/lib/client";
import type { ValueEstimate } from "@/lib/types";
import { ItemForm, toPayload, valuesFromItem, type ItemFormValues } from "./item-form";
import { Button, cn, ErrorNote, Field, Input, Sheet, Spinner, StatusBadge } from "./ui";

type Mode = "view" | "edit" | "list" | "sell";

/** Key this by item id so switching items resets its state. */
export function ItemDetailSheet({
  item,
  onClose,
  onChanged,
  onDeleted,
  categories,
}: {
  item: ItemWithImages | null;
  onClose: () => void;
  onChanged: (item: ItemWithImages) => void;
  onDeleted: (id: number) => void;
  categories: string[];
}) {
  const [mode, setMode] = useState<Mode>("view");
  const [values, setValues] = useState<ItemFormValues | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<ValueEstimate | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [askingPrice, setAskingPrice] = useState("");
  const [sale, setSale] = useState({ quantity: "", price: "", date: "", platform: "" });
  const photoInput = useRef<HTMLInputElement>(null);

  if (!item) return null;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const patch = (data: Record<string, unknown>) =>
    run("save", async () => {
      onChanged(await api<ItemWithImages>(`/api/items/${item.id}`, jsonBody(data, "PATCH")));
      setMode("view");
    });

  const sell = () =>
    run("save", async () => {
      const { sold, remaining } = await api<{ sold: ItemWithImages; remaining: ItemWithImages | null }>(
        `/api/items/${item.id}/sell`,
        jsonBody({
          quantity: Number(sale.quantity) || item.quantity,
          soldPrice: sale.price || null,
          soldDate: sale.date || null,
          soldPlatform: sale.platform || null,
        }),
      );
      // A partial sale splits off a new sold item; stay on the unsold remainder.
      onChanged(sold);
      if (remaining) onChanged(remaining);
      setMode("view");
    });

  const refresh = async () => onChanged(await api<ItemWithImages>(`/api/items/${item.id}`));

  const reprice = () =>
    run("reprice", async () => {
      const res = await api<{ estimate: ValueEstimate; item: ItemWithImages }>(`/api/items/${item.id}/reprice`, { method: "POST" });
      setEstimate(res.estimate);
      onChanged(res.item);
    });

  const uploadPhoto = (file: File) =>
    run("photo", async () => {
      const form = new FormData();
      form.set("file", await resizeImage(file));
      form.set("source", "upload");
      await api(`/api/items/${item.id}/images`, { method: "POST", body: form });
      await refresh();
      setImageIndex(item.images.length);
    });

  const image = item.images[Math.min(imageIndex, item.images.length - 1)];
  const value = item.estimatedValue ?? item.msrp ?? item.purchasePrice;
  const gain = item.purchasePrice != null && value != null ? (value - item.purchasePrice) * item.quantity : null;
  const soldProfit =
    item.soldPrice != null && item.purchasePrice != null ? (item.soldPrice - item.purchasePrice) * item.quantity : null;

  const footer =
    mode === "edit" ? (
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => setMode("view")}>
          Cancel
        </Button>
        <Button variant="primary" className="flex-[2]" disabled={busy === "save"} onClick={() => values && patch(toPayload(values))}>
          {busy === "save" && <Spinner />} Save changes
        </Button>
      </div>
    ) : mode === "list" ? (
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => setMode("view")}>
          Cancel
        </Button>
        <Button
          variant="primary"
          className="flex-[2]"
          disabled={busy === "save"}
          onClick={() => patch({ status: "for_sale", askingPrice: askingPrice || null })}
        >
          List for sale
        </Button>
      </div>
    ) : mode === "sell" ? (
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => setMode("view")}>
          Cancel
        </Button>
        <Button
          variant="primary"
          className="flex-[2]"
          disabled={busy === "save"}
          onClick={sell}
        >
          Mark as sold
        </Button>
      </div>
    ) : (
      <div className="flex flex-wrap gap-2">
        {item.status === "owned" && (
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => {
              setAskingPrice(String(item.askingPrice ?? item.estimatedValue ?? ""));
              setMode("list");
            }}
          >
            <Tag size={16} /> Sell this
          </Button>
        )}
        {item.status === "for_sale" && (
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => {
              setSale({
                quantity: String(item.quantity),
                price: String(item.askingPrice ?? ""),
                date: new Date().toISOString().slice(0, 10),
                platform: "",
              });
              setMode("sell");
            }}
          >
            <BadgeDollarSign size={16} /> Mark sold
          </Button>
        )}
        {item.status !== "owned" && (
          <Button className="flex-1" onClick={() => patch({ status: "owned" })}>
            <Undo2 size={16} /> Back to owned
          </Button>
        )}
        <Button
          className="flex-1"
          onClick={() => {
            setValues(valuesFromItem(item));
            setMode("edit");
          }}
        >
          <Pencil size={16} /> Edit
        </Button>
      </div>
    );

  return (
    <Sheet open onClose={onClose} title={item.name} footer={footer}>
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void uploadPhoto(file);
        }}
      />
      <div className="flex flex-col gap-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        {mode === "edit" && values && (
          <ItemForm values={values} onChange={setValues} status={item.status} categories={categories} />
        )}

        {mode === "list" && (
          <Field label={item.quantity > 1 ? `Asking price (each, ×${item.quantity})` : "Asking price"}>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={askingPrice}
              onChange={(e) => setAskingPrice(e.target.value)}
              autoFocus
            />
          </Field>
        )}

        {mode === "sell" && (
          <div className="grid grid-cols-2 gap-3">
            {item.quantity > 1 && (
              <Field label={`How many sold (of ${item.quantity})`} className="col-span-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={item.quantity}
                  step={1}
                  value={sale.quantity}
                  onChange={(e) => setSale({ ...sale, quantity: e.target.value })}
                />
              </Field>
            )}
            <Field label={item.quantity > 1 ? "Sold for (each)" : "Sold for"}>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={sale.price}
                onChange={(e) => setSale({ ...sale, price: e.target.value })}
                autoFocus
              />
            </Field>
            <Field label="Date">
              <Input type="date" value={sale.date} onChange={(e) => setSale({ ...sale, date: e.target.value })} />
            </Field>
            <Field label="Sold on" className="col-span-2">
              <Input
                value={sale.platform}
                onChange={(e) => setSale({ ...sale, platform: e.target.value })}
                placeholder="eBay, Facebook Marketplace…"
              />
            </Field>
          </div>
        )}

        {mode === "view" && (
          <>
            <div className="flex flex-col gap-2">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-surface-2">
                {image ? (
                  <img src={`/api/images/${image.path}`} alt={item.name} className="size-full object-contain" />
                ) : (
                  <button
                    onClick={() => photoInput.current?.click()}
                    className="flex size-full flex-col items-center justify-center gap-2 text-muted"
                  >
                    <ImagePlus size={28} />
                    <span className="text-sm">Add a photo</span>
                  </button>
                )}
                {busy === "photo" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <Spinner className="size-6 text-white" />
                  </div>
                )}
              </div>
              {item.images.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {item.images.map((img, i) => (
                    <button
                      key={img.id}
                      onClick={() => setImageIndex(i)}
                      className={cn(
                        "relative size-14 shrink-0 overflow-hidden rounded-lg border-2",
                        img.id === image?.id ? "border-accent" : "border-transparent",
                      )}
                    >
                      <img src={`/api/images/${img.path}`} alt="" className="size-full object-cover" />
                      {img.isPrimary && (
                        <span className="absolute bottom-0.5 left-0.5 rounded-full bg-black/60 p-0.5 text-white">
                          <Star size={9} fill="currentColor" />
                        </span>
                      )}
                    </button>
                  ))}
                  <button
                    onClick={() => photoInput.current?.click()}
                    className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted"
                    aria-label="Add photo"
                  >
                    <ImagePlus size={18} />
                  </button>
                  {image && (
                    <div className="ml-auto flex gap-1">
                      {!image.isPrimary && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Use as cover photo"
                          onClick={() =>
                            run("photo", async () => {
                              await api(`/api/items/${item.id}/images`, jsonBody({ imageId: image.id }, "PATCH"));
                              await refresh();
                            })
                          }
                        >
                          <Star size={16} />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete photo"
                        onClick={() =>
                          confirm("Delete this photo?") &&
                          run("photo", async () => {
                            await api(`/api/items/${item.id}/images?imageId=${image.id}`, { method: "DELETE" });
                            setImageIndex(0);
                            await refresh();
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={item.status} />
              {[item.brand, item.model, item.category].filter(Boolean).map((t) => (
                <span key={t} className="text-sm text-muted">
                  {t}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {item.status === "sold" ? (
                <>
                  <Stat
                    label="Sold for"
                    value={money(item.soldPrice == null ? null : item.soldPrice * item.quantity)}
                    sub={item.quantity > 1 ? `${item.quantity} × ${money(item.soldPrice)}` : undefined}
                  />
                  <Stat
                    label="Profit"
                    value={soldProfit == null ? "—" : signedMoney(soldProfit)}
                    tone={soldProfit == null ? undefined : soldProfit >= 0 ? "good" : "bad"}
                  />
                </>
              ) : (
                <>
                  <Stat
                    label={item.estimatedValue != null ? "Estimated value" : "Value (from MSRP/cost)"}
                    value={money(value == null ? null : value * item.quantity)}
                    sub={item.quantity > 1 ? `${item.quantity} × ${money(value)}` : undefined}
                  />
                  {item.status === "for_sale" ? (
                    <Stat
                      label="Asking"
                      value={money(item.askingPrice == null ? null : item.askingPrice * item.quantity)}
                      sub={item.quantity > 1 ? `${item.quantity} × ${money(item.askingPrice)}` : undefined}
                    />
                  ) : (
                    <Stat
                      label="Gain vs. cost"
                      value={gain == null ? "—" : signedMoney(gain)}
                      tone={gain == null ? undefined : gain >= 0 ? "good" : "bad"}
                    />
                  )}
                </>
              )}
              <Stat
                label={item.quantity > 1 ? "Paid (each)" : "Paid"}
                value={money(item.purchasePrice)}
                sub={item.purchaseDate ?? undefined}
              />
              <Stat label={item.quantity > 1 ? "MSRP (each)" : "MSRP"} value={money(item.msrp)} />
            </div>

            {item.status !== "sold" && (
              <div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted">
                    {item.valueUpdatedAt
                      ? `Value updated ${new Date(item.valueUpdatedAt).toLocaleDateString()}`
                      : "No market estimate yet"}
                  </p>
                  <Button size="sm" onClick={reprice} disabled={busy === "reprice"}>
                    {busy === "reprice" ? <Spinner /> : <RefreshCw size={15} />}
                    {busy === "reprice" ? "Searching…" : "Estimate value"}
                  </Button>
                </div>
                {estimate && (
                  <div className="text-sm">
                    <p>
                      <span className="font-medium">{money(estimate.estimatedValue)}</span>
                      {estimate.low != null && estimate.high != null && (
                        <span className="text-muted">
                          {" "}
                          (range {money(estimate.low)}–{money(estimate.high)})
                        </span>
                      )}
                    </p>
                    <p className="text-muted">{estimate.reasoning}</p>
                    {estimate.sources.length > 0 && (
                      <p className="mt-1 text-xs text-muted">
                        {estimate.sources.slice(0, 4).map((s, i) => (
                          <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline">
                            {i > 0 && " · "}
                            {s.title.slice(0, 40)}
                          </a>
                        ))}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {(
                [
                  ["Condition", item.condition],
                  ["Quantity", String(item.quantity)],
                  ["Location", item.location],
                  ["Barcode", item.upc],
                  ["Listed", item.listedAt ? new Date(item.listedAt).toLocaleDateString() : null],
                  ["Sold", item.status === "sold" ? [item.soldDate, item.soldPlatform].filter(Boolean).join(" · ") || null : null],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            {item.description && <p className="text-sm leading-relaxed">{item.description}</p>}
            {item.notes && <p className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-sm">{item.notes}</p>}

            <Button
              variant="danger"
              size="sm"
              className="self-start"
              onClick={() =>
                confirm(`Delete "${item.name}" and its photos? This can't be undone.`) &&
                run("delete", async () => {
                  await api(`/api/items/${item.id}`, { method: "DELETE" });
                  onDeleted(item.id);
                })
              }
            >
              <Trash2 size={15} /> Delete item
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("tabular text-lg font-semibold", tone === "good" && "text-good", tone === "bad" && "text-bad")}>{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}
