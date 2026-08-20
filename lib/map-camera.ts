export type MapBounds = { left: number; right: number; top: number; bottom: number };
export type MapSize = { width: number; height: number };
export type MapCamera = { zoom: number; centerX: number; centerY: number };

export const MAP_IMAGE_ASPECT = 1405 / 1230;
export const MAX_MAP_ZOOM = 2.4;
export const FULL_MAP_BOUNDS: MapBounds = { left: 0, right: 1, top: 0, bottom: 1 };
export const OPERATIONAL_MAP_BOUNDS: MapBounds = { left: 0.03, right: 0.8, top: 0.08, bottom: 0.98 };

const RUBBER_BAND_LIMIT = 0.015;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function minimumMapZoom(bounds: MapBounds, size: MapSize) {
  if (size.width <= 0 || size.height <= 0) return 1;
  const widthZoom = 1 / (bounds.right - bounds.left);
  const heightZoom = size.height / (size.width * MAP_IMAGE_ASPECT * (bounds.bottom - bounds.top));
  return Math.min(MAX_MAP_ZOOM, Math.max(widthZoom, heightZoom));
}

function cameraLimits(zoom: number, size: MapSize, bounds: MapBounds) {
  const halfWidth = 1 / (2 * zoom);
  const halfHeight = size.width > 0
    ? size.height / (2 * size.width * MAP_IMAGE_ASPECT * zoom)
    : 0;

  return {
    minimumX: bounds.left + halfWidth,
    maximumX: bounds.right - halfWidth,
    minimumY: bounds.top + halfHeight,
    maximumY: bounds.bottom - halfHeight,
  };
}

function clampCenter(value: number, minimum: number, maximum: number) {
  return minimum <= maximum ? clamp(value, minimum, maximum) : (minimum + maximum) / 2;
}

export function clampMapCamera(camera: MapCamera, size: MapSize, bounds: MapBounds): MapCamera {
  const zoom = clamp(camera.zoom, minimumMapZoom(bounds, size), MAX_MAP_ZOOM);
  const limits = cameraLimits(zoom, size, bounds);
  return {
    zoom,
    centerX: clampCenter(camera.centerX, limits.minimumX, limits.maximumX),
    centerY: clampCenter(camera.centerY, limits.minimumY, limits.maximumY),
  };
}

export function resetMapCamera(size: MapSize, bounds: MapBounds): MapCamera {
  const zoom = Math.min(MAX_MAP_ZOOM, minimumMapZoom(bounds, size) * 1.025);
  return clampMapCamera({
    zoom,
    centerX: (bounds.left + bounds.right) / 2,
    centerY: (bounds.top + bounds.bottom) / 2,
  }, size, bounds);
}

export function mapCameraOffset(camera: MapCamera, size: MapSize) {
  return {
    x: (0.5 - camera.centerX) * size.width * camera.zoom,
    y: (0.5 - camera.centerY) * size.width * MAP_IMAGE_ASPECT * camera.zoom,
  };
}

function resistedCenter(value: number, minimum: number, maximum: number) {
  if (value < minimum) return minimum - Math.min(RUBBER_BAND_LIMIT, (minimum - value) * 0.18);
  if (value > maximum) return maximum + Math.min(RUBBER_BAND_LIMIT, (value - maximum) * 0.18);
  return value;
}

export function draggedMapCamera(
  startingCamera: MapCamera,
  deltaX: number,
  deltaY: number,
  size: MapSize,
  bounds: MapBounds,
  rubberBand = true,
): MapCamera {
  if (size.width <= 0 || size.height <= 0) return startingCamera;
  const camera = clampMapCamera(startingCamera, size, bounds);
  const limits = cameraLimits(camera.zoom, size, bounds);
  const requestedX = camera.centerX - deltaX / (size.width * camera.zoom);
  const requestedY = camera.centerY - deltaY / (size.width * MAP_IMAGE_ASPECT * camera.zoom);
  const contain = rubberBand ? resistedCenter : clampCenter;

  return {
    zoom: camera.zoom,
    centerX: contain(requestedX, limits.minimumX, limits.maximumX),
    centerY: contain(requestedY, limits.minimumY, limits.maximumY),
  };
}

export function cameraForRoute(points: Array<[number, number]>, size: MapSize, bounds: MapBounds): MapCamera {
  if (!points.length) return resetMapCamera(size, bounds);
  const xs = points.map(([x]) => x / 100);
  const ys = points.map(([, y]) => y / 100);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const paddedWidth = Math.max(0.16, right - left + 0.12);
  const paddedHeight = Math.max(0.18, bottom - top + 0.14);
  const widthZoom = 1 / paddedWidth;
  const heightZoom = size.width > 0
    ? size.height / (size.width * MAP_IMAGE_ASPECT * paddedHeight)
    : MAX_MAP_ZOOM;

  return clampMapCamera({
    zoom: Math.min(2.2, widthZoom, heightZoom),
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }, size, bounds);
}
