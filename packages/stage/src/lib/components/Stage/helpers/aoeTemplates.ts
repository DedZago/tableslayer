import { AoeShape, type AoeTemplate } from '../components/AoeTemplateLayer/types';

export interface TemplatePoint {
  x: number;
  y: number;
}

export interface TemplateBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const TEMPLATE_FEATHER_FT = 2.5;
export const TEMPLATE_SNAP_FT = 5;
export const TEMPLATE_MIN_SIZE_FT = 5;
const ANGLE_SNAP_DEG = 45;
const SQUARE_ANGLE_SNAP_DEG = 90;
const OUTLINE_SEGMENTS = 48;

const SHAPE_NOUNS: Record<AoeShape, string> = {
  [AoeShape.Circle]: 'radius',
  [AoeShape.Square]: 'cube',
  [AoeShape.Cone]: 'cone',
  [AoeShape.Line]: 'line'
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const normalizeAngle = (degrees: number) => ((degrees % 360) + 360) % 360;

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

const sdBox = (p: TemplatePoint, half: TemplatePoint) => {
  const dx = Math.abs(p.x) - half.x;
  const dy = Math.abs(p.y) - half.y;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
};

// Port of the isosceles triangle SDF in AoeTemplate.frag: apex at the origin, base at y = q.y
const sdTriIso = (point: TemplatePoint, q: TemplatePoint) => {
  const px = Math.abs(point.x);
  const py = point.y;
  const tEdge = clamp01((px * q.x + py * q.y) / (q.x * q.x + q.y * q.y));
  const ax = px - q.x * tEdge;
  const ay = py - q.y * tEdge;
  const tBase = clamp01(px / q.x);
  const bx = px - q.x * tBase;
  const by = py - q.y;
  const s = -Math.sign(q.y);
  const distanceSq = Math.min(ax * ax + ay * ay, bx * bx + by * by);
  const side = Math.min(s * (px * q.y - py * q.x), s * (py - q.y));
  return -Math.sqrt(distanceSq) * Math.sign(side);
};

const projectOnDirection = (dx: number, dy: number, angleDeg: number) => {
  const rad = toRadians(angleDeg);
  return dx * Math.cos(rad) + dy * Math.sin(rad);
};

export const getTemplateLocalBounds = (template: AoeTemplate, featherFt = TEMPLATE_FEATHER_FT): TemplateBounds => {
  const { size, width } = template;
  switch (template.shape) {
    case AoeShape.Circle:
      return { minX: -size - featherFt, maxX: size + featherFt, minY: -size - featherFt, maxY: size + featherFt };
    case AoeShape.Square:
    case AoeShape.Cone:
      return {
        minX: -featherFt,
        maxX: size + featherFt,
        minY: -size / 2 - featherFt,
        maxY: size / 2 + featherFt
      };
    case AoeShape.Line:
      return { minX: -featherFt, maxX: size + featherFt, minY: -width / 2 - featherFt, maxY: width / 2 + featherFt };
  }
};

/** Signed distance (feet, negative inside) from a template-local point to the template's shape */
export const templateSdf = (template: AoeTemplate, localFt: TemplatePoint): number => {
  const { size, width } = template;
  switch (template.shape) {
    case AoeShape.Circle:
      return Math.hypot(localFt.x, localFt.y) - size;
    case AoeShape.Square:
      return sdBox({ x: localFt.x - size / 2, y: localFt.y }, { x: size / 2, y: size / 2 });
    case AoeShape.Line:
      return sdBox({ x: localFt.x - size / 2, y: localFt.y }, { x: size / 2, y: width / 2 });
    case AoeShape.Cone:
      return sdTriIso({ x: localFt.y, y: localFt.x }, { x: size / 2, y: size });
  }
};

/** Converts a layer-local point (px) into the template's local frame (feet, +x along the angle) */
export const worldToTemplateLocal = (template: AoeTemplate, point: TemplatePoint, ftPerPx: number): TemplatePoint => {
  const dx = (point.x - template.position.x) * ftPerPx;
  const dy = (point.y - template.position.y) * ftPerPx;
  const rad = toRadians(template.angle);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
};

/** Converts a template-local point (feet) back into layer-local px */
export const templateLocalToLayer = (template: AoeTemplate, localFt: TemplatePoint, ftPerPx: number): TemplatePoint => {
  const px = localFt.x / ftPerPx;
  const py = localFt.y / ftPerPx;
  const rad = toRadians(template.angle);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: template.position.x + px * cos - py * sin,
    y: template.position.y + px * sin + py * cos
  };
};

/** Whether a layer-local point (px) falls inside the template's shape */
export const templateContainsPoint = (template: AoeTemplate, point: TemplatePoint, ftPerPx: number): boolean =>
  templateSdf(template, worldToTemplateLocal(template, point, ftPerPx)) <= 0;

/** Next template to select among overlapping ones (topmost first), wrapping past the current one */
export const nextTemplateInStack = (stackTopFirst: string[], currentId: string | null): string | null => {
  if (stackTopFirst.length === 0) return null;
  const index = currentId ? stackTopFirst.indexOf(currentId) : -1;
  return stackTopFirst[(index + 1) % stackTopFirst.length];
};

