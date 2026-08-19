const phoneticAlphabet: Record<string, string> = {
  A: "Alpha",
  B: "Bravo",
  C: "Charlie",
  D: "Delta",
  E: "Echo",
  F: "Foxtrot",
  G: "Golf",
  H: "Hotel",
  I: "India",
  J: "Juliett",
  K: "Kilo",
  L: "Lima",
  M: "Mike",
  N: "November",
  O: "Oscar",
  P: "Papa",
  Q: "Quebec",
  R: "Romeo",
  S: "Sierra",
  T: "Tango",
  U: "Uniform",
  V: "Victor",
  W: "Whiskey",
  X: "X-ray",
  Y: "Yankee",
  Z: "Zulu",
};

const spokenDigits: Record<string, string> = {
  "0": "Zero",
  "1": "One",
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
};

export function speakIdentifier(identifier: string) {
  return [...identifier.toUpperCase()]
    .map((character) => phoneticAlphabet[character] ?? spokenDigits[character])
    .filter(Boolean)
    .join(" ");
}

export function speakFrequency(frequency: string) {
  const [whole, rawFraction = ""] = frequency.split(".");
  const fraction = rawFraction.replace(/0+$/, "");
  const spokenWhole = speakIdentifier(whole);
  return fraction ? `${spokenWhole} Decimal ${speakIdentifier(fraction)}` : spokenWhole;
}

export function speakPosition(positionId: string) {
  const [kind, identifier] = positionId.split("_");
  if (!identifier) return positionId.replaceAll("_", " ");
  const label = kind.toLowerCase().replace(/^./, (character) => character.toUpperCase());
  return `${label} ${speakIdentifier(identifier)}`;
}

export function prepareSpeechText(text: string) {
  return text
    .replace(/\b9V[- ]?BCA\b/gi, "9 Victor Bravo Charlie Alpha")
    .replace(/\bWP\b/gi, "Whiskey Papa")
    .replace(/\bW1\b/gi, "Whiskey One")
    .replace(/\bC6\b/gi, "Charlie Six")
    .replace(/\b118\.450\b/g, "one one eight decimal four five")
    .replace(/\b121\.600\b/g, "one two one decimal six");
}
