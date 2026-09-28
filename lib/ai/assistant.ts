import "server-only";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaMessageParam,
  BetaToolResultContentBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { ITEM_STATUSES, JOY_LEVELS } from "@/db/schema";
import type { BuyCheck } from "@/lib/buy-check-schema";
import { findWorkingImages } from "@/lib/images";
import { addImage, createItem, getItem, getStats, itemInputSchema, itemPatchSchema, itemValue, listItems } from "@/lib/items";
import { downloadImage, saveImage } from "@/lib/storage";
import type { ChatEvent, ItemProposal } from "@/lib/types";
import { checkPurchase, purchaseCandidateSchema } from "./buy-check";
import { AiNotConfiguredError, aiConfigured, FALLBACK_PARAMS, getClient, MODEL, WEB_SEARCH_TOOL } from "./client";
import { KONMARI_GUIDANCE } from "./konmari";

const searchItems = betaZodTool({
  name: "search_items",
  description:
    "Search the inventory. All filters are optional; with none, returns every item. Returns id, name, brand, category, status, condition, quantity, location, prices and estimated value.",
  inputSchema: z.object({
    query: z.string().optional().describe("Text matched against name, brand, model, category, description, notes, location"),
    status: z.enum(ITEM_STATUSES).optional(),
    category: z.string().optional().describe("Exact category name, case-insensitive"),
  }),
  run: async (input) => {
    const rows = await listItems(input);
    return JSON.stringify(
      rows.map((i) => ({
        id: i.id,
        name: i.name,
        brand: i.brand,
        category: i.category,
        status: i.status,
        condition: i.condition,
        quantity: i.quantity,
        location: i.location,
        purchasePrice: i.purchasePrice,
        msrp: i.msrp,
        estimatedValue: i.estimatedValue,
        countedValue: itemValue(i),
        askingPrice: i.askingPrice,
        soldPrice: i.soldPrice,
        joy: i.joy,
        considerUntil: i.considerUntil,
      })),
    );
  },
});

const getItemDetails = betaZodTool({
  name: "get_item",
  description: "Get every recorded field for one item by id, including description, notes, dates and sale details.",
  inputSchema: z.object({ id: z.number().int() }),
  run: async ({ id }) => {
    const item = await getItem(id);
    if (!item) return `No item with id ${id}`;
    const { images, ...fields } = item;
    return JSON.stringify({ ...fields, photoCount: images.length });
  },
});

const getInventoryStats = betaZodTool({
  name: "get_stats",
  description:
    "Get inventory totals: total estimated value, for-sale value, cost basis, unrealized gain, sold revenue, realized profit, value by category, and the top 10 items by value.",
  inputSchema: z.object({}),
  run: async () => JSON.stringify(await getStats()),
});

/**
 * Item fields as tool inputs. With `clearable`, optional fields also accept null so an
 * edit can blank them; name, quantity and status can't be cleared.
 */
function itemFields(clearable: boolean) {
  const opt = <T extends z.ZodType>(t: T) => (clearable ? t.nullable().optional() : t.optional());
  const money = () => opt(z.number().min(0));
  return {
    brand: opt(z.string()),
    model: opt(z.string()),
    category: opt(z.string()).describe("Reuse an existing category name when one fits"),
    description: opt(z.string()),
    upc: opt(z.string()),
    condition: opt(z.string()).describe("e.g. New, Like new, Good, Fair, Poor"),
    quantity: z.number().int().min(1).optional(),
    location: opt(z.string()).describe("Where it is kept"),
    notes: opt(z.string()),
    status: z.enum(ITEM_STATUSES).optional().describe("\"considering\" = wishlist"),
    joy: opt(z.enum(JOY_LEVELS)).describe("Does it spark joy: sparks, neutral or no"),
    considerUntil: opt(z.string()).describe("Wishlist only: end of the cooling-off period, YYYY-MM-DD. Defaults to 7 days"),
    purchasePrice: money(),
    purchaseDate: opt(z.string()).describe("YYYY-MM-DD"),
    msrp: money(),
    estimatedValue: money().describe("Current resale value per unit, USD"),
    askingPrice: money(),
    soldPrice: money(),
    soldDate: opt(z.string()).describe("YYYY-MM-DD"),
    soldPlatform: opt(z.string()),
  };
}

