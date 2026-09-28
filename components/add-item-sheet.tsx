"use client";

import { Camera, Check, ImagePlus, PenLine, ScanBarcode, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ItemStatus, ItemWithImages } from "@/db/schema";
import { api, jsonBody, resizeImage } from "@/lib/client";
import type { ProductInfo } from "@/lib/types";
import { BarcodeScanner } from "./barcode-scanner";
import { emptyValues, ItemForm, toPayload, valuesFromProduct, type ItemFormValues } from "./item-form";
import { Button, cn, ErrorNote, Sheet, Spinner } from "./ui";

type Step = "choose" | "scan" | "looking" | "review";

/** Mount this only while adding, so each opening starts from a clean slate. */
export function AddItemSheet({
  onClose,
  onSaved,
  defaultStatus,
  categories,
}: {
  onClose: () => void;
  onSaved: (item: ItemWithImages) => void;
  defaultStatus: ItemStatus;
  categories: string[];
}) {
  const [step, setStep] = useState<Step>("choose");
  const [lookingLabel, setLookingLabel] = useState("");
  const [values, setValues] = useState<ItemFormValues>(emptyValues);
  const [status, setStatus] = useState<ItemStatus>(defaultStatus === "sold" ? "owned" : defaultStatus);
  const [photo, setPhoto] = useState<File | null>(null);
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [webImages, setWebImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const identifyInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);

  const applyProduct = (p: ProductInfo, opts: { note?: string; hasPhoto: boolean }) => {
    setProduct(p);
    setNote(opts.note ?? null);
    setValues((v) => valuesFromProduct(p, v));
    // Pre-select the first web image when there's no photo of the actual item.
    setWebImages(p.imageUrls.length && !opts.hasPhoto ? [p.imageUrls[0]] : []);
  };

  const onBarcode = useCallback(async (code: string) => {
    setStep("looking");
    setLookingLabel(`Looking up ${code}…`);
    setError(null);
    try {
      const res = await api<{ product: ProductInfo; note?: string }>("/api/lookup/barcode", jsonBody({ upc: code }));
      applyProduct(res.product, { note: res.note, hasPhoto: false });
    } catch (err) {
      setValues((v) => ({ ...v, upc: code.replace(/\D/g, "") }));
      setError(err instanceof Error ? err.message : "Lookup failed");
    }
    setStep("review");
  }, []);

  const identify = async (opts: { image?: File; query?: string }) => {
    setStep("looking");
    setLookingLabel(opts.image ? "Identifying your photo and searching the web…" : "Searching the web…");
    setError(null);
    try {
      let res: { product: ProductInfo };
      if (opts.image) {
        const form = new FormData();
        form.set("image", opts.image);
        if (values.name.trim()) form.set("hint", values.name.trim());
        res = await api("/api/identify", { method: "POST", body: form });
      } else {
        res = await api("/api/identify", jsonBody({ query: opts.query }));
      }
      applyProduct(res.product, { hasPhoto: Boolean(opts.image) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Identification failed");
    }
    setStep("review");
  };

  const onIdentifyPhoto = async (file: File | undefined) => {
    if (!file) return;
    const small = await resizeImage(file);
    setPhoto(small);
    await identify({ image: small });
  };

  const save = async () => {
    if (!values.name.trim()) return setError("Give the item a name first.");
    setSaving(true);
    setError(null);
    try {
      const item = await api<ItemWithImages>("/api/items", jsonBody({ ...toPayload(values), status }));
      const imageErrors: string[] = [];
      if (photo) {
        const form = new FormData();
        form.set("file", photo);
        await api(`/api/items/${item.id}/images`, { method: "POST", body: form }).catch((e: Error) =>
          imageErrors.push(e.message),
        );
      }
      for (const url of webImages) {
        await api(`/api/items/${item.id}/images`, jsonBody({ url, source: product?.provider === "upcitemdb" ? "barcode" : "web" })).catch(
          (e: Error) => imageErrors.push(e.message),
        );
      }
      const saved = await api<ItemWithImages>(`/api/items/${item.id}`);
      onSaved(saved);
      if (imageErrors.length) alert(`Item saved, but ${imageErrors.length} image(s) couldn't be added:\n${imageErrors.join("\n")}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const title = { choose: "Add an item", scan: "Scan barcode", looking: "Looking it up", review: "Review item" }[step];

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        step === "review" && (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => setStep("choose")}>
              Back
            </Button>
            <Button variant="primary" className="flex-[2]" onClick={save} disabled={saving}>
              {saving ? <Spinner /> : <Check size={18} />} Save item
            </Button>
          </div>
        )
      }
    >
      <input
        ref={identifyInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void onIdentifyPhoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) setPhoto(await resizeImage(file));
        }}
      />

      {step === "choose" && (
        <div className="flex flex-col gap-3">
          <MethodButton
            icon={<ScanBarcode size={22} />}
            title="Scan barcode"
            detail="Fills in the name, description and MSRP from the product's barcode."
            onClick={() => setStep("scan")}
          />
          <MethodButton
            icon={<Sparkles size={22} />}
            title="Snap a photo and identify"
            detail="Take a picture and Claude works out what it is and what it's worth."
            onClick={() => identifyInput.current?.click()}
          />
          <MethodButton
            icon={<PenLine size={22} />}
            title="Enter manually"
            detail="Type the details yourself. You can still look it up online from the form."
            onClick={() => setStep("review")}
          />
        </div>
      )}

      {step === "scan" && <BarcodeScanner onDetected={onBarcode} />}

      {step === "looking" && (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          {photoUrl && <img src={photoUrl} alt="" className="size-28 rounded-2xl object-cover" />}
          <Spinner className="size-7 text-accent" />
          <p className="text-sm text-muted">{lookingLabel}</p>
          <p className="text-xs text-muted/80">Web searches can take up to a minute.</p>
        </div>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-4">
          {error && <ErrorNote>{error}</ErrorNote>}
          {product && (
            <div className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
              Found with {product.provider === "upcitemdb" ? "UPCitemdb" : "Claude web search"}
              {product.confidence && product.provider === "claude" && ` · ${product.confidence} confidence`}
              {note && ` · ${note}`}
              {product.sources.length > 0 && (
                <span>
                  {" · "}
                  {product.sources.slice(0, 3).map((s, i) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline">
                      {i > 0 && ", "}
                      {s.title.slice(0, 30)}
                    </a>
                  ))}
                </span>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted">Photos</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photoUrl && (
                <Thumb src={photoUrl} selected onClick={() => setPhoto(null)} label="Your photo · tap to remove" />
              )}
              {product?.imageUrls.map((url) => (
                <Thumb
                  key={url}
                  src={url}
                  selected={webImages.includes(url)}
                  onClick={() => setWebImages((s) => (s.includes(url) ? s.filter((u) => u !== url) : [...s, url]))}
                  label="Web image"
                />
              ))}
              <button
                onClick={() => photoInput.current?.click()}
                className="flex size-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-muted hover:bg-surface-2"
              >
                <ImagePlus size={20} />
                <span className="text-[10px]">{photo ? "Replace" : "Add photo"}</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => (photo ? identify({ image: photo }) : identify({ query: [values.brand, values.name, values.model].filter(Boolean).join(" ") }))}
                disabled={!photo && !values.name.trim()}
              >
                <Sparkles size={16} /> {photo ? "Identify from photo" : "Find details & images online"}
              </Button>
              {!photo && (
                <Button size="sm" onClick={() => identifyInput.current?.click()}>
                  <Camera size={16} /> Take photo & identify
                </Button>
              )}
            </div>
          </div>

          <div className="flex rounded-xl bg-surface-2 p-1 text-sm">
            {(["owned", "for_sale"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cn("flex-1 rounded-lg py-1.5 font-medium", status === s ? "bg-surface shadow-sm" : "text-muted")}
              >
                {s === "owned" ? "I own it" : "I'm selling it"}
              </button>
            ))}
          </div>

          <ItemForm values={values} onChange={setValues} status={status} categories={categories} />
        </div>
      )}
    </Sheet>
  );
}

export function MethodButton({ icon, title, detail, onClick }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-3 rounded-2xl border border-border p-4 text-left transition-colors hover:bg-surface-2"
    >
      <span className="rounded-xl bg-accent/12 p-2.5 text-accent">{icon}</span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted">{detail}</span>
      </span>
    </button>
  );
}

function Thumb({ src, selected, onClick, label }: { src: string; selected: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "relative size-20 shrink-0 overflow-hidden rounded-xl border-2 bg-surface-2",
        selected ? "border-accent" : "border-transparent opacity-60",
      )}
    >
      <img src={src} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
      {selected && (
        <span className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-accent-fg">
          <Check size={12} />
        </span>
      )}
    </button>
  );
}
