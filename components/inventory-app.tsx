"use client";

import { Package, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ItemStatus, ItemWithImages } from "@/db/schema";
import { api, money } from "@/lib/client";
import type { InventoryStats } from "@/lib/items";
import { AddItemSheet } from "./add-item-sheet";
import { ChatDock } from "./chat-dock";
import { ItemDetailSheet } from "./item-detail-sheet";
import { StatsView } from "./stats-view";
import { cn, StatusBadge } from "./ui";

type Tab = ItemStatus | "stats";

const TABS: { id: Tab; label: string }[] = [
  { id: "owned", label: "Owned" },
  { id: "for_sale", label: "For sale" },
  { id: "sold", label: "Sold" },
  { id: "stats", label: "Stats" },
];

export function InventoryApp() {
  const [tab, setTab] = useState<Tab>("owned");
  const [items, setItems] = useState<ItemWithImages[] | null>(null);
  const [stats, setStats] = useState<InventoryStats | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<ItemWithImages[]>("/api/items"), api<InventoryStats>("/api/stats")])
      .then(([all, s]) => {
        setItems(all);
        setStats(s);
      })
      .catch((err: Error) => setLoadError(err.message || "Couldn't load your inventory"));
  }, []);

  const categories = useMemo(
    () => [...new Set((items ?? []).map((i) => i.category?.trim()).filter((c): c is string => Boolean(c)))].sort(),
    [items],
  );

  const visible = useMemo(() => {
    if (!items || tab === "stats") return [];
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        i.status === tab &&
        (!category || i.category === category) &&
        (!q || [i.name, i.brand, i.model, i.category, i.location, i.notes, i.upc].some((f) => f?.toLowerCase().includes(q))),
    );
  }, [items, tab, query, category]);

  const counts = useMemo(() => {
    const c = { owned: 0, for_sale: 0, sold: 0 };
    for (const i of items ?? []) c[i.status]++;
    return c;
  }, [items]);

  const selected = items?.find((i) => i.id === selectedId) ?? null;

  const upsert = (item: ItemWithImages) => {
    setItems((list) => {
      const rest = (list ?? []).filter((i) => i.id !== item.id);
      return [item, ...rest];
    });
    void api<InventoryStats>("/api/stats").then(setStats);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 pb-32 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-end justify-between gap-4 pb-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Estimated value</p>
          <p className="tabular text-3xl font-semibold">{stats ? money(stats.totalValue, { whole: true }) : "—"}</p>
          {stats && (
            <p className="text-xs text-muted">
              {stats.counts.owned + stats.counts.forSale} items
              {stats.counts.forSale > 0 && ` · ${money(stats.forSaleValue, { whole: true })} listed`}
            </p>
          )}
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg shadow-sm hover:brightness-110"
        >
          <Plus size={18} /> Add item
        </button>
      </header>

      <nav className="sticky top-0 z-30 -mx-4 bg-background/90 px-4 py-2 backdrop-blur" aria-label="Inventory sections">
        <div className="flex rounded-2xl bg-surface-2 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-colors",
                tab === t.id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              {t.label}
              {t.id !== "stats" && items && <span className="tabular text-xs text-muted">{counts[t.id]}</span>}
            </button>
          ))}
        </div>
      </nav>

      {loadError && <p className="mt-3 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{loadError}</p>}

      {tab === "stats" ? (
        <div className="pt-3">
          <StatsView stats={stats} onOpenItem={setSelectedId} />
        </div>
      ) : (
        <>
          <div className="flex gap-2 pt-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
              <Search size={16} className="text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none sm:text-sm"
              />
            </label>
            {categories.length > 0 && (
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-32 shrink-0 rounded-xl border border-border bg-surface px-2 text-sm sm:w-44"
                aria-label="Filter by category"
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            )}
          </div>

          {items === null && !loadError ? (
            <p className="py-16 text-center text-sm text-muted">Loading…</p>
          ) : visible.length === 0 ? (
            <EmptyState tab={tab} filtered={Boolean(query || category)} onAdd={() => setAdding(true)} />
          ) : (
            <ul className="grid grid-cols-2 gap-3 pt-3 sm:grid-cols-3 lg:grid-cols-4">
              {visible.map((item) => (
                <li key={item.id} className="min-w-0">
                  <ItemCard item={item} onClick={() => setSelectedId(item.id)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {adding && (
      <AddItemSheet
        onClose={() => setAdding(false)}
        defaultStatus={tab === "stats" ? "owned" : tab}
        categories={categories}
        onSaved={(item) => {
          upsert(item);
          setAdding(false);
          if (tab !== item.status && tab !== "stats") setTab(item.status);
        }}
      />
      )}
      <ItemDetailSheet
        key={selectedId ?? "none"}
        item={selected}
        categories={categories}
        onClose={() => setSelectedId(null)}
        onChanged={upsert}
        onDeleted={(id) => {
          setSelectedId(null);
          setItems((list) => (list ?? []).filter((i) => i.id !== id));
          void api<InventoryStats>("/api/stats").then(setStats);
        }}
      />
      <ChatDock />
    </div>
  );
}

function ItemCard({ item, onClick }: { item: ItemWithImages; onClick: () => void }) {
  const cover = item.images.find((i) => i.isPrimary) ?? item.images[0];
  const price =
    item.status === "sold"
      ? item.soldPrice
      : item.status === "for_sale"
        ? (item.askingPrice ?? item.estimatedValue ?? item.msrp)
        : (item.estimatedValue ?? item.msrp ?? item.purchasePrice);
  return (
    <button onClick={onClick} className="group flex h-full w-full flex-col overflow-hidden rounded-2xl bg-surface text-left shadow-sm transition-shadow hover:shadow-md">
      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-surface-2">
        {cover ? (
          <img src={`/api/images/${cover.path}`} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted/60">
            <Package size={36} strokeWidth={1.5} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{item.name}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="tabular text-sm font-semibold">
            {money(price == null ? null : price * (item.status === "sold" ? 1 : item.quantity), { whole: true })}
            {item.quantity > 1 && item.status !== "sold" && <span className="font-normal text-muted"> · ×{item.quantity}</span>}
          </span>
          {item.status !== "owned" && <StatusBadge status={item.status} />}
        </div>
        {item.category && <p className="truncate text-xs text-muted">{item.category}</p>}
      </div>
    </button>
  );
}

function EmptyState({ tab, filtered, onAdd }: { tab: ItemStatus; filtered: boolean; onAdd: () => void }) {
  const text = filtered
    ? "Nothing matches your search."
    : {
        owned: "Nothing here yet. Add your first item by scanning its barcode, snapping a photo, or typing it in.",
        for_sale: "Nothing listed. Open an item and tap “Sell this” to move it here.",
        sold: "Items you mark as sold show up here with what you made.",
      }[tab];
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <Package size={40} strokeWidth={1.5} className="text-muted/60" />
      <p className="max-w-xs text-sm text-muted">{text}</p>
      {!filtered && tab === "owned" && (
        <button onClick={onAdd} className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg">
          Add an item
        </button>
      )}
    </div>
  );
}
