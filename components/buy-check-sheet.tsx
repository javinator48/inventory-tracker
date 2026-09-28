"use client";

import { Camera, Check, Heart, ScanBarcode, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ItemWithImages } from "@/db/schema";
import { api, jsonBody, resizeImage } from "@/lib/client";
import type { BuyCheck, ProductInfo } from "@/lib/types";
import { MethodButton } from "./add-item-sheet";
import { BarcodeScanner } from "./barcode-scanner";
import { dateInDays, VerdictView, WAIT_OPTIONS } from "./mindful";
import { Button, cn, ErrorNote, Field, Input, Sheet, Spinner } from "./ui";

type Step = "ask" | "scan" | "checking" | "result";
type Candidate = { name: string; brand?: string | null; model?: string | null; category?: string | null; description?: string | null; msrp?: number | null };

const today = () => new Date().toLocaleDateString("en-CA");

const fromProduct = (p: ProductInfo): Candidate => ({
  name: p.name,
  brand: p.brand,
  model: p.model,
  category: p.category,
  description: p.description,
  msrp: p.msrp,
});

/** "Before you buy": compares a potential purchase with what the user owns. Mount only while open. */
export function BuyCheckSheet({
  onClose,
  onSaved,
  onOpenItem,
}: {
  onClose: () => void;
  onSaved: (item: ItemWithImages) => void;
  onOpenItem: (id: number) => void;
}) {
  const [step, setStep] = useState<Step>("ask");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [result, setResult] = useState<{ check: BuyCheck; items: ItemWithImages[] } | null>(null);
  const [waitDays, setWaitDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"wishlist" | "bought" | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  /** Background lookup of details and photos for a typed name, awaited when saving. */
  const lookup = useRef<Promise<ProductInfo | null> | null>(null);

  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);

  const priceValue = price.trim() === "" ? null : Number(price);
  // Read by callbacks that must stay stable while the barcode scanner is mounted.
  const priceRef = useRef(priceValue);
  useEffect(() => {
    priceRef.current = priceValue;
  }, [priceValue]);

  const runCheck = useCallback(async (c: Candidate) => {
    setCandidate(c);
    setStep("checking");
    setLabel("Comparing with everything you own…");
    const res = await api<{ check: BuyCheck; items: ItemWithImages[] }>(
      "/api/buy-check",
      jsonBody({ product: { ...c, price: priceRef.current } }),
    );
    setResult(res);
    setStep("result");
  }, []);

  const fail = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : "Something went wrong");
    setStep("ask");
  }, []);

  /** Typed name: run the check straight away, and look up details and photos alongside it for the wishlist. */
  const checkByName = async () => {
    const query = name.trim();
    if (!query) return;
    setError(null);
    lookup.current = api<{ product: ProductInfo }>("/api/identify", jsonBody({ query }))
      .then((r) => {
        setProduct(r.product);
        return r.product;
      })
      .catch(() => null);
    await runCheck({ name: query }).catch(fail);
  };

  const onBarcode = useCallback(
    async (code: string) => {
      setError(null);
      setStep("checking");
      setLabel(`Looking up ${code}…`);
      try {
        const { product: p } = await api<{ product: ProductInfo }>("/api/lookup/barcode", jsonBody({ upc: code }));
        setProduct(p);
        setName(p.name);
        await runCheck(fromProduct(p));
      } catch (err) {
        fail(err);
      }
    },
    [runCheck, fail],
  );

  const checkByPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const small = await resizeImage(file);
    setPhoto(small);
    setStep("checking");
    setLabel("Working out what this is…");
    try {
      const form = new FormData();
      form.set("image", small);
      if (name.trim()) form.set("hint", name.trim());
      const { product: p } = await api<{ product: ProductInfo }>("/api/identify", { method: "POST", body: form });
      setProduct(p);
      setName(p.name);
      await runCheck(fromProduct(p));
    } catch (err) {
      fail(err);
    }
  };

  const save = async (kind: "wishlist" | "bought") => {
    if (!candidate || !result) return;
    setSaving(kind);
    setError(null);
    try {
      const found = product ?? (await lookup.current);
      const details = found ? fromProduct(found) : candidate;
      const item = await api<ItemWithImages>(
        "/api/items",
        jsonBody({
          name: details.name,
          brand: details.brand ?? null,
          model: details.model ?? null,
          category: details.category ?? null,
          description: details.description ?? null,
          upc: found?.upc ?? null,
          msrp: details.msrp ?? null,
          estimatedValue: kind === "wishlist" ? (priceValue ?? details.msrp ?? null) : (found?.estimatedValue ?? null),
          ...(kind === "wishlist"
            ? { status: "considering", considerUntil: dateInDays(waitDays), buyCheck: result.check }
            : { status: "owned", purchasePrice: priceValue, purchaseDate: today() }),
        }),
      );
      if (photo) {
        const form = new FormData();
        form.set("file", photo);
        await api(`/api/items/${item.id}/images`, { method: "POST", body: form }).catch(() => {});
      } else if (found?.imageUrls[0]) {
        await api(`/api/items/${item.id}/images`, jsonBody({ url: found.imageUrls[0], source: "web" })).catch(() => {});
      }
      onSaved(await api<ItemWithImages>(`/api/items/${item.id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(null);
    }
  };

  const title = { ask: "Before you buy", scan: "Scan barcode", checking: "Thinking it over", result: candidate?.name ?? "Before you buy" }[step];

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        step === "result" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">Wait</span>
              <div className="flex flex-1 rounded-xl bg-surface-2 p-1">
                {WAIT_OPTIONS.map((o) => (
                  <button
                    key={o.days}
                    type="button"
                    onClick={() => setWaitDays(o.days)}
                    className={cn("flex-1 rounded-lg py-1 font-medium", waitDays === o.days ? "bg-surface shadow-sm" : "text-muted")}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1 whitespace-nowrap px-3" onClick={onClose} disabled={saving != null}>
                Skip
              </Button>
              <Button className="flex-1 whitespace-nowrap px-3" onClick={() => save("bought")} disabled={saving != null}>
                {saving === "bought" ? <Spinner /> : <Check size={16} />} Bought it
              </Button>
              <Button variant="primary" className="flex-[1.3] whitespace-nowrap px-3" onClick={() => save("wishlist")} disabled={saving != null}>
                {saving === "wishlist" ? <Spinner /> : <Heart size={16} />} Wishlist
              </Button>
            </div>
          </div>
        )
      }
    >
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void checkByPhoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {step === "ask" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Check a possible purchase against everything you own, so what you bring home is something you&apos;ll love and
            not a near-copy of something you already have.
          </p>
          {error && <ErrorNote>{error}</ErrorNote>}
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void checkByName();
            }}
          >
            <Field label="What are you thinking of buying?">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Casio G-Shock GA-2100" autoFocus />
            </Field>
            <Field label="Price (optional)">
              <Input type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              <Sparkles size={16} /> Check it
            </Button>
          </form>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>
          <MethodButton icon={<ScanBarcode size={22} />} title="Scan its barcode" detail="In a shop? Scan the box." onClick={() => setStep("scan")} />
          <MethodButton
            icon={<Camera size={22} />}
            title="Snap a photo"
            detail="Claude works out what it is, then compares it with what you own."
            onClick={() => photoInput.current?.click()}
          />
        </div>
      )}

      {step === "scan" && <BarcodeScanner onDetected={onBarcode} />}

      {step === "checking" && (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          {photoUrl && <img src={photoUrl} alt="" className="size-28 rounded-2xl object-cover" />}
          <Spinner className="size-7 text-accent" />
          <p className="text-sm text-muted">{label}</p>
          <p className="text-xs text-muted/80">This can take up to a minute.</p>
        </div>
      )}

      {step === "result" && result && (
        <div className="flex flex-col gap-4">
          {error && <ErrorNote>{error}</ErrorNote>}
          <VerdictView check={result.check} items={result.items} onOpenItem={onOpenItem} />
          <p className="text-xs text-muted">
            Still unsure? Put it on your wishlist and decide once the wait is over. It won&apos;t count as something you own.
          </p>
        </div>
      )}
    </Sheet>
  );
}
