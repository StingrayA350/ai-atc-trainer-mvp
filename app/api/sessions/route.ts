import { apiError, json } from "@/lib/api";
import { createSession } from "@/lib/session-service";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return json({ session: await createSession() }, 201);
  } catch (error) {
    return apiError(error);
  }
}
