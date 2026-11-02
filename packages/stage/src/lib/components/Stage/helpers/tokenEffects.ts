import { MarkerVisibility, type Marker } from '../components/MarkerLayer/types';
import { StageMode } from '../components/Stage/types';
import type { TokenEffect } from '../components/TokenEffectLayer/types';
import type { TokenEffectKind } from './spells';

/** Index of each kind: the value of the `TOKEN_FX` shader define (append-only) */
export const TOKEN_FX_INDEX: Record<TokenEffectKind, number> = {
  orbit: 0,
  glow: 1,
  shimmer: 2,
  ghosts: 3,
  ward: 4,
  chains: 5,
  motes: 6,
  haze: 7,
  sigil: 8,
  rift: 9,
  charm: 10,
  concentration: 11,
  clock: 12,
  streaks: 13,
  halo: 14,
  veil: 15,
  wind: 16,
  blind: 17,
  calm: 18,
  heal: 19,
  trance: 20,
  outline: 21,
  dread: 22,
  slumber: 23
};

export const TOKEN_FX_LIST = Object.keys(TOKEN_FX_INDEX) as TokenEffectKind[];

/** Most effects of one kind drawn at once (one instanced draw call per kind) */
export const MAX_TOKEN_EFFECTS_PER_KIND = 48;
/** Effects older than this are fully faded in, so older start times are clamped */
export const TOKEN_EFFECT_MAX_AGE_S = 60;
/** Frame rate the shader clock runs at on the low tier */
export const LOW_TIER_EFFECT_FPS = 15;
/** The pose a reduced-motion screen holds */
export const REDUCED_MOTION_EFFECT_TIME = 2.5;

// Markers are drawn at 90% of their grid footprint
const MARKER_FOOTPRINT = 0.9;
const DEFAULT_ORBIT_RADII = 2.5;

const OVER_MARKERS: ReadonlySet<TokenEffectKind> = new Set([
  'chains',
  'sigil',
  'charm',
  'rift',
  'ward',
  'concentration',
  'clock',
  'veil',
  'blind',
  'outline',
  'dread',
  'slumber'
]);

/** Effects that frame or cloak the token (chains, seals, dials, veils) draw over it; the rest draw under it */
export const isTokenFxOverMarkers = (fx: TokenEffectKind) => OVER_MARKERS.has(fx);

type PlacedMarker = Pick<Marker, 'id' | 'position' | 'size' | 'visibility'>;

const isMarkerShownTo = (visibility: MarkerVisibility, mode: StageMode) => {
  switch (visibility) {
    case MarkerVisibility.Always:
      return true;
    case MarkerVisibility.Player:
      return mode === StageMode.Player;
    default:
      return mode === StageMode.DM;
  }
};

/** Half the quad's side in token radii: enough room for everything the kind draws */
export const tokenFxExtent = (fx: TokenEffectKind, orbitRadii: number): number => {
  switch (fx) {
    case 'orbit':
      return orbitRadii + 0.7;
    case 'glow':
      return orbitRadii * 2 + 0.4;
    case 'shimmer':
      return 2;
    case 'ghosts':
      return 2.2;
    case 'ward':
      return 1.6;
    case 'chains':
      return 2.8;
    case 'motes':
      return 2.1;
    case 'haze':
      return 2.2;
    case 'sigil':
      return 2.1;
    case 'rift':
      return 2;
    case 'charm':
      return 2.4;
    case 'concentration':
      return 1.75;
    case 'clock':
      return 1.7;
    case 'streaks':
      return 2.2;
    case 'halo':
      return 2.3;
    case 'veil':
      return 1.5;
    case 'wind':
      return 2.1;
    case 'blind':
      return 2.2;
    case 'calm':
      return 2.1;
    case 'heal':
      return 2.2;
    case 'trance':
      return 1.9;
    case 'outline':
      return 1.6;
    case 'dread':
      return 2.4;
    case 'slumber':
      return 2.1;
  }
};

