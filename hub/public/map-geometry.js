const finite = value => typeof value === 'number' && Number.isFinite(value);
export function worldBounds(data) {
  const box = data?.viewBox;
  if (Array.isArray(box) && box.length === 4 && box.every(finite) && box[2] > 0 && box[3] > 0) return { x: box[0], y: box[1], width: box[2], height: box[3] };
  throw new Error('Campus map has no valid coordinate bounds.');
}
export function fitCamera(bounds) { return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, zoom: 1 }; }
export function campusContextCamera(data, viewport) {
  const bounds = worldBounds(data); const camera = fitCamera(bounds);
  const core = new Set(['ecsw', 'ecss', 'ecsn', 'hh', 'mc', 'fo', 'su', 'ps4']);
  const anchors = (data.features || []).filter(f => core.has(f.id) && Array.isArray(f.anchor) && f.anchor.length === 2 && f.anchor.every(finite)).map(f => f.anchor);
  let extent = data.initialViewBox;
  if (anchors.length >= 3) {
    const xs = anchors.map(p => p[0]), ys = anchors.map(p => p[1]);
    extent = [Math.min(...xs) - 24, Math.min(...ys) - 24, Math.max(...xs) - Math.min(...xs) + 48, Math.max(...ys) - Math.min(...ys) + 48];
  }
  if (!Array.isArray(extent) || extent.length !== 4 || !extent.every(finite) || extent[2] <= 0 || extent[3] <= 0) return camera;
  camera.x = extent[0] + extent[2] / 2; camera.y = extent[1] + extent[3] / 2;
  camera.zoom = Math.max(1, Math.min(8, Math.min(Math.max(1, viewport.width - 76) / extent[2], Math.max(1, viewport.height - 76) / extent[3]) / scaleFor(bounds, viewport, camera)));
  return camera;
}
export function scaleFor(bounds, viewport, camera, padding = 38) {
  return Math.max(.00001, Math.min(Math.max(1, viewport.width - padding * 2) / bounds.width, Math.max(1, viewport.height - padding * 2) / bounds.height)) * camera.zoom;
}
export function project(point, bounds, viewport, camera) {
  const scale = scaleFor(bounds, viewport, camera);
  return { x: viewport.width / 2 + (point.x - camera.x) * scale, y: viewport.height / 2 + (point.y - camera.y) * scale };
}
export function unproject(point, bounds, viewport, camera) {
  const scale = scaleFor(bounds, viewport, camera);
  return { x: camera.x + (point.x - viewport.width / 2) / scale, y: camera.y + (point.y - viewport.height / 2) / scale };
}
export function constrainCamera(camera, bounds) {
  return { zoom: Math.max(1, Math.min(8, camera.zoom)), x: Math.max(bounds.x - bounds.width * .15, Math.min(bounds.x + bounds.width * 1.15, camera.x)), y: Math.max(bounds.y - bounds.height * .15, Math.min(bounds.y + bounds.height * 1.15, camera.y)) };
}
export function panCamera(camera, dx, dy, bounds, viewport) {
  const scale = scaleFor(bounds, viewport, camera);
  return constrainCamera({ ...camera, x: camera.x - dx / scale, y: camera.y - dy / scale }, bounds);
}
export function zoomCamera(camera, factor, anchor, bounds, viewport) {
  const world = unproject(anchor, bounds, viewport, camera);
  const zoom = Math.max(1, Math.min(8, camera.zoom * factor));
  const next = { ...camera, zoom }; const scale = scaleFor(bounds, viewport, next);
  return constrainCamera({ zoom, x: world.x - (anchor.x - viewport.width / 2) / scale, y: world.y - (anchor.y - viewport.height / 2) / scale }, bounds);
}
export function overlaps(a, b, gap = 5) { return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y; }
/** Greedy placement preserves selected/hub labels before optional context labels. */
export function placeLabels(points, viewport, reserved = []) {
  const occupied = [...reserved]; const placed = [];
  const ordered = [...points].sort((a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)) || (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id));
  for (const point of ordered) {
    if (point.x < 10 || point.y < 10 || point.x > viewport.width - 10 || point.y > viewport.height - 10) continue;
    const width = Math.min(200, Math.max(36, point.label.length * 7.3 + 18)); const height = 25;
    const offsets = [[13, -height / 2], [-width - 13, -height / 2], [-width / 2, 16], [-width / 2, -height - 16], [13, 15], [-width - 13, -height - 15]];
    let chosen = null;
    const fits = box => box.x >= 8 && box.y >= 8 && box.x + width <= viewport.width - 8 && box.y + height <= viewport.height - 8 && !occupied.some(other => overlaps(box, other));
    for (const [dx, dy] of offsets) {
      const box = { x: point.x + dx, y: point.y + dy, width, height };
      if (fits(box)) { chosen = box; break; }
    }
    // A selected label is essential information. Search beyond the six nearby
    // positions before allowing optional context labels to use the remaining space.
    if (!chosen && point.required) {
      let nearest = Infinity;
      for (let y = 8; y + height <= viewport.height - 8; y += 8) for (let x = 8; x + width <= viewport.width - 8; x += 8) {
        const distance = Math.hypot(x + width / 2 - point.x, y + height / 2 - point.y);
        if (distance >= nearest) continue;
        const box = { x, y, width, height }; if (fits(box)) { chosen = box; nearest = distance; }
      }
    }
    if (chosen) {
      const end = { x: Math.max(chosen.x, Math.min(chosen.x + width, point.x)), y: Math.max(chosen.y, Math.min(chosen.y + height, point.y)) };
      const leader = Math.hypot(end.x - point.x, end.y - point.y) > 15 ? { x1: point.x, y1: point.y, x2: end.x, y2: end.y } : null;
      placed.push({ ...point, box: chosen, leader }); occupied.push(chosen);
    }
  }
  return placed;
}
/** Only an explicit surveyed transform may place GPS on document coordinates. */
export function projectGps(request, data) {
  const geo = data?.georeference;
  if (!(request?.flags & 1) || !finite(request.latitude) || !finite(request.longitude) || Math.abs(request.latitude) > 90 || Math.abs(request.longitude) > 180 || geo?.type !== 'affine-wgs84' || geo.verified !== true || !Array.isArray(geo.matrix) || geo.matrix.length !== 6 || !geo.matrix.every(finite)) return null;
  const [a, b, c, d, e, f] = geo.matrix; const longitude = request.longitude, latitude = request.latitude;
  const point = { x: a * longitude + c * latitude + e, y: b * longitude + d * latitude + f };
  const bounds = worldBounds(data);
  if (point.x < bounds.x || point.x > bounds.x + bounds.width || point.y < bounds.y || point.y > bounds.y + bounds.height) return null;
  return point;
}
