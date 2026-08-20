import { describe, expect, it } from "vitest";
import {
  FULL_MAP_BOUNDS,
  OPERATIONAL_MAP_BOUNDS,
  cameraForRoute,
  clampMapCamera,
  draggedMapCamera,
  mapCameraOffset,
  minimumMapZoom,
  resetMapCamera,
} from "@/lib/map-camera";

const stage = { width: 700, height: 480 };

describe("bounded airport chart camera", () => {
  it("keeps the operational crop wide enough to cover the stage", () => {
    expect(minimumMapZoom(OPERATIONAL_MAP_BOUNDS, stage)).toBeCloseTo(1 / 0.77, 4);
    expect(resetMapCamera(stage, OPERATIONAL_MAP_BOUNDS).zoom).toBeGreaterThan(1.29);
  });

  it("clamps extreme pans before empty space can enter the full chart view", () => {
    const camera = clampMapCamera({ zoom: 1.4, centerX: -2, centerY: 3 }, stage, FULL_MAP_BOUNDS);
    const halfWidth = 1 / (2 * camera.zoom);

    expect(camera.centerX).toBeCloseTo(halfWidth);
    expect(camera.centerY).toBeLessThan(1);
    expect(mapCameraOffset(camera, stage).x).toBeGreaterThan(0);
  });

  it("adds only a small resisted overscroll in the operational view", () => {
    const start = resetMapCamera(stage, OPERATIONAL_MAP_BOUNDS);
    const dragged = draggedMapCamera(start, 10_000, 10_000, stage, OPERATIONAL_MAP_BOUNDS, true);
    const settled = clampMapCamera(dragged, stage, OPERATIONAL_MAP_BOUNDS);

    expect(Math.abs(dragged.centerX - settled.centerX)).toBeLessThanOrEqual(0.0151);
    expect(Math.abs(dragged.centerY - settled.centerY)).toBeLessThanOrEqual(0.0151);
  });

  it("focuses an accepted route without leaving the operational chart bounds", () => {
    const camera = cameraForRoute([[37.3, 39.3], [50.4, 31]], stage, OPERATIONAL_MAP_BOUNDS);

    expect(camera.zoom).toBeGreaterThan(minimumMapZoom(OPERATIONAL_MAP_BOUNDS, stage));
    expect(camera.centerX).toBeGreaterThan(0.4);
    expect(camera.centerX).toBeLessThan(0.48);
    expect(camera.centerY).toBeGreaterThan(0.3);
    expect(camera.centerY).toBeLessThan(0.4);
  });
});
