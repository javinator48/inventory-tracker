"use client";

import { Camera, Heart, ImagePlus, Package, Plus, Shirt, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ItemWithImages } from "@/db/schema";
import { api, jsonBody, resizeImage } from "@/lib/client";
import type { OutfitSuggestion } from "@/lib/types";
import { Button, cn, ErrorNote, Input, Sheet, Spinner } from "./ui";

type Piece = { id: string; file: File | null; preview: string | null; name: string; key: string | null };
type TryOn = { status: "loading" } | { status: "done"; key: string } | { status: "error"; message: string };

const MAX_PIECES = 4;

async function upload(file: File) {
  const form = new FormData();
  form.set("file", file);
  return (await api<{ key: string }>("/api/uploads", { method: "POST", body: form })).key;
}

const coverOf = (item: ItemWithImages) => (item.images.find((i) => i.isPrimary) ?? item.images[0])?.path ?? null;

/** "Try it on": pair clothes you're thinking of buying with what you own, and see them on you. */
export function OutfitSheet({
  onClose,
  onSaved,
  onOpenItem,
}: {
  onClose: () => void;
  onSaved: (item: ItemWithImages) => void;
  onOpenItem: (id: number) => void;
}) {
  const [meKey, setMeKey] = useState<string | null | undefined>(undefined);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [typed, setTyped] = useState("");
  const [step, setStep] = useState<"setup" | "loading" | "results">("setup");
  const [result, setResult] = useState<{ suggestion: OutfitSuggestion; items: ItemWithImages[] } | null>(null);
  const [tryOns, setTryOns] = useState<Record<number, TryOn>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meInput = useRef<HTMLInputElement>(null);
  const pieceInput = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    api<{ key: string | null }>("/api/me-photo")
      .then((r) => setMeKey(r.key))
      .catch(() => setMeKey(null));
  }, []);

  // Revoke local previews when the sheet closes.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

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

  const setMePhoto = (file: File | undefined) =>
    file &&
    run("me", async () => {
      const key = await upload(await resizeImage(file));
      setMeKey((await api<{ key: string }>("/api/me-photo", jsonBody({ key }, "PUT"))).key);
    });

  const removeMePhoto = () =>
    confirm("Delete your saved photo?") &&
    run("me", async () => {
      await api("/api/me-photo", { method: "DELETE" });
      setMeKey(null);
    });

  const addPhotoPiece = async (file: File | undefined) => {
    if (!file || pieces.length >= MAX_PIECES) return;
    const small = await resizeImage(file);
    const preview = URL.createObjectURL(small);
    previews.current.push(preview);
    setPieces((p) => [...p, { id: crypto.randomUUID(), file: small, preview, name: "", key: null }]);
  };

  const addNamedPiece = () => {
    const name = typed.trim();
    if (!name || pieces.length >= MAX_PIECES) return;
    setPieces((p) => [...p, { id: crypto.randomUUID(), file: null, preview: null, name, key: null }]);
    setTyped("");
  };

  const findOutfits = () =>
    run("find", async () => {
      setStep("loading");
      try {
        const uploaded = await Promise.all(
          pieces.map(async (p) => ({ ...p, key: p.key ?? (p.file ? await upload(p.file) : null) })),
        );
        setPieces(uploaded);
        const res = await api<{ suggestion: OutfitSuggestion; items: ItemWithImages[] }>(
          "/api/outfits",
          jsonBody({ pieces: uploaded.map((p) => ({ imageKey: p.key, name: p.name || null })) }),
        );
        setResult(res);
        setTryOns({});
        setSaved({});
        setStep("results");
      } catch (err) {
        setStep("setup");
        throw err;
      }
    });

  const tryOn = async (index: number) => {
    if (!result) return;
    const outfit = result.suggestion.outfits[index];
    setTryOns((t) => ({ ...t, [index]: { status: "loading" } }));
    try {
      const { key } = await api<{ key: string }>(
        "/api/outfits/try-on",
        jsonBody({
          title: `${outfit.title}: ${outfit.why}`.slice(0, 200),
          ownedItemIds: outfit.ownedItemIds,
          newItems: outfit.newItemIndexes.map((i) => ({
            imageKey: pieces[i]?.key ?? null,
            name: [result.suggestion.newItems[i].name, result.suggestion.newItems[i].description].filter(Boolean).join(": "),
          })),
        }),
      );
      setTryOns((t) => ({ ...t, [index]: { status: "done", key } }));
    } catch (err) {
      setTryOns((t) => ({ ...t, [index]: { status: "error", message: err instanceof Error ? err.message : "Try-on failed" } }));
    }
  };

  const addToWishlist = (index: number) =>
    run(`wish-${index}`, async () => {
      if (!result) return;
      const info = result.suggestion.newItems[index];
      const item = await api<ItemWithImages>(
        "/api/items",
        jsonBody({ name: info.name, category: info.category, description: info.description, status: "considering" }),
      );
      const file = pieces[index]?.file;
      if (file) {
        const form = new FormData();
        form.set("file", file);
        form.set("source", "upload");
        await api(`/api/items/${item.id}/images`, { method: "POST", body: form }).catch(() => {});
      }
      onSaved(await api<ItemWithImages>(`/api/items/${item.id}`));
      setSaved((s) => ({ ...s, [index]: true }));
    });

  const byId = new Map((result?.items ?? []).map((i) => [i.id, i]));

  return (
    <Sheet
      open
      onClose={onClose}
      title={step === "results" ? "Outfit ideas" : "Try it on"}
      footer={
        step === "setup" ? (
          <Button variant="primary" className="w-full" onClick={findOutfits} disabled={pieces.length === 0 || busy != null}>
            <Sparkles size={16} /> Find outfits
          </Button>
        ) : step === "results" ? (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => setStep("setup")}>
              Change pieces
            </Button>
            <Button variant="primary" className="flex-1" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : undefined
      }
    >
      <input
        ref={meInput}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          void setMePhoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={pieceInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void addPhotoPiece(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {step === "setup" && (
        <div className="flex flex-col gap-5">
          {error && <ErrorNote>{error}</ErrorNote>}

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Your photo</h3>
            <div className="flex items-center gap-3 rounded-2xl border border-border p-3">
              <div className="relative h-24 w-18 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                {meKey ? (
                  <img src={`/api/images/${meKey}`} alt="Your saved photo" className="absolute inset-0 size-full object-cover" />
                ) : (
                  <Camera size={22} className="absolute inset-0 m-auto text-muted/60" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-xs text-muted">
                  {meKey
                    ? "Used for every try-on. It's sent to Google Gemini only when you ask to see an outfit on you."
                    : "A full-length photo works best: standing, facing the camera, in good light."}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => meInput.current?.click()} disabled={busy === "me"}>
                    {busy === "me" ? <Spinner /> : <Camera size={15} />} {meKey ? "Replace" : "Add your photo"}
                  </Button>
                  {meKey && (
                    <Button size="sm" variant="ghost" onClick={removeMePhoto} aria-label="Delete your photo" disabled={busy === "me"}>
                      <Trash2 size={15} />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">What are you thinking of buying?</h3>
            <p className="text-xs text-muted">Add up to {MAX_PIECES} pieces: a photo from the shop or a screenshot, or just a name.</p>
            {pieces.length > 0 && (
              <ul className="flex flex-col gap-2">
                {pieces.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-xl border border-border p-2">
                    <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                      {p.preview ? (
                        <img src={p.preview} alt="" className="absolute inset-0 size-full object-cover" />
                      ) : (
                        <Shirt size={20} className="absolute inset-0 m-auto text-muted/60" />
                      )}
                    </span>
                    <Input
                      value={p.name}
                      onChange={(e) => setPieces((all) => all.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))}
                      placeholder={p.preview ? "Name (optional)" : "Name"}
                      className="min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => setPieces((all) => all.filter((x) => x.id !== p.id))}
                      className="rounded-full p-2 text-muted hover:bg-surface-2"
                      aria-label="Remove piece"
                    >
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {pieces.length < MAX_PIECES && (
              <div className="flex flex-col gap-2">
                <Button onClick={() => pieceInput.current?.click()}>
                  <ImagePlus size={16} /> Add a photo of it
                </Button>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addNamedPiece();
                  }}
                >
                  <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="…or type it, e.g. brown suede Chelsea boots" />
                  <Button type="submit" disabled={!typed.trim()} aria-label="Add piece">
                    <Plus size={16} />
                  </Button>
                </form>
              </div>
            )}
          </section>
        </div>
      )}

      {step === "loading" && (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <Spinner className="size-7 text-accent" />
          <p className="text-sm text-muted">Going through your wardrobe…</p>
          <p className="text-xs text-muted/80">This can take up to a minute.</p>
        </div>
      )}

      {step === "results" && result && (
        <div className="flex flex-col gap-4">
          {error && <ErrorNote>{error}</ErrorNote>}
          <p className="text-sm leading-relaxed">{result.suggestion.advice}</p>

          {result.suggestion.overlaps.map((o) => {
            const owned = byId.get(o.ownedItemId);
            return (
              <button
                key={`${o.newItemIndex}-${o.ownedItemId}`}
                type="button"
                onClick={() => onOpenItem(o.ownedItemId)}
                className="rounded-2xl bg-warn/10 p-3 text-left text-sm text-warn"
              >
                <span className="font-semibold">You already own something like this:</span> {owned?.name}. {o.note}
              </button>
            );
          })}

          {result.suggestion.outfits.map((outfit, index) => {
            const state = tryOns[index];
            return (
              <article key={index} className="flex flex-col gap-3 rounded-2xl border border-border p-3.5">
                <div>
                  <h3 className="font-semibold">{outfit.title}</h3>
                  <p className="text-xs text-muted">{outfit.occasion}</p>
                </div>
                <ul className="flex gap-2 overflow-x-auto pb-1">
                  {outfit.newItemIndexes.map((i) => (
                    <PieceThumb key={`n${i}`} src={pieces[i]?.preview ?? null} label={result.suggestion.newItems[i].name} tag="New" />
                  ))}
                  {outfit.ownedItemIds.map((id) => {
                    const item = byId.get(id);
                    const key = item && coverOf(item);
                    return (
                      <PieceThumb
                        key={`o${id}`}
                        src={key ? `/api/images/${key}` : null}
                        label={item?.name ?? "Owned item"}
                        onClick={() => onOpenItem(id)}
                      />
                    );
                  })}
                </ul>
                <p className="text-sm leading-relaxed text-muted">{outfit.why}</p>

                {state?.status === "done" ? (
                  <button type="button" onClick={() => setZoom(state.key)} className="overflow-hidden rounded-xl bg-surface-2">
                    <img src={`/api/images/${state.key}`} alt={`You wearing ${outfit.title}`} className="w-full object-cover" />
                  </button>
                ) : (
                  <>
                    {state?.status === "error" && <ErrorNote>{state.message}</ErrorNote>}
                    <Button onClick={() => tryOn(index)} disabled={!meKey || state?.status === "loading"}>
                      {state?.status === "loading" ? <Spinner /> : <Sparkles size={16} />}
                      {state?.status === "loading" ? "Dressing you up…" : meKey ? "See it on me" : "Add your photo to see it on you"}
                    </Button>
                  </>
                )}
              </article>
            );
          })}

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Not sure yet?</h3>
            {result.suggestion.newItems.map((n, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-2">
                <span className="min-w-0 flex-1 truncate text-sm">{n.name}</span>
                <Button size="sm" onClick={() => addToWishlist(i)} disabled={saved[i] || busy === `wish-${i}`}>
                  {busy === `wish-${i}` ? <Spinner /> : <Heart size={15} />} {saved[i] ? "On your wishlist" : "Add to wishlist"}
                </Button>
              </div>
            ))}
          </section>
        </div>
      )}

      {zoom && (
        <button
          type="button"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          aria-label="Close image"
        >
          <img src={`/api/images/${zoom}`} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
        </button>
      )}
    </Sheet>
  );
}

function PieceThumb({ src, label, tag, onClick }: { src: string | null; label: string; tag?: string; onClick?: () => void }) {
  return (
    <li className="w-20 shrink-0">
      <button type="button" onClick={onClick} disabled={!onClick} className="flex w-full flex-col gap-1 text-left" title={label}>
        <span className={cn("relative block size-20 overflow-hidden rounded-xl bg-surface-2", tag && "ring-2 ring-accent")}>
          {src ? (
            <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            <Package size={20} strokeWidth={1.5} className="absolute inset-0 m-auto text-muted/60" />
          )}
          {tag && <span className="absolute left-1 top-1 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-fg">{tag}</span>}
        </span>
        <span className="line-clamp-2 text-[11px] leading-tight text-muted">{label}</span>
      </button>
    </li>
  );
}
