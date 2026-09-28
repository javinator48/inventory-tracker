import type { NextRequest } from "next/server";
import { asc, desc } from "drizzle-orm";
import type { BetaImageBlockParam, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { chatMessages } from "@/db/schema";
import { jsonError } from "@/lib/api";
import { describeAiError } from "@/lib/ai/client";
import { runAssistant } from "@/lib/ai/assistant";
import { getDb } from "@/lib/db";
import { imageExists } from "@/lib/settings";
import { readImage } from "@/lib/storage";
import type { ChatEvent, ItemProposal } from "@/lib/types";

export const maxDuration = 300;

/** How many earlier messages are sent back to Claude as context. */
const HISTORY_LIMIT = 30;
const MAX_ATTACHMENTS = 4;
const VIEWABLE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

async function imageBlock(key: string): Promise<BetaImageBlockParam | null> {
  const { data, contentType } = await readImage(key);
  if (!VIEWABLE.has(contentType) || data.length > 3_700_000) return null;
  return { type: "image", source: { type: "base64", media_type: contentType as "image/jpeg", data: data.toString("base64") } };
}

export async function GET() {
  const db = await getDb();
  const rows = await db.select().from(chatMessages).orderBy(asc(chatMessages.id));
  return Response.json(rows);
}

export async function DELETE() {
  const db = await getDb();
  await db.delete(chatMessages);
  return new Response(null, { status: 204 });
}

/** How a stored message is replayed to Claude: its text plus a note of any images. */
function historyText(m: { role: "user" | "assistant"; content: string; images: string[] | null; proposals: ItemProposal[] | null }) {
  const notes = [];
  if (m.images?.length) {
    notes.push(m.role === "user" ? `(Photos attached: ${m.images.join(", ")})` : `(Showed try-on images: ${m.images.join(", ")})`);
  }
  if (m.proposals?.length) notes.push(`(Showed ${m.proposals.length} edit card(s))`);
  return [m.content, ...notes].filter(Boolean).join("\n\n") || "(no text)";
}

/** Sends `{ message, images? }` and streams the reply back as newline-delimited ChatEvents. `images` are keys from /api/uploads. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { message?: string; images?: unknown } | null;
  const images = Array.isArray(body?.images) ? body.images.filter((k): k is string => typeof k === "string").slice(0, MAX_ATTACHMENTS) : [];
  const message = body?.message?.trim() || (images.length ? "(photo)" : "");
  if (!message) return jsonError("Empty message");
  for (const key of images) if (!(await imageExists(key))) return jsonError("Attached photo not found", 404);

  const db = await getDb();
  const previous = (
    await db.select().from(chatMessages).orderBy(desc(chatMessages.id)).limit(HISTORY_LIMIT)
  ).reverse();
  // The API expects the conversation to start with a user turn.
  while (previous[0]?.role === "assistant") previous.shift();
  await db.insert(chatMessages).values({ role: "user", content: message, images: images.length ? images : null });

  // Only the new message carries the photos themselves; earlier ones are referenced by key.
  const photoBlocks = (await Promise.all(images.map(imageBlock))).filter((b) => b != null);
  const history: BetaMessageParam[] = [
    ...previous.map((m) => ({ role: m.role, content: historyText(m) })),
    {
      role: "user",
      content: [...photoBlocks, { type: "text", text: historyText({ role: "user", content: message, images, proposals: null }) }],
    },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const proposals: ItemProposal[] = [];
      const generated: string[] = [];
      const emit = (event: ChatEvent) => {
        if (event.type === "proposal") proposals.push(event.proposal);
        if (event.type === "image") generated.push(event.key);
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        const reply = await runAssistant(history, emit);
        if (reply.trim() || proposals.length || generated.length) {
          await db.insert(chatMessages).values({
            role: "assistant",
            content: reply,
            proposals: proposals.length ? proposals : null,
            images: generated.length ? generated : null,
          });
        }
        emit({ type: "done" });
      } catch (err) {
        console.error("chat failed", err);
        emit({ type: "error", error: describeAiError(err).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
