import { apiError, json } from "@/lib/api";
import { restoreSession, ServiceError } from "@/lib/session-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = await restoreSession(id);
    if (!session) throw new ServiceError(404, "SESSION_NOT_FOUND");
    return json({ session });
  } catch (error) {
    return apiError(error);
  }
}
