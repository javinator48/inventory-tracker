"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { InventoryStats } from "@/lib/items";
import { money, signedMoney } from "@/lib/client";
import { cn } from "./ui";

export function StatsView({ stats, onOpenItem }: { stats: InventoryStats | null; onOpenItem: (id: number) => void }) {
  if (!stats) return <p className="py-10 text-center text-sm text-muted">Loading…</p>;

  const categories = stats.byCategory.slice(0, 10);
  const other = stats.byCategory.slice(10);
  if (other.length) {
    categories.push({
      category: `Other (${other.length})`,
      value: other.reduce((s, c) => s + c.value, 0),
      count: other.reduce((s, c) => s + c.count, 0),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label="Total estimated value" value={money(stats.totalValue, { whole: true })} sub={`${stats.counts.totalUnits} units owned or for sale`} hero />
        <Tile label="Listed for sale" value={money(stats.forSaleValue, { whole: true })} sub={`${stats.units.forSale} unit${stats.units.forSale === 1 ? "" : "s"}`} />
        <Tile label="Paid (cost basis)" value={money(stats.costBasis, { whole: true })} sub="Items with a purchase price" />
        <Tile
          label="Unrealized gain"
          value={signedMoney(stats.unrealizedGain)}
          tone={toneOf(stats.unrealizedGain)}
          sub="Value minus cost"
        />
        <Tile label="Sold revenue" value={money(stats.soldRevenue, { whole: true })} sub={`${stats.units.sold} unit${stats.units.sold === 1 ? "" : "s"} sold`} />
        <Tile
          label="Realized profit"
          value={signedMoney(stats.realizedProfit)}
          tone={toneOf(stats.realizedProfit)}
          sub="Sold minus paid"
        />
      </div>

      {stats.itemsMissingValue > 0 && (
        <p className="rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
          {stats.itemsMissingValue} item{stats.itemsMissingValue > 1 ? "s have" : " has"} no value, MSRP or purchase price, so
          {stats.itemsMissingValue > 1 ? " they count" : " it counts"} as $0. Open {stats.itemsMissingValue > 1 ? "them" : "it"} and tap “Estimate value”.
        </p>
      )}

      <section className="rounded-2xl bg-surface p-4">
        <h3 className="text-sm font-semibold">Value by category</h3>
        <p className="mb-3 text-xs text-muted">Owned and for-sale items</p>
        {categories.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No items yet.</p>
        ) : (
          <div style={{ height: categories.length * 36 + 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categories} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }} barCategoryGap={8}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="category"
                  width={110}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted)", fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)" }}
                  content={({ active, payload }) => {
                    const d = active ? (payload?.[0]?.payload as (typeof categories)[number] | undefined) : undefined;
                    if (!d) return null;
                    return (
                      <div className="rounded-xl border border-border bg-surface px-3 py-2 text-sm shadow-lg">
                        <p className="font-medium">{d.category}</p>
                        <p className="tabular text-muted">
                          {money(d.value)} · {d.count} unit{d.count === 1 ? "" : "s"}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="value" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
                  <LabelList
                    dataKey="value"
                    position="right"
                    formatter={(v) => money(Number(v), { whole: true })}
                    style={{ fill: "var(--foreground)", fontSize: 12 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-surface p-4">
        <h3 className="mb-2 text-sm font-semibold">Most valuable items</h3>
        {stats.topItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No items yet.</p>
        ) : (
          <ol className="flex flex-col">
            {stats.topItems.map((item, i) => (
              <li key={item.id}>
                <button
                  onClick={() => onOpenItem(item.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left text-sm hover:bg-surface-2"
                >
                  <span className="tabular w-5 text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {item.name}
                    {item.quantity > 1 && <span className="text-muted"> ×{item.quantity}</span>}
                  </span>
                  <span className="tabular font-medium">{money(item.value, { whole: true })}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

const toneOf = (n: number) => (n > 0 ? "good" : n < 0 ? "bad" : undefined);

function Tile({ label, value, sub, tone, hero }: { label: string; value: string; sub?: string; tone?: "good" | "bad"; hero?: boolean }) {
  return (
    <div className={cn("rounded-2xl bg-surface p-3.5", hero && "col-span-2 sm:col-span-1")}>
      <p className="text-xs text-muted">{label}</p>
      <p
        className={cn(
          "tabular font-semibold",
          hero ? "text-3xl" : "text-xl",
          tone === "good" && "text-good",
          tone === "bad" && "text-bad",
        )}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}