export interface PlacedTokenEffect {
  effect: TokenEffect;
  /** Layer px */
  x: number;
  y: number;
  /** The token's radius in layer px */
  tokenPx: number;
  /** Half extent of the quad in token radii */
  extent: number;
  /** Orbit or glow radius in token radii (0 when the kind has none) */
  orbitRadii: number;
}

export interface TokenEffectPlacement {
  cellPx: number;
  /** Layer px per foot */
  ftToPx: number;
  mode: StageMode;
  /** The marker layer is off: no tokens are drawn, so nothing is bound to them */
  tokensVisible: boolean;
}

/**
 * Where each effect is drawn. Effects of tokens that are missing, or hidden from this viewer, are dropped.
 * The marker list carries live positions, so effects follow a token through a drag.
 */
export const placeTokenEffects = (
  effects: readonly TokenEffect[],
  markers: readonly PlacedMarker[],
  { cellPx, ftToPx, mode, tokensVisible }: TokenEffectPlacement
): PlacedTokenEffect[] => {
  if (!tokensVisible || effects.length === 0) return [];
  const byId = new Map(markers.map((marker) => [marker.id, marker]));
  return effects.flatMap((effect) => {
    const marker = byId.get(effect.markerId);
    if (!marker || !isMarkerShownTo(marker.visibility, mode)) return [];
    const tokenPx = (cellPx * marker.size * MARKER_FOOTPRINT) / 2;
    if (tokenPx <= 0) return [];
    const hasReach = effect.fx === 'orbit' || effect.fx === 'glow';
    const orbitRadii = hasReach
      ? effect.radius
        ? Math.max((effect.radius * ftToPx) / tokenPx, 1.2)
        : DEFAULT_ORBIT_RADII
      : 0;
    return [
      {
        effect,
        x: marker.position.x,
        y: marker.position.y,
        tokenPx,
        extent: tokenFxExtent(effect.fx, orbitRadii),
        orbitRadii
      }
    ];
  });
};

/** The placed effects grouped by kind, each group capped at MAX_TOKEN_EFFECTS_PER_KIND */
export const groupPlacedByKind = (placed: readonly PlacedTokenEffect[]): Map<TokenEffectKind, PlacedTokenEffect[]> => {
  const groups = new Map<TokenEffectKind, PlacedTokenEffect[]>();
  for (const item of placed) {
    const group = groups.get(item.effect.fx) ?? [];
    if (group.length < MAX_TOKEN_EFFECTS_PER_KIND) group.push(item);
    groups.set(item.effect.fx, group);
  }
  return groups;
};

/** Changes exactly when something the instance buffers hold changes, so identity churn never rewrites them */
export const placedEffectsSignature = (placed: readonly PlacedTokenEffect[]): string =>
  placed
    .map(
      ({ effect, x, y, tokenPx, extent, orbitRadii }) =>
        `${effect.id}|${x}|${y}|${tokenPx}|${extent}|${orbitRadii}|${effect.color}|${effect.variant ?? 0}|${effect.startedAt}`
    )
    .join(';');

/**
 * Seconds on the layer clock at which an effect began. Old effects are clamped so they read as settled,
 * and with reduced motion every effect is already settled.
 */
export const effectStartOnClock = (startedAtMs: number, nowMs: number, clockNow: number, reducedMotion = false) => {
  const ageS = reducedMotion
    ? TOKEN_EFFECT_MAX_AGE_S
    : Math.min(Math.max((nowMs - startedAtMs) / 1000, 0), TOKEN_EFFECT_MAX_AGE_S);
  return clockNow - ageS;
};

/** The shader clock: seconds since the layer began, held still for reduced motion and stepped on the low tier */
export const tokenEffectClock = (elapsedS: number, lowTier: boolean, reducedMotion: boolean) => {
  if (reducedMotion) return REDUCED_MOTION_EFFECT_TIME;
  return lowTier ? Math.floor(elapsedS * LOW_TIER_EFFECT_FPS) / LOW_TIER_EFFECT_FPS : elapsedS;
};
