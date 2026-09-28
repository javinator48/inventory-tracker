import "server-only";
import type { BetaContentBlockParam, BetaMessageParam, BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { findWorkingImages } from "@/lib/images";
import type { ProductInfo, ValueEstimate } from "@/lib/types";
import { AiNotConfiguredError, aiConfigured, FALLBACK_PARAMS, getClient, MODEL, WEB_SEARCH_TOOL } from "./client";

const nullable = (type: string) => ({ type: [type, "null"] });
const sourcesSchema = {
  type: "array",
  items: {
    type: "object",
    properties: { title: { type: "string" }, url: { type: "string" } },
    required: ["title", "url"],
    additionalProperties: false,
  },
};

const RECORD_ITEM_TOOL: BetaTool = {
  name: "record_item",
  description: "Record the identified product's details. Call this exactly once, after researching.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short product name a person would search for, including model" },
      brand: nullable("string"),
      model: { ...nullable("string"), description: "Model name or number" },
      category: { ...nullable("string"), description: "One broad category, e.g. Electronics, Tools, Clothing, Kitchen, Books, Toys, Sports, Furniture, Collectibles" },
      description: { ...nullable("string"), description: "1-3 sentence factual description" },
      upc: nullable("string"),
      msrp: { ...nullable("number"), description: "Original retail price in USD when new" },
      estimatedValue: { ...nullable("number"), description: "Typical current used resale price in USD, based on recent sold listings" },
      imageUrls: { type: "array", items: { type: "string" }, description: "Direct image-file URLs of this exact product that appeared in your search results. Never construct or guess a URL; use an empty array if you saw none" },
      sources: { ...sourcesSchema, description: "Pages you used, product pages first (their preview images are shown to the user)" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["name", "brand", "model", "category", "description", "upc", "msrp", "estimatedValue", "imageUrls", "sources", "confidence"],
    additionalProperties: false,
  },
};

const RECORD_VALUE_TOOL: BetaTool = {
  name: "record_value",
  description: "Record the resale value estimate. Call this exactly once, after researching.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      estimatedValue: { type: "number", description: "Most likely current resale price in USD for this condition" },
      low: nullable("number"),
      high: nullable("number"),
      reasoning: { type: "string", description: "One or two sentences on what the estimate is based on" },
      sources: sourcesSchema,
    },
    required: ["estimatedValue", "low", "high", "reasoning", "sources"],
    additionalProperties: false,
  },
};

const productSchema = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  upc: z.string().nullable(),
  msrp: z.number().nullable(),
  estimatedValue: z.number().nullable(),
  imageUrls: z.array(z.string()),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  confidence: z.enum(["high", "medium", "low"]),
});

const valueSchema = z.object({
  estimatedValue: z.number(),
  low: z.number().nullable(),
  high: z.number().nullable(),
  reasoning: z.string(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});

const SYSTEM = `You help catalogue a personal inventory of physical items.
Use web search to find the exact product and its prices. Prefer manufacturer pages and major retailers for MSRP, and recent sold listings (eBay sold, Mercari, Facebook Marketplace, Swappa, etc.) for used resale value.
Prices are in USD. If you cannot find a price, use null rather than guessing wildly.
When you are done researching, call the recording tool once with your findings.`;

/**
 * Runs Claude with web search plus one strict "record" tool and returns that tool's input.
 * Resumes paused server-tool turns and nudges once if Claude answers without calling the tool.
 */
export async function researchAndRecord(
  content: BetaContentBlockParam[],
  recordTool: BetaTool,
  system: string = SYSTEM,
): Promise<unknown> {
  if (!aiConfigured()) throw new AiNotConfiguredError();
  const client = getClient();
  const messages: BetaMessageParam[] = [{ role: "user", content }];

  for (let turn = 0; turn < 6; turn++) {
    const response = await client.beta.messages.create({
      ...FALLBACK_PARAMS,
      betas: [...FALLBACK_PARAMS.betas],
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system,
      tools: [WEB_SEARCH_TOOL, recordTool],
      messages,
    });

    if (response.stop_reason === "refusal") throw new Error("Claude declined to identify this item");
    const call = response.content.find((b) => b.type === "tool_use" && b.name === recordTool.name);
    if (call && call.type === "tool_use") return call.input;

    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason !== "pause_turn") {
      messages.push({ role: "user", content: `Call ${recordTool.name} now with the best information you have.` });
    }
  }
  throw new Error("Claude did not return a result");
}

async function toProductInfo(raw: unknown): Promise<ProductInfo> {
  const p = productSchema.parse(raw);
  const money = (n: number | null) => (n != null && n > 0 ? Math.round(n * 100) / 100 : null);
  return {
    ...p,
    msrp: money(p.msrp),
    estimatedValue: money(p.estimatedValue),
    imageUrls: await findWorkingImages(p.imageUrls, p.sources.map((s) => s.url)),
    provider: "claude",
  };
}

export type IdentifyInput =
  | { kind: "image"; data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; hint?: string }
  | { kind: "upc"; upc: string }
  | { kind: "text"; query: string };

export async function identifyProduct(input: IdentifyInput): Promise<ProductInfo> {
  const content: BetaContentBlockParam[] = [];
  if (input.kind === "image") {
    content.push({ type: "image", source: { type: "base64", media_type: input.mediaType, data: input.data } });
    content.push({
      type: "text",
      text: `Identify the product in this photo as precisely as you can (brand, model, variant), then research it.${
        input.hint ? `\nThe owner adds: ${input.hint}` : ""
      }`,
    });
  } else if (input.kind === "upc") {
    content.push({ type: "text", text: `Find the product with barcode (UPC/EAN) ${input.upc} and research it.` });
  } else {
    content.push({ type: "text", text: `Find this product and research it: ${input.query}` });
  }
  return toProductInfo(await researchAndRecord(content, RECORD_ITEM_TOOL));
}

export async function estimateValue(item: {
  name: string;
  brand: string | null;
  model: string | null;
  condition: string | null;
  description: string | null;
  msrp: number | null;
}): Promise<ValueEstimate> {
  const details = [
    `Item: ${item.name}`,
    item.brand && `Brand: ${item.brand}`,
    item.model && `Model: ${item.model}`,
    `Condition: ${item.condition ?? "used, good"}`,
    item.msrp != null && `Original MSRP: $${item.msrp}`,
    item.description && `Notes: ${item.description}`,
  ]
    .filter(Boolean)
    .join("\n");
  const raw = await researchAndRecord(
    [{ type: "text", text: `Estimate what this item would sell for today on the used market.\n\n${details}` }],
    RECORD_VALUE_TOOL,
  );
  const v = valueSchema.parse(raw);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    ...v,
    estimatedValue: round(v.estimatedValue),
    low: v.low != null ? round(v.low) : null,
    high: v.high != null ? round(v.high) : null,
  };
}
