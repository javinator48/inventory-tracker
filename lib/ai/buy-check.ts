import "server-only";
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { ItemWithImages } from "@/db/schema";
import { BUY_VERDICTS, type BuyCheck } from "@/lib/buy-check-schema";
import { itemValue, listItems } from "@/lib/items";
import { researchAndRecord } from "./identify";
import { KONMARI_GUIDANCE } from "./konmari";

/** What the user is thinking of buying. Only name is required. */
export const purchaseCandidateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  brand: z.string().nullish(),
  model: z.string().nullish(),
  category: z.string().nullish(),
  description: z.string().max(2000).nullish(),
  /** What they'd pay, per unit. */
  price: z.number().min(0).nullish(),
  msrp: z.number().min(0).nullish(),
});
export type PurchaseCandidate = z.infer<typeof purchaseCandidateSchema>;

/** Above this many items, only send ones plausibly related to the candidate. */
const MAX_ITEMS_IN_PROMPT = 300;

const RECORD_TOOL: BetaTool = {
  name: "record_buy_check",
  description: "Record your assessment of the potential purchase. Call this exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: [...BUY_VERDICTS],
        description:
          "go: fills a real gap or would clearly bring joy. wait: worth a cooling-off period or a closer look at what they own. skip: largely duplicates something they already have and love",
      },
      headline: { type: "string", description: "One short, warm sentence summarising the verdict" },
      reasoning: {
        type: "string",
        description: "2-4 sentences grounded in the KonMari ideas and in the specific items they own. Plain text, no markdown",
      },
      questions: {
        type: "array",
        items: { type: "string" },
        description: "2-4 reflection questions tailored to this item, for the user to ask themselves",
      },
      similarItems: {
        type: "array",
        description: "Owned items that overlap with the candidate, most relevant first. Empty if none",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            relation: {
              type: "string",
              enum: ["duplicate", "similar", "complements"],
              description: "duplicate: same or practically interchangeable. similar: same role or category, clear overlap. complements: related but serves a different purpose",
            },
            reason: { type: "string", description: "Short phrase explaining the overlap" },
          },
          required: ["id", "relation", "reason"],
          additionalProperties: false,
        },
      },
      letGo: {
        type: "array",
        description: "Similar owned items that don't spark joy (joy \"no\", or unrated/neutral duplicates) which the new item would replace. Empty if none",
        items: {
          type: "object",
          properties: { id: { type: "integer" }, reason: { type: "string" } },
          required: ["id", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["verdict", "headline", "reasoning", "questions", "similarItems", "letGo"],
    additionalProperties: false,
  },
};

const recordSchema = z.object({
  verdict: z.enum(BUY_VERDICTS),
  headline: z.string(),
  reasoning: z.string(),
  questions: z.array(z.string()),
  similarItems: z.array(z.object({ id: z.number(), relation: z.enum(["duplicate", "similar", "complements"]), reason: z.string() })),
  letGo: z.array(z.object({ id: z.number(), reason: z.string() })),
});

const SYSTEM = `You help someone decide whether to buy something, so that everything they own is meaningful and they avoid buying things that duplicate or closely resemble what they already have.
You get the item they're considering and their current inventory (things they own or are selling). Compare carefully by purpose, not just by name: two watches with different uses can both be worth having, while two nearly identical ones rarely are. Joy ratings: "sparks" = they love it, "neutral", "no" = it doesn't spark joy, null = not rated yet.
Prices are in US dollars. Only use web search if you don't know what the product is or what it's for. Compare by role and how the user would use each thing; don't state technical specs (sensor, resolution, capacity, etc.) unless you verified them with web search, since a wrong spec undermines the whole verdict.

${KONMARI_GUIDANCE}

When you're done, call record_buy_check once.`;

function words(s: string) {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
}

/** The inventory to compare against, trimmed to related items when it's large. */
async function comparableItems(candidate: PurchaseCandidate) {
  const held = (await listItems()).filter((i) => i.status === "owned" || i.status === "for_sale");
  if (held.length <= MAX_ITEMS_IN_PROMPT) return held;
  const keys = new Set(words([candidate.name, candidate.brand, candidate.model, candidate.category].filter(Boolean).join(" ")));
  const score = (i: ItemWithImages) =>
    (candidate.category && i.category?.toLowerCase() === candidate.category.toLowerCase() ? 5 : 0) +
    words([i.name, i.brand, i.model, i.category].filter(Boolean).join(" ")).filter((w) => keys.has(w)).length;
  return held
    .map((i) => ({ i, s: score(i) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_ITEMS_IN_PROMPT)
    .map(({ i }) => i);
}

/** Compares a potential purchase with what the user owns and returns a KonMari-style verdict. */
export async function checkPurchase(candidate: PurchaseCandidate): Promise<{ check: BuyCheck; items: ItemWithImages[] }> {
  const inventory = await comparableItems(candidate);
  const compact = inventory.map((i) => ({
    id: i.id,
    name: i.name,
    brand: i.brand,
    model: i.model,
    category: i.category,
    description: i.description?.slice(0, 200) ?? null,
    quantity: i.quantity,
    status: i.status,
    joy: i.joy,
    value: itemValue(i) || null,
  }));

  const raw = await researchAndRecord(
    [
      {
        type: "text",
        text: `Today is ${new Date().toISOString().slice(0, 10)}.

Item they're considering:
${JSON.stringify(candidate)}

Their inventory (${compact.length} items):
${JSON.stringify(compact)}`,
      },
    ],
    RECORD_TOOL,
    SYSTEM,
  );
  const r = recordSchema.parse(raw);

  // Drop ids that aren't in the inventory, and never suggest letting go of something loved.
  const byId = new Map(inventory.map((i) => [i.id, i]));
  const similarItems = r.similarItems
    .filter((s) => byId.has(s.id))
    .map((s) => ({ ...s, name: byId.get(s.id)!.name }));
  const letGo = r.letGo
    .filter((l) => byId.has(l.id) && byId.get(l.id)!.joy !== "sparks")
    .map((l) => ({ ...l, name: byId.get(l.id)!.name }));
  const ids = new Set([...similarItems, ...letGo].map((s) => s.id));

  return {
    check: {
      verdict: r.verdict,
      headline: r.headline,
      reasoning: r.reasoning,
      questions: r.questions.slice(0, 4),
      similarItems,
      letGo,
      checkedAt: new Date().toISOString(),
    },
    items: inventory.filter((i) => ids.has(i.id)),
  };
}