const validationMessage = (error: z.ZodError) => error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

/** Per-reply state shared between tools. */
type TurnContext = { lastCheck: BuyCheck | null };

/** Creates an item and tells the client so the list updates without a reload. */
function addItemTool(emit: (event: ChatEvent) => void, ctx: TurnContext) {
  return betaZodTool({
    name: "add_item",
    description:
      "Add a new item to the inventory. Only name is required. Fill in only fields the user gave you or that you verified (e.g. via web search); leave the rest out. Status defaults to owned. Returns the created item with its id. Call once per distinct item; use quantity for multiples of the same thing. For a wishlist item (status \"considering\"), put the price they'd pay in estimatedValue.",
    inputSchema: z.object({
      name: z.string().min(1).describe("Short product name, e.g. \"Citizen Navihawk A-T JY8030\""),
      ...itemFields(false),
    }),
    run: async (input) => {
      // A wishlist item keeps its purchase check: the one just run, or a fresh one (e.g. when
      // the check happened in an earlier message).
      let buyCheck: BuyCheck | null = null;
      if (input.status === "considering") {
        buyCheck =
          ctx.lastCheck ??
          (await checkPurchase(purchaseCandidateSchema.parse({ ...input, price: input.estimatedValue ?? null }))
            .then((r) => r.check)
            .catch(() => null));
      }
      const parsed = itemInputSchema.safeParse({ ...input, buyCheck });
      if (!parsed.success) return `Invalid item: ${validationMessage(parsed.error)}`;
      const row = await createItem(parsed.data);
      const item = await getItem(row.id);
      if (item) emit({ type: "item_saved", item });
      return JSON.stringify(row);
    },
  });
}

/**
 * Edits aren't applied by the model: the change is shown to the user as a card with
 * Apply / Dismiss, and the client saves it through the normal PATCH route.
 */
function proposeUpdateTool(emit: (event: ChatEvent) => void) {
  return betaZodTool({
    name: "propose_update",
    description:
      "Propose changes to an existing item. Nothing is saved: the user sees the changes as a confirmation card and taps Apply to save them. Include only the fields that should change; use null to clear a field. To mark something sold, set status \"sold\" plus soldPrice/soldDate/soldPlatform if known; to list it, status \"for_sale\" plus askingPrice.",
    inputSchema: z.object({
      itemId: z.number().int(),
      changes: z.object({ name: z.string().min(1).optional(), ...itemFields(true) }),
    }),
    run: async ({ itemId, changes }) => {
      const item = await getItem(itemId);
      if (!item) return `No item with id ${itemId}`;
      const parsed = itemPatchSchema.safeParse(changes);
      if (!parsed.success) return `Invalid changes: ${validationMessage(parsed.error)}`;

      const patch: Record<string, string | number | null> = {};
      const diff: ItemProposal["changes"] = [];
      for (const [key, value] of Object.entries(parsed.data)) {
        const field = key as keyof typeof parsed.data;
        if (value === undefined || field === "buyCheck") continue;
        const to = value as string | number | null;
        const from = (item[field] ?? null) as string | number | null;
        if (from === to) continue;
        patch[field] = to;
        diff.push({ field, from, to });
      }
      if (diff.length === 0) return "Those values are already saved; nothing to change.";

      emit({
        type: "proposal",
        proposal: { id: crypto.randomUUID(), itemId, itemName: item.name, changes: diff, patch },
      });
      return "Shown to the user as a confirmation card. Not saved yet: it saves when they tap Apply. Don't propose the same change again unless they ask.";
    },
  });
}

