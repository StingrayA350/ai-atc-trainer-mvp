export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

const AVIATION_TRANSCRIPTION_PROMPT =
  "A Seletar Airport ATC training transmission using ICAO aviation phraseology. Expect call sign Niner Victor Bravo Charlie Alpha, taxiway Whiskey Papa, holding point Whiskey One, runway Two One, and frequency One One Eight Decimal Four Five.";

export function createTranscriptionForm(audio: File, model = DEFAULT_TRANSCRIPTION_MODEL) {
  const form = new FormData();
  form.append("file", audio, audio.name || "transmission.webm");
  form.append("model", model);
  form.append("language", "en");
  form.append("prompt", AVIATION_TRANSCRIPTION_PROMPT);
  return form;
}
