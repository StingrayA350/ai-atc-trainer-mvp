import { apiError, json } from "@/lib/api";
import { getDebrief } from "@/lib/session-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return json(await getDebrief(id));
  } catch (error) {
    return apiError(error);
  }
}