function checkPurchaseTool(ctx: TurnContext) {
  return betaZodTool({
    name: "check_purchase",
    description:
      "Before the user buys something: compare it with everything they own and get a KonMari-style verdict (go / wait / skip), the owned items it overlaps with, owned items that don't spark joy it could replace, and reflection questions. Pass as much as you know about the product.",
    inputSchema: z.object({
      name: z.string().min(1),
      brand: z.string().optional(),
      model: z.string().optional(),
      category: z.string().optional(),
      description: z.string().optional().describe("What it is and what it's for"),
      price: z.number().min(0).optional().describe("What they'd pay, USD"),
    }),
    run: async (input) => {
      const { check } = await checkPurchase(purchaseCandidateSchema.parse(input));
      ctx.lastCheck = check;
      return JSON.stringify(check);
    },
  });
}

/** Image types the Claude API accepts, and its per-image size limit (base64 adds a third). */
const VIEWABLE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_VIEWABLE_BYTES = 3_700_000;

const findImages = betaZodTool({
  name: "find_images",
  description:
    "Find product photos to attach to an item. First use web_search to find pages about the exact product (retailer or manufacturer product pages work best), then pass those page URLs here, plus any direct image URLs you saw in results. Returns the images that actually load, numbered with their URLs, and shows them to you so you can pick the one that matches the item.",
  inputSchema: z.object({
    pageUrls: z.array(z.string()).max(5).describe("Product page URLs from web search results"),
    imageUrls: z.array(z.string()).max(8).optional().describe("Direct image-file URLs seen in results; never guess"),
  }),
  run: async ({ pageUrls, imageUrls }) => {
    const urls = await findWorkingImages(imageUrls ?? [], pageUrls, 4);
    const found = await Promise.all(
      urls.map(async (url) => {
        try {
          return { url, ...(await downloadImage(url)) };
        } catch {
          return null;
        }
      }),
    );
    const images = found.filter((f) => f != null);
    if (images.length === 0) return "No loadable images found on those pages. Try other product pages.";

    const content: BetaToolResultContentBlockParam[] = [];
    images.forEach((img, i) => {
      content.push({ type: "text", text: `Image ${i + 1}: ${img.url}` });
      if (VIEWABLE_TYPES.has(img.contentType) && img.data.length <= MAX_VIEWABLE_BYTES) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: img.data.toString("base64"),
          },
        });
      } else {
        content.push({ type: "text", text: "(too large or unsupported format to preview)" });
      }
    });
    return content;
  },
});

function addItemImageTool(emit: (event: ChatEvent) => void) {
  return betaZodTool({
    name: "add_item_image",
    description:
      "Download an image URL returned by find_images and attach it to an item. The first photo an item gets becomes its cover photo.",
    inputSchema: z.object({
      itemId: z.number().int(),
      url: z.string().describe("An image URL from find_images"),
    }),
    run: async ({ itemId, url }) => {
      if (!(await getItem(itemId))) return `No item with id ${itemId}`;
      try {
        const { data, contentType } = await downloadImage(url);
        await addImage(itemId, await saveImage(data, contentType), "web");
      } catch (err) {
        return `Couldn't add that image: ${err instanceof Error ? err.message : "download failed"}`;
      }
      const item = await getItem(itemId);
      if (item) emit({ type: "item_saved", item });
      return `Added. The item now has ${item?.images.length ?? 1} photo(s).`;
    },
  });
}

