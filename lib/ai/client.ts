import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5";

/** Retry declined requests server-side on Anthropic's recommended fallback model. */
export const FALLBACK_PARAMS = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
} as const;

export const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 5,
} as const;

let client: Anthropic | undefined;

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function getClient() {
  client ??= new Anthropic();
  return client;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI features need ANTHROPIC_API_KEY in .env.local");
  }
}

/** Turns SDK errors into a message that is safe and useful to show in the UI. */
export function describeAiError(err: unknown): { message: string; status: number } {
  if (err instanceof AiNotConfiguredError) return { message: err.message, status: 503 };
  if (err instanceof Anthropic.AuthenticationError) return { message: "The Anthropic API key was rejected", status: 502 };
  if (err instanceof Anthropic.RateLimitError) return { message: "Claude is rate limited, try again in a minute", status: 429 };
  if (err instanceof Anthropic.APIError) return { message: `Claude API error (${err.status ?? "network"})`, status: 502 };
  return { message: err instanceof Error ? err.message : "Unexpected error", status: 500 };
}
