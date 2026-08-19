import { apiError, json } from "@/lib/api";
import { completeMovement, ServiceError } from "@/lib/session-service";
import { stateRequestSchema } from "@/lib/schemas";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const raw = await request.json() as Record<string, unknown>;
    if (raw.action !== "MOVEMENT_COMPLETE") throw new ServiceError(400, "INVALID_ACTION");
    const body = stateRequestSchema.parse(raw);
    return json(await completeMovement({ sessionId: id, ...body }));
  } catch (error) {
    return apiError(error);
  }
}
