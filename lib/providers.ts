import { env } from "cloudflare:workers";
import { parseTransmission } from "./transmission";
import { parsedTransmissionSchema, type ParsedTransmission, type ScenarioStep } from "./schemas";

type RuntimeEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_STT_MODEL?: string;
  OPENAI_INTERPRETER_MODEL?: string;
  OPENAI_TTS_MODEL?: string;
};

function config() {
  return env as unknown as RuntimeEnv;
}

function apiKey() {
  return config().OPENAI_API_KEY;
}

export function providerStatus() {
  return apiKey() ? "OPENAI" : "LOCAL_DEMO";
}

export async function transcribeAudio(audio: File) {
  const key = apiKey();
  if (!key) throw new Error("VOICE_PROVIDER_NOT_CONFIGURED");
  const form = new FormData();
  form.append("file", audio, audio.name || "transmission.webm");
  form.append("model", config().OPENAI_STT_MODEL || "gpt-transcribe");
  form.append("languages[]", "en");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!response.ok) throw new Error(`TRANSCRIPTION_FAILED_${response.status}`);
  const body = await response.json() as { text?: string };
  if (!body.text) throw new Error("TRANSCRIPTION_EMPTY");
  return body.text;
}

const parsedTransmissionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "callsign", "taxiways", "runway", "holdingPoint", "frequency", "action", "requestsSayAgain", "confidence"],
  properties: {
    intent: { type: "string" },
    callsign: { type: ["string", "null"] },
    taxiways: { type: ["array", "null"], items: { type: "string" } },
    runway: { type: ["string", "null"] },
    holdingPoint: { type: ["string", "null"] },
    frequency: { type: ["string", "null"] },
    action: { type: ["string", "null"] },
    requestsSayAgain: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

export async function interpretTranscript(transcript: string, step: ScenarioStep, confidence = 0.99): Promise<ParsedTransmission> {
  const key = apiKey();
  if (!key) return parseTransmission(transcript, confidence);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config().OPENAI_INTERPRETER_MODEL || "gpt-5.6-luna",
        input: [
          {
            role: "system",
            content: "Extract only the stated aviation readback fields. Never infer a clearance element that was not spoken. Normalize ICAO phonetics, runway digits, taxiway identifiers, holding points, frequencies, and callsigns.",
          },
          {
            role: "user",
            content: JSON.stringify({ transcript, expectedInstructionType: step.instruction.instructionType, confidence }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "parsed_transmission",
            strict: true,
            schema: parsedTransmissionJsonSchema,
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`INTERPRETER_FAILED_${response.status}`);
    const body = await response.json() as { output_text?: string };
    const parsed = JSON.parse(body.output_text ?? "{}");
    const cleaned = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== null));
    return parsedTransmissionSchema.parse(cleaned);
  } catch {
    return parseTransmission(transcript, confidence);
  }
}

export async function synthesizeControllerSpeech(text: string) {
  const key = apiKey();
  if (!key) return null;
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config().OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: "coral",
      input: text,
      response_format: "mp3",
      speed: 1,
    }),
  });
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/mpeg;base64,${btoa(binary)}`;
}
