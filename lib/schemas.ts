import { z } from "zod";

export const scenarioStateSchema = z.enum([
  "PARKED",
  "READY_FOR_GROUND",
  "GROUND_INSTRUCTION",
  "TAXI_READBACK_PENDING",
  "TAXIING",
  "HOLDING_POINT",
  "TOWER_TRANSITION",
  "TOWER_CONTACT",
  "RUNWAY_HOLD_OR_LINE_UP",
  "TAKEOFF_READBACK_PENDING",
  "TAKEOFF_ROLL",
  "AIRBORNE",
  "COMPLETE",
]);

export const clearanceFieldSchema = z.enum([
  "CALLSIGN",
  "TAXIWAYS",
  "RUNWAY",
  "HOLDING_POINT",
  "FREQUENCY",
  "ACTION",
]);

export const clearanceSchema = z.object({
  instructionType: z.enum([
    "GROUND_CONTACT",
    "TAXI",
    "HOLD",
    "FREQUENCY_CHANGE",
    "TOWER_CONTACT",
    "LINE_UP",
    "TAKEOFF",
  ]),
  callsign: z.string(),
  taxiways: z.array(z.string()).optional(),
  runway: z.string().optional(),
  holdingPoint: z.string().optional(),
  frequency: z.string().optional(),
  action: z.string().optional(),
  requiredFields: z.array(clearanceFieldSchema),
  approvedSpokenText: z.string(),
});

export const parsedTransmissionSchema = z.object({
  intent: z.string(),
  callsign: z.string().optional(),
  taxiways: z.array(z.string()).optional(),
  runway: z.string().optional(),
  holdingPoint: z.string().optional(),
  frequency: z.string().optional(),
  action: z.string().optional(),
  requestsSayAgain: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export const routeSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["TAXI", "LINE_UP", "TAKEOFF"]),
  movementState: scenarioStateSchema,
  completionState: scenarioStateSchema,
  completionControllerText: z.string(),
  points: z.array(z.tuple([z.number(), z.number()])).min(2),
  durationMs: z.number().positive(),
});

export const scenarioStepSchema = z.object({
  id: z.string(),
  state: scenarioStateSchema,
  initiator: z.enum(["STUDENT", "ATC", "SYSTEM"]),
  controller: z.enum(["GROUND", "TOWER"]).optional(),
  instruction: clearanceSchema,
  successTransition: scenarioStateSchema,
  routeToReveal: z.string().optional(),
  successControllerText: z.string(),
  successController: z.enum(["GROUND", "TOWER"]).optional(),
  successFrequency: z.string().optional(),
  hint: z.string(),
});

export const scenarioDefinitionSchema = z.object({
  id: z.string(),
  version: z.string(),
  airportDataVersion: z.string(),
  aircraft: z.object({ type: z.literal("C172"), callsign: z.literal("9V-BCA") }),
  startPositionId: z.string(),
  routeIds: z.array(z.string()),
  initialState: scenarioStateSchema,
  airport: z.object({
    icao: z.literal("WSSL"),
    name: z.string(),
    groundFrequency: z.string(),
    towerFrequency: z.string(),
    runway: z.string(),
  }),
  metadata: z.object({
    source: z.string(),
    publicationVersion: z.string(),
    effectiveDate: z.string(),
    importedAt: z.string(),
    licenseReference: z.string(),
    validatedBy: z.string(),
    validationStatus: z.string(),
  }),
  routes: z.record(z.string(), routeSchema),
  steps: z.array(scenarioStepSchema).min(1),
});

export const validationResultSchema = z.object({
  status: z.enum(["ACCEPTED", "CORRECTION_REQUIRED", "CLARIFICATION_REQUIRED"]),
  fieldResults: z.array(z.object({
    field: clearanceFieldSchema,
    expected: z.union([z.string(), z.array(z.string())]),
    received: z.union([z.string(), z.array(z.string())]).optional(),
    correct: z.boolean(),
  })),
  correctionTemplateId: z.string().optional(),
  nextState: scenarioStateSchema.optional(),
});

export const transmissionRequestSchema = z.object({
  requestId: z.string().min(8),
  stateVersion: z.number().int().nonnegative(),
  transcript: z.string().min(1).max(800).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const stateRequestSchema = z.object({
  requestId: z.string().min(8),
  stateVersion: z.number().int().nonnegative(),
});

export type ScenarioState = z.infer<typeof scenarioStateSchema>;
export type ClearanceField = z.infer<typeof clearanceFieldSchema>;
export type Clearance = z.infer<typeof clearanceSchema>;
export type ParsedTransmission = z.infer<typeof parsedTransmissionSchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;
export type ScenarioDefinition = z.infer<typeof scenarioDefinitionSchema>;
export type ScenarioStep = z.infer<typeof scenarioStepSchema>;
export type RouteDefinition = z.infer<typeof routeSchema>;
