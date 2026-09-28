import type { NextRequest } from "next/server";
import { asc, desc } from "drizzle-orm";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { chatMessages } from "@/db/schema";
import { jsonError } from "@/lib/api";
import { describeAiError } from "@/lib/ai/client";
import { runAssistant } from "@/lib/ai/assistant";
import { getDb } from "@/lib/db";
import type { ChatEvent } from "@/lib/types";

export const maxDuration = 300;

/** How many earlier messages are sent back to Claude as context. */
const HISTORY_LIMIT = 30;

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

/** Sends `{ message }` and streams the reply back as newline-delimited ChatEvents. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { message?: string } | null;
  const message = body?.message?.trim();
  if (!message) return jsonError("Empty message");

  const db = await getDb();
  const previous = (
    await db.select().from(chatMessages).orderBy(desc(chatMessages.id)).limit(HISTORY_LIMIT)
  ).reverse();
  // The API expects the conversation to start with a user turn.
  while (previous[0]?.role === "assistant") previous.shift();
  await db.insert(chatMessages).values({ role: "user", content: message });

  const history: BetaMessageParam[] = [
    ...previous.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const reply = await runAssistant(history, emit);
        if (reply.trim()) await db.insert(chatMessages).values({ role: "assistant", content: reply });
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