async function systemPrompt() {
  const stats = await getStats();
  const today = new Date().toISOString().slice(0, 10);
  return `You are the inventory assistant inside the user's personal inventory tracker app. Today is ${today}.
The user catalogues items they own (status "owned"), items they are trying to sell ("for_sale"), items they have sold ("sold"), and a wishlist of things they're considering buying ("considering"). Wishlist items aren't owned and don't count in any totals. Owned items can have a joy rating: "sparks", "neutral" or "no".

How values work in the app: all prices (purchasePrice, msrp, estimatedValue, askingPrice, soldPrice) are per unit, and totals multiply by quantity. An item is counted at its estimatedValue, falling back to msrp, then purchasePrice. Money is USD. Selling only some units of an item is done from the item's "Mark sold" screen, which splits off a sold copy; you can't do that split yourself.

Use the inventory tools to look things up; don't guess about what the user owns. Use web search for current market prices, selling advice, or product facts. When you mention an item, use its name. Be concise; this is a chat panel on a phone. Use short markdown lists where they help.

You can add new items with add_item when the user asks you to (e.g. "add my Navihawk, paid $300, it's in the storage box"). Use what they tell you; don't invent prices or details. If they ask for a value estimate, look it up with web search first. Before adding, check search_items for an obvious duplicate and ask if you find one. After adding, confirm briefly what you saved.

Photos: when you add an item, also try to give it a photo unless the user says not to. Also do this when they ask for a photo on an existing item. Use web_search to find product pages for the exact model, call find_images with them, look at the results and attach the best clean product shot that matches (same model and colourway) with add_item_image. If none match, say so rather than attaching a wrong one. One good photo is enough unless they ask for more.

To change an existing item (fix a field, update an estimate, mark it for sale or sold), look it up and call propose_update. The user confirms it with an Apply button, so say "tap Apply to save" rather than claiming it's saved. Photos added with add_item_image don't need confirmation. You can't delete items; tell the user to do that from the item's page.

Mindful buying: the user wants everything they buy to be meaningful and to avoid buying things that duplicate what they already own. Whenever they mention wanting, eyeing or being about to buy something, call check_purchase first (identify the product with web search if needed), then answer from its result: the verdict, the items they already own that overlap (by name), and one or two of the reflection questions. Offer to add it to their wishlist with a cooling-off period (add_item with status "considering"; considerUntil defaults to a week, and the check is saved with it). If they bought it, add it as owned instead. You can also help them rate existing items' joy with propose_update, and suggest letting go of items that don't spark joy.

${KONMARI_GUIDANCE}

Current snapshot: ${stats.counts.owned} owned, ${stats.counts.forSale} for sale, ${stats.counts.sold} sold, ${stats.counts.considering} on the wishlist. Total estimated value of owned and for-sale items: $${stats.totalValue}.`;
}

const TOOL_STATUS: Record<string, string> = {
  add_item: "Adding to your inventory…",
  find_images: "Looking for photos…",
  add_item_image: "Adding the photo…",
  propose_update: "Preparing the change…",
  check_purchase: "Comparing with what you own…",
};

/** Streams an assistant reply as ChatEvents. Returns the full reply text. */
export async function runAssistant(history: BetaMessageParam[], emit: (event: ChatEvent) => void): Promise<string> {
  if (!aiConfigured()) throw new AiNotConfiguredError();

  const ctx: TurnContext = { lastCheck: null };
  const runner = getClient().beta.messages.toolRunner({
    ...FALLBACK_PARAMS,
    betas: [...FALLBACK_PARAMS.betas],
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: await systemPrompt(),
    tools: [
      searchItems,
      getItemDetails,
      getInventoryStats,
      checkPurchaseTool(ctx),
      addItemTool(emit, ctx),
      proposeUpdateTool(emit),
      findImages,
      addItemImageTool(emit),
      WEB_SEARCH_TOOL,
    ],
    messages: history,
    max_iterations: 12,
    stream: true,
  });

  let reply = "";
  let previousBlock: string | undefined;
  for await (const stream of runner) {
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        const afterNonText = previousBlock !== undefined && previousBlock !== "text";
        previousBlock = block.type;
        if (block.type === "server_tool_use") emit({ type: "status", status: "Searching the web…" });
        else if (block.type === "tool_use")
          emit({ type: "status", status: TOOL_STATUS[block.name] ?? "Checking your inventory…" });
        else if (block.type === "thinking") emit({ type: "status", status: "Thinking…" });
        else if (block.type === "text" && afterNonText && reply && !reply.endsWith("\n")) {
          // Break the paragraph after a tool call; consecutive text blocks (split by
          // citations) continue the same sentence.
          reply += "\n\n";
          emit({ type: "text", text: "\n\n" });
        }
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        reply += event.delta.text;
        emit({ type: "text", text: event.delta.text });
      }
    }
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      const note = "\n\n_Claude declined to answer this._";
      reply += note;
      emit({ type: "text", text: note });
      break;
    }
    // The runner doesn't resume paused server-tool turns on its own.
    if (message.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: message.content });
    }
  }
  return reply;
}