/** Whether a layer-local rectangle touches the template: shared points either way, or the origin inside it */
export const templateIntersectsRect = (
  template: AoeTemplate,
  start: TemplatePoint,
  end: TemplatePoint,
  ftPerPx: number
): boolean => {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const inRect = (point: TemplatePoint) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  const rectPoints = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
    { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  ];
  return (
    inRect(template.position) ||
    getTemplateOutline(template).some((point) => inRect(templateLocalToLayer(template, point, ftPerPx))) ||
    rectPoints.some((point) => templateContainsPoint(template, point, ftPerPx))
  );
};

/** Origin and far-edge handle positions in layer-local px; the end handle sits at (size, 0) for every shape */
export const getTemplateHandlePoints = (
  template: AoeTemplate,
  ftPerPx: number
): { origin: TemplatePoint; end: TemplatePoint } => ({
  origin: { x: template.position.x, y: template.position.y },
  end: templateLocalToLayer(template, { x: template.size, y: 0 }, ftPerPx)
});

/** Template outline as a closed polygon in template-local feet (no repeated last point) */
export const getTemplateOutline = (template: AoeTemplate): TemplatePoint[] => {
  const { size, width } = template;
  switch (template.shape) {
    case AoeShape.Circle:
      return Array.from({ length: OUTLINE_SEGMENTS }, (_, i) => {
        const rad = (i / OUTLINE_SEGMENTS) * Math.PI * 2;
        return { x: size * Math.cos(rad), y: size * Math.sin(rad) };
      });
    case AoeShape.Square:
      return [
        { x: 0, y: -size / 2 },
        { x: size, y: -size / 2 },
        { x: size, y: size / 2 },
        { x: 0, y: size / 2 }
      ];
    case AoeShape.Line:
      return [
        { x: 0, y: -width / 2 },
        { x: size, y: -width / 2 },
        { x: size, y: width / 2 },
        { x: 0, y: width / 2 }
      ];
    case AoeShape.Cone:
      return [
        { x: 0, y: 0 },
        { x: size, y: -size / 2 },
        { x: size, y: size / 2 }
      ];
  }
};

/**
 * Size in feet for a template whose origin is `origin` and whose far edge follows `cursor`.
 * Circles use the euclidean distance; cone, line and square project onto the angle.
 */
export const sizeFromCursor = (
  shape: AoeShape,
  origin: TemplatePoint,
  cursor: TemplatePoint,
  ftPerPx: number,
  angleDeg: number,
  snap: boolean
): number => {
  const dx = (cursor.x - origin.x) * ftPerPx;
  const dy = (cursor.y - origin.y) * ftPerPx;
  const distance = shape === AoeShape.Circle ? Math.hypot(dx, dy) : projectOnDirection(dx, dy, angleDeg);
  const clamped = Math.max(distance, 0);
  const sized = snap ? Math.round(clamped / TEMPLATE_SNAP_FT) * TEMPLATE_SNAP_FT : clamped;
  return Math.max(TEMPLATE_MIN_SIZE_FT, sized);
};

/** Direction in degrees (CCW from +x), smooth unless snapping: squares snap to 90 degrees; cones and lines to 45. */
export const angleFromCursor = (
  origin: TemplatePoint,
  cursor: TemplatePoint,
  shape: AoeShape,
  snapAngle: boolean
): number => {
  if (shape === AoeShape.Circle) return 0;
  const raw = (Math.atan2(cursor.y - origin.y, cursor.x - origin.x) * 180) / Math.PI;
  if (!snapAngle) return normalizeAngle(raw);
  const step = shape === AoeShape.Square ? SQUARE_ANGLE_SNAP_DEG : ANGLE_SNAP_DEG;
  return normalizeAngle(Math.round(raw / step) * step);
};

/** Normalizes an angle to [0, 360); squares keep a face on the grid, so they snap to 90 degrees */
export const normalizeTemplateAngle = (shape: AoeShape, angleDeg: number): number =>
  normalizeAngle(
    shape === AoeShape.Square ? Math.round(angleDeg / SQUARE_ANGLE_SNAP_DEG) * SQUARE_ANGLE_SNAP_DEG : angleDeg
  );

/** Rotates by `deltaDeg`; squares turn a quarter in the delta's direction whatever its size */
export const rotateTemplateAngle = (shape: AoeShape, angleDeg: number, deltaDeg: number): number =>
  shape === AoeShape.Square
    ? normalizeTemplateAngle(
        shape,
        normalizeTemplateAngle(shape, angleDeg) + Math.sign(deltaDeg) * SQUARE_ANGLE_SNAP_DEG
      )
    : normalizeAngle(angleDeg + deltaDeg);

export const formatTemplateLabel = (template: AoeTemplate, includeDimensions = true): string => {
  const label = template.label?.trim();
  if (!includeDimensions) return label ?? '';
  const dimensions =
    template.shape === AoeShape.Line
      ? `${template.size} × ${template.width} ft line`
      : `${template.size} ft ${SHAPE_NOUNS[template.shape]}`;
  return label ? `${label} · ${dimensions}` : dimensions;
};

/** Stable pseudo-random value in [0, 1) derived from a template id (FNV-1a) */
export const templateSeed = (id: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
};
