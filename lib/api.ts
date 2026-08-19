import { ServiceError } from "./session-service";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiError(error: unknown) {
  if (error instanceof ServiceError) {
    return json({ error: error.message, details: error.details }, error.status);
  }
  console.error("API_ERROR", error);
  return json({ error: "INTERNAL_ERROR" }, 500);
}
