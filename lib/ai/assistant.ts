import "server-only";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { ITEM_STATUSES } from "@/db/schema";
import { getItem, getStats, itemValue, listItems } from "@/lib/items";
import type { ChatEvent } from "@/lib/types";
import { AiNotConfiguredError, aiConfigured, FALLBACK_PARAMS, getClient, MODEL, WEB_SEARCH_TOOL } from "./client";

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

async function systemPrompt() {
  const stats = await getStats();
  const today = new Date().toISOString().slice(0, 10);
  return `You are the inventory assistant inside the user's personal inventory tracker app. Today is ${today}.
The user catalogues items they own (status "owned"), items they are trying to sell ("for_sale"), and items they have sold ("sold").

How values work in the app: an item is counted at its estimatedValue, falling back to msrp, then purchasePrice, times quantity. Money is USD.

Use the inventory tools to look things up; don't guess about what the user owns. Use web search for current market prices, selling advice, or product facts. When you mention an item, use its name. Be concise; this is a chat panel on a phone. Use short markdown lists where they help.

You can read the inventory but not change it. If a change would help (a new estimate, marking something sold), tell the user what to update.

Current snapshot: ${stats.counts.owned} owned, ${stats.counts.forSale} for sale, ${stats.counts.sold} sold. Total estimated value of unsold items: $${stats.totalValue}.`;
}

/** Streams an assistant reply as ChatEvents. Returns the full reply text. */
export async function runAssistant(history: BetaMessageParam[], emit: (event: ChatEvent) => void): Promise<string> {
  if (!aiConfigured()) throw new AiNotConfiguredError();

  const runner = getClient().beta.messages.toolRunner({
    ...FALLBACK_PARAMS,
    betas: [...FALLBACK_PARAMS.betas],
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: await systemPrompt(),
    tools: [searchItems, getItemDetails, getInventoryStats, WEB_SEARCH_TOOL],
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
        else if (block.type === "tool_use") emit({ type: "status", status: "Checking your inventory…" });
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
