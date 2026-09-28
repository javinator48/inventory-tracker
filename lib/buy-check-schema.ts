import { z } from "zod";

// The saved result of a "before you buy" check. Shared by the check itself, the items
// schema (wishlist items keep their last check) and the UI.

export const BUY_VERDICTS = ["go", "wait", "skip"] as const;

export const buyCheckSchema = z.object({
  verdict: z.enum(BUY_VERDICTS),
  headline: z.string(),
  reasoning: z.string(),
  questions: z.array(z.string()),
  similarItems: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      relation: z.enum(["duplicate", "similar", "complements"]),
      reason: z.string(),
    }),
  ),
  letGo: z.array(z.object({ id: z.number().int(), name: z.string(), reason: z.string() })),
  checkedAt: z.string(),
});

export type BuyCheck = z.infer<typeof buyCheckSchema>;
