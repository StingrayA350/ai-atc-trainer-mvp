import { apiError, json } from "@/lib/api";
import { processTransmission, ServiceError } from "@/lib/session-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const contentType = request.headers.get("content-type") ?? "";
    let requestId: string | undefined;
    let stateVersion: number | undefined;
    let transcript: string | undefined;
    let confidence: number | undefined;
    let audio: File | undefined;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      requestId = String(form.get("requestId") ?? "");
      stateVersion = Number(form.get("stateVersion"));
      transcript = String(form.get("transcript") ?? "").trim() || undefined;
      const confidenceValue = form.get("confidence");
      confidence = confidenceValue == null ? undefined : Number(confidenceValue);
      const audioValue = form.get("audio");
      audio = audioValue instanceof File ? audioValue : undefined;
    } else {
      const body = await request.json() as Record<string, unknown>;
      requestId = typeof body.requestId === "string" ? body.requestId : undefined;
      stateVersion = typeof body.stateVersion === "number" ? body.stateVersion : undefined;
      transcript = typeof body.transcript === "string" ? body.transcript : undefined;
      confidence = typeof body.confidence === "number" ? body.confidence : undefined;
    }

    if (!requestId || requestId.length < 8 || !Number.isInteger(stateVersion) || (stateVersion ?? -1) < 0) {
      throw new ServiceError(400, "INVALID_TRANSMISSION_REQUEST");
    }
    return json(await processTransmission({
      sessionId: id,
      requestId,
      stateVersion: stateVersion as number,
      transcript,
      confidence,
      audio,
    }));
  } catch (error) {
    return apiError(error);
  }
}
