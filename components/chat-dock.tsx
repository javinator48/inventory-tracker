"use client";

import { Bot, ChevronDown, SendHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { api } from "@/lib/client";
import type { ChatEvent } from "@/lib/types";
import { cn, Spinner } from "./ui";

type Message = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What's my most valuable item?",
  "What should I consider selling?",
  "How much is my electronics worth?",
  "What have I made from selling so far?",
];

/** Inventory assistant: a bar docked at the bottom that expands into a chat panel. */
export function ChatDock() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || loaded) return;
    api<Message[]>("/api/chat")
      .then((rows) => setMessages(rows.map(({ role, content }) => ({ role, content }))))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, status, open]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;
    setOpen(true);
    setInput("");
    setStreaming(true);
    setStatus("Thinking…");
    setMessages((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "" }]);

    const appendToReply = (text: string) =>
      setMessages((m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, content: last.content + text };
        return copy;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
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
                  <p className="text-sm text-muted">Ask anything about your stuff. I can look through your inventory and search the web for prices.</p>
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
                  <div key={i} className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-accent-fg">
                    {m.content}
                  </div>
                ) : m.content ? (
                  <div key={i} className="chat-markdown max-w-[95%] text-sm leading-relaxed">
                    <Markdown
                      components={{
                        a: (props) => <a {...props} target="_blank" rel="noreferrer" className="text-accent underline" />,
                      }}
                    >
                      {m.content}
                    </Markdown>
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
        <form
          className={cn("flex items-center gap-2 p-2", open && "border-t border-border")}
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          {!open && <Bot size={20} className="ml-2 shrink-0 text-accent" />}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder="Ask about your inventory…"
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-base outline-none placeholder:text-muted sm:text-sm"
          />
          <button
            type="submit"
            disabled={!input.trim() || streaming}
            className="rounded-full bg-accent p-2.5 text-accent-fg disabled:opacity-40"
            aria-label="Send"
          >
            {streaming ? <Spinner /> : <SendHorizontal size={18} />}
          </button>
        </form>
      </div>
    </div>
  );
}
