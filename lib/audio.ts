export function isSilentRecording(transcript: string, activeAudioFrames: number) {
  return !transcript.trim() && activeAudioFrames < 3;
}

export function recordingFileName(mimeType: string) {
  const normalizedMimeType = mimeType.toLowerCase().split(";", 1)[0].trim();
  const extension = {
    "audio/flac": "flac",
    "audio/mp4": "mp4",
    "audio/x-m4a": "m4a",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
  }[normalizedMimeType] ?? "webm";

  return `transmission.${extension}`;
}
