import type {
  Clearance,
  ClearanceField,
  ParsedTransmission,
  ScenarioState,
  ValidationResult,
} from "./schemas";

const phonetics: Record<string, string> = {
  alpha: "a", bravo: "b", charlie: "c", delta: "d", echo: "e",
  foxtrot: "f", golf: "g", hotel: "h", india: "i", juliett: "j",
  kilo: "k", lima: "l", mike: "m", november: "n", oscar: "o",
  papa: "p", quebec: "q", romeo: "r", sierra: "s", tango: "t",
  uniform: "u", victor: "v", whiskey: "w", xray: "x", yankee: "y", zulu: "z",
};

const spokenDigits: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", tree: "3",
  four: "4", fower: "4", five: "5", fife: "5", six: "6", seven: "7",
  eight: "8", nine: "9", niner: "9",
};

export function normalizeTransmission(input: string) {
  return input
    .toLowerCase()
    .replace(/([0-9])\.([0-9])/g, "$1 decimal $2")
    .replace(/[–—-]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => phonetics[token] ?? spokenDigits[token] ?? (token === "point" ? "decimal" : token))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCallsign(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (compact.includes("9vbca") || /\b9\s*v\s*b\s*c\s*a\b/.test(text)) return "9V-BCA";
  const match = text.match(/\b[0-9]\s*[a-z](?:\s*[a-z]){2,4}\b/);
  return match?.[0].replace(/\s+/g, "").toUpperCase();
}

function extractRunway(text: string) {
  const runway = text.match(/runway\s+([0-9]{1,2})(?:\s+([0-9]))?/);
  if (!runway) return undefined;
  if (runway[1].length === 2) return runway[1];
  const combined = runway[2] ? `${runway[1]}${runway[2]}` : runway[1];
  const number = Number(combined);
  return (number >= 1 && number <= 36 ? combined : runway[1]).padStart(2, "0");
}

function extractFrequency(text: string) {
  const explicit = text.match(/\b(1\s*1\s*8|118)\s*(?:decimal|\.)\s*(4\s*5|45)\b/);
  return explicit ? "118.450" : undefined;
}

function extractHoldingPoint(text: string) {
  if (/\b(?:whiskey|w)\s*1\b/.test(text)) return "W1";
  const match = text.match(/\b([a-z])\s*([0-9])\b/);
  return match ? `${match[1].toUpperCase()}${match[2]}` : undefined;
}

function extractTaxiways(text: string) {
  const taxiways: string[] = [];
  if (/\b(?:whiskey\s+papa|w\s*p|wp)\b/.test(text)) taxiways.push("WP");
  return taxiways.length ? taxiways : undefined;
}

function extractAction(text: string) {
  if (/say\s+again|repeat|come\s+again/.test(text)) return "SAY_AGAIN";
  if (/cleared\s+(?:for\s+)?take\s*off|take\s*off\s+clearance/.test(text)) return "CLEARED_TAKEOFF";
  if (/line\s+up\s+and\s+wait/.test(text)) return "LINE_UP_WAIT";
  if (/ready\s+(?:for\s+)?departure|ready\s+(?:for\s+)?take\s*off/.test(text)) return "READY_DEPARTURE";
  if (/hold\s+(?:position|short)|holding\s+short/.test(text)) return "HOLD_SHORT";
  if (/request(?:ing)?\s+taxi|ready\s+to\s+taxi/.test(text)) return "REQUEST_TAXI";
  if (/contact\s+(?:seletar\s+)?tower|frequency\s+change/.test(text)) return "CONTACT_TOWER";
  return undefined;
}

export function parseTransmission(transcript: string, confidence = 0.99): ParsedTransmission {
  const normalized = normalizeTransmission(transcript);
  const action = extractAction(normalized);

  return {
    intent: action ?? "UNKNOWN",
    callsign: extractCallsign(normalized),
    taxiways: extractTaxiways(normalized),
    runway: extractRunway(normalized),
    holdingPoint: extractHoldingPoint(normalized),
    frequency: extractFrequency(normalized),
    action,
    requestsSayAgain: action === "SAY_AGAIN",
    confidence,
  };
}

function expectedFor(field: ClearanceField, clearance: Clearance): string | string[] {
  switch (field) {
    case "CALLSIGN": return clearance.callsign;
    case "TAXIWAYS": return clearance.taxiways ?? [];
    case "RUNWAY": return clearance.runway ?? "";
    case "HOLDING_POINT": return clearance.holdingPoint ?? "";
    case "FREQUENCY": return clearance.frequency ?? "";
    case "ACTION": return clearance.action ?? "";
  }
}

function receivedFor(field: ClearanceField, parsed: ParsedTransmission): string | string[] | undefined {
  switch (field) {
    case "CALLSIGN": return parsed.callsign;
    case "TAXIWAYS": return parsed.taxiways;
    case "RUNWAY": return parsed.runway;
    case "HOLDING_POINT": return parsed.holdingPoint;
    case "FREQUENCY": return parsed.frequency;
    case "ACTION": return parsed.action;
  }
}

function valuesEqual(expected: string | string[], received?: string | string[]) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(received)) return false;
    return expected.length === received.length && expected.every((value, index) => value === received[index]);
  }
  return typeof received === "string" && expected === received;
}

export function validateTransmission(
  clearance: Clearance,
  parsed: ParsedTransmission,
  nextState: ScenarioState,
): ValidationResult {
  if (parsed.confidence < 0.62) {
    return { status: "CLARIFICATION_REQUIRED", fieldResults: [] };
  }

  const fieldResults = clearance.requiredFields.map((field) => {
    const expected = expectedFor(field, clearance);
    const received = receivedFor(field, parsed);
    return { field, expected, received, correct: valuesEqual(expected, received) };
  });
  const incorrect = fieldResults.filter((result) => !result.correct);

  return incorrect.length
    ? {
        status: "CORRECTION_REQUIRED",
        fieldResults,
        correctionTemplateId: `CORRECT_${incorrect[0].field}`,
      }
    : { status: "ACCEPTED", fieldResults, nextState };
}

const fieldLabels: Record<ClearanceField, string> = {
  CALLSIGN: "callsign",
  TAXIWAYS: "taxi route",
  RUNWAY: "runway",
  HOLDING_POINT: "holding point",
  FREQUENCY: "frequency",
  ACTION: "instruction",
};

function speakValue(value: string | string[]) {
  if (Array.isArray(value)) return value.join(", then ");
  const replacements: Record<string, string> = {
    "9V-BCA": "9 Victor Bravo Charlie Alpha",
    "21": "two one",
    "W1": "Whiskey One",
    "WP": "Whiskey Papa",
    "118.450": "one one eight decimal four five",
    "HOLD_SHORT": "hold short",
    "LINE_UP_WAIT": "line up and wait",
    "CLEARED_TAKEOFF": "cleared for takeoff",
    "READY_DEPARTURE": "ready for departure",
    "REQUEST_TAXI": "request taxi",
    "CONTACT_TOWER": "contact Tower",
  };
  return replacements[value] ?? value;
}

export function correctionFor(result: ValidationResult, callsign = "9 Victor Bravo Charlie Alpha") {
  if (result.status === "CLARIFICATION_REQUIRED") {
    return `${callsign}, transmission unclear. Say again.`;
  }
  const incorrect = result.fieldResults.filter((field) => !field.correct);
  if (!incorrect.length) return `${callsign}, readback correct.`;
  const details = incorrect.map((field) => `${fieldLabels[field.field]} is ${speakValue(field.expected)}`).join("; ");
  return `${callsign}, negative. ${details}. Read back.`;
}
