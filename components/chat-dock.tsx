"use client";

import { Bot, Check, ChevronDown, ImagePlus, SendHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { api, jsonBody, money, resizeImage } from "@/lib/client";
import type { ItemWithImages } from "@/db/schema";
import type { ChatEvent, ItemProposal } from "@/lib/types";
import { Button, cn, Spinner } from "./ui";

type Message = { role: "user" | "assistant"; content: string; proposals?: ItemProposal[]; images?: string[] };
type Attachment = { file: File; preview: string };

const MAX_ATTACHMENTS = 4;
/** Placeholder text the server stores for a photo-only message. */
const PHOTO_ONLY = "(photo)";

const SUGGESTIONS = [
  "What's my most valuable item?",
  "What should I consider selling?",
  "I'm thinking of buying a new watch",
  "What have I made from selling so far?",
];

/** Inventory assistant: a bar docked at the bottom that expands into a chat panel. */
export function ChatDock({ onItemSaved }: { onItemSaved?: (item: ItemWithImages) => void }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    api<(Pick<Message, "role" | "content"> & { proposals: ItemProposal[] | null; images: string[] | null })[]>("/api/chat")
      .then((rows) =>
        setMessages(
          rows.map(({ role, content, proposals, images }) => ({
            role,
            content,
            proposals: proposals ?? undefined,
            images: images ?? undefined,
          })),
        ),
      )
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, status, open]);

  const attach = async (files: FileList | null) => {
    const room = MAX_ATTACHMENTS - attachments.length;
    const picked = [...(files ?? [])].slice(0, room);
    const resized = await Promise.all(picked.map((f) => resizeImage(f)));
    setAttachments((a) => [...a, ...resized.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  };

  const removeAttachment = (index: number) =>
    setAttachments((a) => {
      URL.revokeObjectURL(a[index].preview);
      return a.filter((_, i) => i !== index);
    });

  const send = async (text: string) => {
    const message = text.trim();
    if ((!message && attachments.length === 0) || streaming) return;
    setOpen(true);
    setInput("");
    setStreaming(true);
    setStatus(attachments.length ? "Uploading photos…" : "Thinking…");

    let images: string[] = [];
    try {
      images = await Promise.all(
        attachments.map(async (a) => {
          const form = new FormData();
          form.set("file", a.file);
          return (await api<{ key: string }>("/api/uploads", { method: "POST", body: form })).key;
        }),
      );
    } catch (err) {
      setInput(text);
      setStreaming(false);
      setStatus(null);
      alert(err instanceof Error ? err.message : "Couldn't upload the photos");
      return;
    }
    attachments.forEach((a) => URL.revokeObjectURL(a.preview));
    setAttachments([]);
    setStatus("Thinking…");
    setMessages((m) => [
      ...m,
      { role: "user", content: message || PHOTO_ONLY, images: images.length ? images : undefined },
      { role: "assistant", content: "" },
    ]);

    const appendToReply = (text: string) =>
      setMessages((m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, content: last.content + text };
        return copy;
      });

    const addImage = (key: string) =>
      setMessages((m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, images: [...(last.images ?? []), key] };
        return copy;
      });

    const addProposal = (proposal: ItemProposal) =>
      setMessages((m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, proposals: [...(last.proposals ?? []), proposal] };
        return copy;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, images }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "text") {
            setStatus(null);
            appendToReply(event.text);
          } else if (event.type === "status") setStatus(event.status);
          else if (event.type === "item_saved") onItemSaved?.(event.item);
          else if (event.type === "proposal") addProposal(event.proposal);
          else if (event.type === "image") addImage(event.key);
          else if (event.type === "error") throw new Error(event.error);
        }
      }
    } catch (err) {
      appendToReply(`\n\n_⚠️ ${err instanceof Error ? err.message : "Something went wrong"}_`);
    } finally {
      setStreaming(false);
      setStatus(null);
    }
  };

  const clear = async () => {
    if (!confirm("Clear the chat history?")) return;
    await api("/api/chat", { method: "DELETE" });
    setMessages([]);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div
        className={cn(
          "flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-[height]",
          open ? "h-[72dvh]" : "h-auto",
        )}
      >
        {open && (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <Bot size={18} className="text-accent" />
              <span className="flex-1 text-sm font-semibold">Inventory assistant</span>
              {messages.length > 0 && (
                <button onClick={clear} className="rounded-full p-2 text-muted hover:bg-surface-2" aria-label="Clear chat">
                  <Trash2 size={16} />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="rounded-full p-2 text-muted hover:bg-surface-2" aria-label="Minimize chat">
                <ChevronDown size={18} />
              </button>
            </div>
            <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
              {messages.length === 0 && loaded && (
                <div className="flex flex-col gap-2 py-4">
                  <p className="text-sm text-muted">Ask anything about your stuff. I can look through your inventory, add new items, and search the web for prices.</p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => send(s)} className="rounded-full bg-surface-2 px-3 py-1.5 text-sm hover:bg-border">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex max-w-[85%] flex-col items-end gap-1.5 self-end">
                    {m.images && <ImageStrip keys={m.images} onOpen={setZoom} small />}
                    {m.content !== PHOTO_ONLY && (
                      <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-accent-fg">
                        {m.content}
                      </div>
                    )}
                  </div>
                ) : m.content || m.proposals || m.images ? (
                  <div key={i} className="flex max-w-[95%] flex-col gap-2">
                    {m.content && (
                      <div className="chat-markdown text-sm leading-relaxed">
                        <Markdown
                          components={{
                            a: (props) => <a {...props} target="_blank" rel="noreferrer" className="text-accent underline" />,
                          }}
                        >
                          {m.content}
                        </Markdown>
                      </div>
                    )}
                    {m.images && <ImageStrip keys={m.images} onOpen={setZoom} />}
                    {m.proposals?.map((p) => <ProposalCard key={p.id} proposal={p} onApplied={onItemSaved} />)}
                  </div>
                ) : null,
              )}
              {status && (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Spinner className="size-3.5" /> {status}
                </div>
              )}
            </div>
          </>
        )}
        {attachments.length > 0 && (
          <div className="flex gap-2 border-t border-border px-3 pt-2">
            {attachments.map((a, i) => (
              <div key={a.preview} className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                <img src={a.preview} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                  aria-label="Remove photo"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void attach(e.target.files);
            e.target.value = "";
          }}
        />
        <form
          className={cn("flex items-center gap-2 p-2", open && attachments.length === 0 && "border-t border-border")}
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          {!open && <Bot size={20} className="ml-2 shrink-0 text-accent" />}
          {open && (
            <button
              type="button"
              onClick={() => photoInput.current?.click()}
              disabled={streaming || attachments.length >= MAX_ATTACHMENTS}
              className="rounded-full p-2 text-muted hover:bg-surface-2 disabled:opacity-40"
              aria-label="Attach a photo"
            >
              <ImagePlus size={20} />
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder="Ask about your inventory…"
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-base outline-none placeholder:text-muted sm:text-sm"
          />
          <button
            type="submit"
            disabled={(!input.trim() && attachments.length === 0) || streaming}
            className="rounded-full bg-accent p-2.5 text-accent-fg disabled:opacity-40"
            aria-label="Send"
          >
            {streaming ? <Spinner /> : <SendHorizontal size={18} />}
          </button>
        </form>
      </div>
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
    </div>
  );
}

/** Photos in a message: small thumbnails for attachments, larger for try-on images. */
function ImageStrip({ keys, onOpen, small }: { keys: string[]; onOpen: (key: string) => void; small?: boolean }) {
  return (
    <div className={cn("flex flex-wrap gap-2", small && "justify-end")}>
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onOpen(key)}
          className={cn("overflow-hidden rounded-xl bg-surface-2", small ? "size-20" : "w-full max-w-72")}
        >
          <img src={`/api/images/${key}`} alt="" className={cn("object-cover", small ? "size-full" : "w-full")} />
        </button>
      ))}
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  brand: "Brand",
  model: "Model",
  category: "Category",
  description: "Description",
  upc: "UPC",
  condition: "Condition",
  quantity: "Quantity",
  location: "Location",
  notes: "Notes",
  status: "Status",
  purchasePrice: "Purchase price",
  purchaseDate: "Purchase date",
  msrp: "MSRP",
  estimatedValue: "Estimated value",
  askingPrice: "Asking price",
  soldPrice: "Sold price",
  soldDate: "Sold date",
  soldPlatform: "Sold on",
  joy: "Sparks joy?",
  considerUntil: "Wait until",
};
const MONEY_FIELDS = new Set(["purchasePrice", "msrp", "estimatedValue", "askingPrice", "soldPrice"]);
const STATUS_LABELS: Record<string, string> = { owned: "Owned", for_sale: "For sale", sold: "Sold", considering: "Wishlist" };
const JOY_LABELS: Record<string, string> = { sparks: "✨ Sparks joy", neutral: "Neutral", no: "Doesn't" };

function formatValue(field: string, value: string | number | null) {
  if (value == null || value === "") return "—";
  if (MONEY_FIELDS.has(field)) return money(Number(value));
  if (field === "status") return STATUS_LABELS[value] ?? String(value);
  if (field === "joy") return JOY_LABELS[value] ?? String(value);
  return String(value);
}

/** An edit suggested by the assistant; nothing is saved until the user taps Apply. */
function ProposalCard({ proposal, onApplied }: { proposal: ItemProposal; onApplied?: (item: ItemWithImages) => void }) {
  const [state, setState] = useState<"pending" | "saving" | "applied" | "dismissed">("pending");
  const [error, setError] = useState<string | null>(null);

  // Cards come back with the chat history; show ones whose values are already saved as done.
  useEffect(() => {
    api<ItemWithImages>(`/api/items/${proposal.itemId}`)
      .then((item) => {
        const current = item as unknown as Record<string, unknown>;
        if (proposal.changes.every((c) => (current[c.field] ?? null) === c.to)) setState("applied");
      })
      .catch(() => {});
  }, [proposal]);

  const apply = async () => {
    setState("saving");
    setError(null);
    try {
      const item = await api<ItemWithImages>(`/api/items/${proposal.itemId}`, jsonBody(proposal.patch, "PATCH"));
      onApplied?.(item);
      setState("applied");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
      setState("pending");
    }
  };

  return (
    <div className={cn("rounded-2xl border border-border bg-surface-2/50 p-3 text-sm", state === "dismissed" && "opacity-60")}>
      <p className="mb-2 font-medium">Update {proposal.itemName}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {proposal.changes.map((c) => (
          <div key={c.field} className="contents">
            <dt className="text-muted">{FIELD_LABELS[c.field] ?? c.field}</dt>
            <dd className="min-w-0 break-words">
              <span className="text-muted line-through">{formatValue(c.field, c.from)}</span>
              {" → "}
              <span className="font-medium">{formatValue(c.field, c.to)}</span>
            </dd>
          </div>
        ))}
      </dl>
      {error && <p className="mt-2 text-bad">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        {state === "applied" ? (
          <span className="flex items-center gap-1 text-good">
            <Check size={16} /> Saved
          </span>
        ) : state === "dismissed" ? (
          <span className="text-muted">Dismissed</span>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={apply} disabled={state === "saving"}>
              {state === "saving" ? <Spinner /> : <Check size={16} />} Apply
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setState("dismissed")} disabled={state === "saving"}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
