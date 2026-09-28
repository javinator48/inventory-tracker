"use client";

// Shared UI for mindful buying: buy-check verdicts, joy ratings and wishlist waits.

import { Package, Sparkles } from "lucide-react";
import type { ItemWithImages, JoyLevel } from "@/db/schema";
import type { BuyCheck } from "@/lib/types";
import { cn } from "./ui";

export const JOY_OPTIONS: { id: JoyLevel; label: string }[] = [
  { id: "sparks", label: "✨ Sparks joy" },
  { id: "neutral", label: "Neutral" },
  { id: "no", label: "Doesn't" },
];

/** Segmented control; tapping the selected option clears the rating. */
export function JoyPicker({
  value,
  onChange,
  disabled,
}: {
  value: JoyLevel | null;
  onChange: (joy: JoyLevel | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex rounded-xl bg-surface-2 p-1 text-sm" role="radiogroup" aria-label="Does it spark joy?">
      {JOY_OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          onClick={() => onChange(value === o.id ? null : o.id)}
          className={cn(
            "flex-1 rounded-lg py-1.5 font-medium transition-colors",
            value === o.id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const WAIT_OPTIONS = [
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
];

export function dateInDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA");
}

/** Whole days until a YYYY-MM-DD date, in local time; 0 or less means it has passed. */
export function daysUntil(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const end = new Date(y, m - 1, d).getTime();
  const start = new Date(new Date().toDateString()).getTime();
  return Math.round((end - start) / 86_400_000);
}

export function waitLabel(considerUntil: string | null) {
  if (!considerUntil) return "Ready to decide";
  const days = daysUntil(considerUntil);
  if (days <= 0) return "Ready to decide";
  return days === 1 ? "1 day left" : `${days} days left`;
}

const VERDICTS: Record<BuyCheck["verdict"], { label: string; className: string }> = {
  go: { label: "Go for it", className: "bg-good/15 text-good" },
  wait: { label: "Wait a little", className: "bg-warn/15 text-warn" },
  skip: { label: "You're covered", className: "bg-accent/15 text-accent" },
};

const RELATIONS = { duplicate: "Almost the same", similar: "Similar", complements: "Goes with it" } as const;

/** A buy-check result: verdict, reasoning, the owned items it overlaps with, and questions. */
export function VerdictView({
  check,
  items,
  onOpenItem,
}: {
  check: BuyCheck;
  /** Owned items referenced by the check, for thumbnails; missing ones fall back to the saved name. */
  items: ItemWithImages[];
  onOpenItem?: (id: number) => void;
}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const verdict = VERDICTS[check.verdict];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className={cn("self-start rounded-full px-2.5 py-1 text-xs font-semibold", verdict.className)}>{verdict.label}</span>
        <p className="text-base font-semibold leading-snug">{check.headline}</p>
        <p className="text-sm leading-relaxed text-muted">{check.reasoning}</p>
      </div>

      {check.similarItems.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">You already own</h3>
          <ul className="flex flex-col gap-1.5">
            {check.similarItems.map((s) => (
              <li key={s.id}>
                <ItemRow item={byId.get(s.id)} name={s.name} tag={RELATIONS[s.relation]} detail={s.reason} onOpen={onOpenItem && (() => onOpenItem(s.id))} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {check.letGo.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Consider letting go, with thanks</h3>
          <ul className="flex flex-col gap-1.5">
            {check.letGo.map((l) => (
              <li key={l.id}>
                <ItemRow item={byId.get(l.id)} name={l.name} detail={l.reason} onOpen={onOpenItem && (() => onOpenItem(l.id))} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {check.questions.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl bg-surface-2/60 p-3.5">
          <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <Sparkles size={14} /> Ask yourself
          </h3>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
            {check.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ItemRow({
  item,
  name,
  tag,
  detail,
  onOpen,
}: {
  item: ItemWithImages | undefined;
  name: string;
  tag?: string;
  detail: string;
  onOpen?: () => void;
}) {
  const cover = item && (item.images.find((i) => i.isPrimary) ?? item.images[0]);
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen || !item}
      className="flex w-full items-center gap-3 rounded-xl border border-border p-2 text-left enabled:hover:bg-surface-2"
    >
      <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-surface-2">
        {cover ? (
          <img src={`/api/images/${cover.path}`} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <Package size={20} strokeWidth={1.5} className="absolute inset-0 m-auto text-muted/60" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{item?.name ?? name}</span>
          {item?.joy === "sparks" && <span title="Sparks joy">✨</span>}
        </span>
        <span className="line-clamp-2 text-xs text-muted">
          {tag && <span className="font-medium text-foreground/80">{tag} · </span>}
          {detail}
        </span>
      </span>
    </button>
  );
}
