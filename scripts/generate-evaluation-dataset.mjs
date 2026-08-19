import { mkdir, writeFile } from "node:fs/promises";

const steps = [
  ["contact-ground", "Seletar Ground, 9V-BCA, Cessna 172 at stand Charlie Six, request taxi runway two one."],
  ["taxi-readback", "Taxi via Whiskey Papa to holding point Whiskey One, hold short of runway two one, 9V-BCA."],
  ["frequency-readback", "One one eight decimal four five, 9V-BCA."],
  ["contact-tower", "Seletar Tower, 9V-BCA, holding short at Whiskey One, runway two one, ready for departure."],
  ["line-up-readback", "Line up and wait runway two one, 9V-BCA."],
  ["takeoff-readback", "Cleared for takeoff runway two one, 9V-BCA."],
];

const cases = [];
for (const [stepId, phrase] of steps) {
  const correctVariants = [
    phrase,
    phrase.toUpperCase(),
    phrase.replace("9V-BCA", "nine victor bravo charlie alpha"),
    phrase.replace("9V-BCA", "niner victor bravo charlie alpha"),
    phrase.replaceAll(",", "").replaceAll(".", ""),
    `Roger, ${phrase}`,
    `${phrase} Wilco.`,
    phrase.replace("two one", "21"),
    phrase.replace("Whiskey One", "W1"),
    phrase.replace("Whiskey Papa", "WP"),
  ];
  correctVariants.forEach((transcript, index) => cases.push({
    id: `${stepId}-correct-${index + 1}`,
    stepId,
    transcript,
    confidence: 0.96,
    expectedStatus: "ACCEPTED",
    labelSource: "ENGINEERING_DRAFT_NEEDS_SME_REVIEW",
    audioProfile: ["clean-headset", "laptop-mic", "light-noise", "accent-variant", "hesitation"][index % 5],
  }));

  const wrongCallsign = phrase.replace("9V-BCA", "9V-BCD");
  const noCallsign = phrase.replace(/,?\s*9V-BCA\.?/, ".");
  const wrongOperationalValue = stepId === "frequency-readback"
    ? "One two one decimal six, 9V-BCA."
    : phrase.includes("two one")
      ? phrase.replace("two one", "zero three")
      : phrase.replace("request taxi", "request parking");
  const wrongVariants = [
    [wrongCallsign, 0.96, "CORRECTION_REQUIRED"],
    [noCallsign, 0.96, "CORRECTION_REQUIRED"],
    ["9V-BCD, standby.", 0.96, "CORRECTION_REQUIRED"],
    ["Say again.", 0.96, "CORRECTION_REQUIRED"],
    [wrongOperationalValue, 0.96, "CORRECTION_REQUIRED"],
    [phrase.split(",").slice(0, 1).join(","), 0.96, "CORRECTION_REQUIRED"],
    [phrase, 0.41, "CLARIFICATION_REQUIRED"],
    ["nine victor bravo charlie, roger", 0.96, "CORRECTION_REQUIRED"],
    ["Unable, 9V-BCA.", 0.96, "CORRECTION_REQUIRED"],
    ["Standby, 9V-BCA.", 0.96, "CORRECTION_REQUIRED"],
  ];
  wrongVariants.forEach(([transcript, confidence, expectedStatus], index) => cases.push({
    id: `${stepId}-safety-${index + 1}`,
    stepId,
    transcript,
    confidence,
    expectedStatus,
    labelSource: "ENGINEERING_DRAFT_NEEDS_SME_REVIEW",
    audioProfile: ["wrong-callsign", "omission", "unrelated", "assistance", "wrong-value", "truncated", "low-confidence", "incomplete"][index],
  }));
}

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../data/evaluation-cases.v1.json", import.meta.url),
  `${JSON.stringify({ version: "1.0.0-draft", reviewStatus: "AWAITING_SME_LABEL_REVIEW", cases }, null, 2)}\n`,
);
console.log(`Generated ${cases.length} evaluation cases.`);
