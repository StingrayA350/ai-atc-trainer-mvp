export function isSilentRecording(transcript: string, activeAudioFrames: number) {
  return !transcript.trim() && activeAudioFrames < 3;
}
