import { apiError, json } from "@/lib/api";
import { revealTranscript } from "@/lib/session-service";
import { stateRequestSchema } from "@/lib/schemas";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = stateRequestSchema.parse(await request.json());
    return json(await revealTranscript({ sessionId: id, ...body }));
  } catch (error) {
    return apiError(error);
  }
}
