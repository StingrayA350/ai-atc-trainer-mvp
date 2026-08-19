import rawScenario from "@/data/wssl-departure.v1.json";
import { scenarioDefinitionSchema, type ScenarioDefinition, type ScenarioState } from "./schemas";

export const scenario: ScenarioDefinition = scenarioDefinitionSchema.parse(rawScenario);

export function getStepForState(state: ScenarioState) {
  return scenario.steps.find((step) => step.state === state);
}

export function nextStepIndex(state: ScenarioState) {
  const index = scenario.steps.findIndex((step) => step.state === state);
  return index < 0 ? scenario.steps.length : index;
}

export function publicScenarioData(visibleRouteIds: string[]) {
  const routes = Object.fromEntries(
    visibleRouteIds
      .filter((id) => id in scenario.routes)
      .map((id) => {
        const { id: routeId, label, kind, points, durationMs } = scenario.routes[id];
        return [id, { id: routeId, label, kind, points, durationMs }];
      }),
  );

  const taxiInstruction = scenario.steps.find((step) => step.instruction.instructionType === "TAXI")?.instruction;
  const firstRoute = scenario.routes[scenario.routeIds[0]];

  return {
    id: scenario.id,
    version: scenario.version,
    airportDataVersion: scenario.airportDataVersion,
    aircraft: scenario.aircraft,
    airport: scenario.airport,
    startPositionId: scenario.startPositionId,
    startPosition: firstRoute.points[0],
    holdingPoint: taxiInstruction?.holdingPoint ?? "",
    taxiways: taxiInstruction?.taxiways ?? [],
    validationStatus: scenario.metadata.validationStatus,
    routes,
  };
}
