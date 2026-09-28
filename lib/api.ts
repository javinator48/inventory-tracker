import "server-only";
import { z } from "zod";

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function parseId(raw: string) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function validationError(error: z.ZodError) {
  return jsonError(error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
}
