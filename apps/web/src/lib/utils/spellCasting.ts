import type { PresenceChannel, SessionDocClient } from '$lib/realtime';
import type { AoeTemplateRow, MarkerRow } from '$lib/realtime/types';
import {
  AoeEffect,
  AoeShape,
  instantTemplateExpiresAt,
  isEffectOnlyPreset,
  MarkerShape,
  MarkerVisibility,
  resolveSpellAnyRuleset,
  resolveSpellAtSlot,
  resolveSummonSize,
  type MarkerConcentration,
  type ResolvedSpell,
  type Ruleset,
  type SpellAimSettings,
  type SpellAreaTargets,
  type SpellCast,
  type SpellSummonVariant,
  type StageMode,
  type TokenEffect
} from '@tableslayer/stage';
import { isMarkerConcentration, liveConcentration, sameConcentration, type ExistingRows } from './concentration';
import type { RecentSpell } from './recentSpells';

type Point = { x: number; y: number };

export type CasterMarker = Pick<MarkerRow, 'id' | 'positionX' | 'positionY' | 'size' | 'label'>;

/** A token a spell is bound to */
export type TargetMarker = Pick<MarkerRow, 'id' | 'positionX' | 'positionY' | 'size'>;

/** Where a spell's template starts and which way it points, as reported by the stage's `onSpellAimed` */
export interface SpellPlacement {
  position: Point;
  angle: number;
}

/**
 * `self`: centred on the caster, no aiming. `point`: placed where aimed. `direction`: starts at the caster.
 * `target`: tokens are picked, in range of the caster. `area-targets`: an area is placed, then the creatures in it are picked.
 */
export type SpellAimMode = 'self' | 'point' | 'direction' | 'target' | 'area-targets';

export const SPELL_TEMPLATE_OPACITY = 0.6;
/** A summoned token (or the effects of an area pick) appears when the cast reaches its impact, halfway through */
export const SUMMON_IMPACT_FRACTION = 0.5;

const SUMMON_ART_PATH = '/spell-tokens';
const FEET_PER_CELL = 5;

export const casterPoint = (caster: CasterMarker): Point => ({ x: caster.positionX, y: caster.positionY });

export const selfPlacement = (caster: Pick<CasterMarker, 'positionX' | 'positionY'>): SpellPlacement => ({
  position: { x: caster.positionX, y: caster.positionY },
  angle: 0
});

/**
 * Auras and self effects need a token to follow; targeted spells pick one, and summons follow the token they conjure.
 * An area-pick spell is placed on the map, and only needs a caster when the area starts at one (a cone).
 */
export const spellNeedsCaster = (spell: ResolvedSpell) => {
  const { areaPick, origin, anchored, summon, aim } = spell.resolved;
  if (areaPick) return origin === 'caster';
  return anchored && !summon && aim !== 'target';
};

export const spellAimMode = (spell: ResolvedSpell, hasCaster: boolean): SpellAimMode => {
  const { origin, area, aim, tokenFx, areaPick } = spell.resolved;
  if (aim === 'target') return 'target';
  if (areaPick) return 'area-targets';
  if (origin !== 'caster') return 'point';
  if (!area) return tokenFx && hasCaster ? 'self' : 'point';
  if (area.shape === AoeShape.Circle) return hasCaster ? 'self' : 'point';
  return 'direction';
};

export const spellSummonVariant = (spell: ResolvedSpell, variantId?: string): SpellSummonVariant | undefined => {
  const variants = spell.resolved.summon?.variants;
  return variants?.find((variant) => variant.id === variantId) ?? variants?.[0];
};

// A pure summon has no area, so aiming shows the footprint of the token it conjures
const aimArea = (spell: ResolvedSpell, variantId?: string) => {
  const { area, summon } = spell.resolved;
  if (area) return area;
  const cells = summon ? resolveSummonSize(summon, variantId ?? '') : 1;
  return { shape: AoeShape.Circle, size: (cells * FEET_PER_CELL) / 2 };
};

/** What the screen has gathered while aiming: the placed area (area-pick spells) and the tokens picked so far */
export interface SpellAimProgress {
  placement?: SpellPlacement | null;
  picked?: readonly string[];
}

/** What the stage aims; null for self spells, which cast at once */
export const buildSpellAim = (
  spell: ResolvedSpell,
  variantId?: string,
  caster?: CasterMarker,
  { placement, picked }: SpellAimProgress = {}
): SpellAimSettings | null => {
  const aim = spellAimMode(spell, !!caster);
  if (aim === 'self') return null;
  const { effect, color, rangeFt } = spell.resolved;
  const pickedMarkerIds = picked && { pickedMarkerIds: [...picked] };
  if (aim === 'target') {
    return {
      spellId: spell.id,
      label: spell.name,
      mode: 'target',
      area: { shape: AoeShape.Circle, size: FEET_PER_CELL / 2 },
      effect,
      color,
      aim: 'point',
      rangeFt,
      ...(caster && { caster: casterPoint(caster), casterSizeCells: caster.size }),
      ...pickedMarkerIds
    };
  }
  if (aim === 'area-targets') {
    const fromCaster = spell.resolved.origin === 'caster';
    return {
      spellId: spell.id,
      label: spell.name,
      mode: 'area-targets',
      area: aimArea(spell, variantId),
      effect,
      color,
      aim: fromCaster ? 'direction' : 'point',
      rangeFt,
      ...(caster && { caster: casterPoint(caster), casterSizeCells: caster.size }),
      ...(caster && fromCaster && { origin: casterPoint(caster), originRadiusCells: caster.size / 2 }),
      ...(placement && { placement }),
      ...pickedMarkerIds
    };
  }
  return {
    spellId: spell.id,
    label: spell.name,
    area: aimArea(spell, variantId),
    effect,
    color,
    aim,
    rangeFt,
    ...(caster && { caster: casterPoint(caster) }),
    ...(caster && aim === 'direction' && { origin: casterPoint(caster), originRadiusCells: caster.size / 2 })
  };
};

/** Picking a token again unpicks it */
export const toggleSpellTarget = (picked: readonly string[], markerId: string) =>
  picked.includes(markerId) ? picked.filter((id) => id !== markerId) : [...picked, markerId];

/**
 * What a screen keeps while a spell is aimed: the tokens tapped, and for an area-pick spell where the placed area
 * sits and who is inside it. Kept apart so moving the area away and back never loses the GM's taps.
 */
export interface SpellAimPicks {
  toggled: string[];
  placement: SpellPlacement | null;
  inside: string[];
}

export const NO_AIM_PICKS: SpellAimPicks = { toggled: [], placement: null, inside: [] };

export const toggleAimPick = <T extends SpellAimPicks>(aim: T, markerId: string): T => ({
  ...aim,
  toggled: toggleSpellTarget(aim.toggled, markerId)
});

/** The stage reported the placed area, or who is inside it after a move */
export const placeAimArea = <T extends SpellAimPicks>(
  aim: T,
  { placement, markerIds }: Pick<SpellAreaTargets, 'placement' | 'markerIds'>
): T => ({ ...aim, placement, inside: markerIds });

/** Who an area-pick spell would affect: `choose` the ticked tokens still inside, `saves` everyone inside but those unticked */
export const areaPickedMarkerIds = (
  areaPick: 'choose' | 'saves',
  inside: readonly string[],
  toggled: readonly string[]
) =>
  areaPick === 'choose' ? toggled.filter((id) => inside.includes(id)) : inside.filter((id) => !toggled.includes(id));

/** The tokens a spell would be cast on: the toggled ones, or for an area-pick spell the ones the area leaves picked */
export const spellPickedMarkerIds = (spell: ResolvedSpell, { toggled, inside }: SpellAimPicks) =>
  spell.resolved.areaPick ? areaPickedMarkerIds(spell.resolved.areaPick, inside, toggled) : [...toggled];

/** What the stage gets back while aiming: the placed area and the tokens picked */
export const spellAimProgress = (spell: ResolvedSpell, aim: SpellAimPicks): SpellAimProgress => ({
  placement: aim.placement,
  picked: spellPickedMarkerIds(spell, aim)
});

/**
 * What to do next while aiming; a mouse clicks where a finger taps and drags. `placed`: an area spell's first
 * click placed it, and a click inside it casts
 */
export const spellAimPrompt = (
  spellName: string,
  aim: SpellAimSettings,
  { mouse = false, picked = 0, inside = 0, placed = false } = {}
) => {
  if (aim.mode === 'target') {
    if (picked === 0) return `${mouse ? 'Click' : 'Tap'} targets for ${spellName}`;
    return `${spellName}: ${picked} ${picked === 1 ? 'target' : 'targets'}`;
  }
  if (aim.mode === 'area-targets' && aim.placement) {
    return `${spellName}: ${picked} of ${inside} ${inside === 1 ? 'creature' : 'creatures'} · drag to move`;
  }
  if (aim.mode === 'area-targets' && aim.aim === 'point')
    return `${mouse ? 'Click' : 'Tap'} where to place ${spellName}`;
  if (placed) return `${mouse ? 'Click' : 'Tap'} inside ${spellName} to cast · drag to move`;
  if (aim.aim === 'point') return `${mouse ? 'Click' : 'Tap'} where to place ${spellName}`;
  if (!mouse) return `Drag to aim ${spellName}`;
  return aim.origin ? `Click to aim ${spellName}` : `Click to start ${spellName}, then click to aim it`;
};

/** Radius in feet of a token's footprint: what an effect-only spell sizes its row and its cast to */
const footprintRadiusFt = (token: Pick<TargetMarker, 'size'>) => (token.size * FEET_PER_CELL) / 2;

/** The cast of a targeted or area-pick spell on the tokens picked: an area pick plays at its placed area */
export const targetCastRequest = (
  aim: Pick<SpellCastRequest, 'spellId' | 'variantId' | 'slotLevel'> & SpellAimPicks,
  caster: CasterMarker | undefined,
  targets: TargetMarker[]
): SpellCastRequest => ({
  spellId: aim.spellId,
  variantId: aim.variantId,
  slotLevel: aim.slotLevel,
  placement: aim.placement ?? selfPlacement(targets[0]),
  caster,
  targets,
  ...(aim.placement && { areaPlacement: aim.placement })
});

export const buildSpellCast = (
  spell: ResolvedSpell,
  placement: SpellPlacement,
  caster: CasterMarker | undefined,
  id: string,
  bound?: Pick<TargetMarker, 'size'>
): Omit<SpellCast, 'startedAt'> => {
  const { cast } = spell.resolved;
  const area =
    spell.resolved.area ??
    (bound ? { shape: AoeShape.Circle, size: footprintRadiusFt(bound) + FEET_PER_CELL / 2 } : undefined);
  return {
    id,
    spellId: spell.id,
    fx: cast.fx,
    variant: cast.variant ?? 0,
    palette: cast.palette,
    ...(cast.projectile && { projectile: true }),
    ...(area && { area: { ...area, angle: placement.angle } }),
    origin: caster ? casterPoint(caster) : placement.position,
    target: placement.position,
    durationMs: cast.durationMs
  };
};

export interface SpellTemplateOptions {
  id: string;
  sceneId: string;
  visibility: StageMode;
  nowMs: number;
  /** The marker an aura follows: the caster, or the token the spell summoned */
  anchorMarkerId?: string | null;
}

/** The lingering area a spell leaves: labelled with the spell, expiring when it is instant; null for pure summons */
export const buildSpellTemplate = (
  spell: ResolvedSpell,
  placement: SpellPlacement,
  { id, sceneId, visibility, nowMs, anchorMarkerId = null }: SpellTemplateOptions
): AoeTemplateRow | null => {
  const { area, effect, color, lingers, anchored, templateOpacity } = spell.resolved;
  if (!area) return null;
  const nowSeconds = Math.floor(nowMs / 1000);
  return {
    id,
    sceneId,
    shape: area.shape,
    positionX: placement.position.x,
    positionY: placement.position.y,
    angle: placement.angle,
    size: area.size,
    width: area.width ?? FEET_PER_CELL,
    effect,
    color,
    opacity: templateOpacity ?? SPELL_TEMPLATE_OPACITY,
    visibility,
    label: spell.name,
    anchorMarkerId: anchored ? anchorMarkerId : null,
    groupId: null,
    spellId: spell.id,
    expiresAt: lingers ? null : instantTemplateExpiresAt(nowMs, spell.resolved.cast.durationMs),
    createdAt: nowSeconds
  };
};

/**
 * The row of a spell that only decorates a token: a circle the size of the token's footprint with no effect,
 * anchored to the token, drawn by the TokenEffectLayer instead of the AoE layer. Null for other spells.
 */
export const buildTokenEffectRow = (
  spell: ResolvedSpell,
  bound: TargetMarker,
  { id, sceneId, visibility, nowMs }: Omit<SpellTemplateOptions, 'anchorMarkerId'>
): AoeTemplateRow | null => {
  const { color, lingers, tokenFx, templateOpacity } = spell.resolved;
  if (!tokenFx || !isEffectOnlyPreset(spell.resolved)) return null;
  const nowSeconds = Math.floor(nowMs / 1000);
  return {
    id,
    sceneId,
    shape: AoeShape.Circle,
    positionX: bound.positionX,
    positionY: bound.positionY,
    angle: 0,
    size: footprintRadiusFt(bound),
    width: FEET_PER_CELL,
    effect: AoeEffect.None,
    color,
    opacity: templateOpacity ?? SPELL_TEMPLATE_OPACITY,
    visibility,
    label: spell.name,
    anchorMarkerId: bound.id,
    groupId: null,
    spellId: spell.id,
    expiresAt: lingers ? null : instantTemplateExpiresAt(nowMs, spell.resolved.cast.durationMs),
    createdAt: nowSeconds
  };
};

/** Ids of the rows a scene snapshot holds */
export const sceneRowIds = (
  snapshot: { markers: readonly { id: string }[]; aoeTemplates: readonly { id: string }[] } | null
) => ({
  templateIds: new Set(snapshot?.aoeTemplates.map((template) => template.id) ?? []),
  markerIds: new Set(snapshot?.markers.map((marker) => marker.id) ?? [])
});

/** The spell a single token is concentrating on, when the field is set and a row it lists still exists */
export const concentratingSpellName = (
  marker: Pick<MarkerRow, 'concentration'> | undefined,
  snapshot: Parameters<typeof sceneRowIds>[0]
): string | null => {
  const live = liveConcentration(marker?.concentration, sceneRowIds(snapshot));
  return live ? (resolveSpellAnyRuleset(live.spellId)?.name ?? 'a spell') : null;
};

/** The spell colour of a concentration ring */
export const concentrationColor = (spellId: string) =>
  resolveSpellAnyRuleset(spellId)?.resolved.cast.palette[0] ?? '#ffffff';

type EffectRow = Pick<AoeTemplateRow, 'id' | 'spellId' | 'anchorMarkerId' | 'color' | 'createdAt'>;
type ConcentratingRow = Pick<MarkerRow, 'id' | 'concentration'>;

/**
 * The stage's token effects: the effect each anchored spell row draws on its token, and a ring for every
 * caster that is concentrating (the field set and at least one listed row still there).
 */
export const buildTokenEffects = (
  templates: readonly EffectRow[],
  markers: readonly ConcentratingRow[],
  existing: ExistingRows = {
    templateIds: new Set(templates.map((template) => template.id)),
    markerIds: new Set(markers.map((marker) => marker.id))
  }
): TokenEffect[] => {
  const effects: TokenEffect[] = templates.flatMap((template) => {
    if (!template.spellId || !template.anchorMarkerId || !existing.markerIds.has(template.anchorMarkerId)) return [];
    const { resolved } = resolveSpellAnyRuleset(template.spellId) ?? {};
    if (!resolved?.tokenFx) return [];
    return [
      {
        id: template.id,
        markerId: template.anchorMarkerId,
        fx: resolved.tokenFx,
        color: template.color,
        radius: resolved.tokenFxRadiusFt ?? resolved.area?.size,
        variant: resolved.tokenFxVariant,
        startedAt: template.createdAt * 1000
      }
    ];
  });
  for (const marker of markers) {
    const live = liveConcentration(marker.concentration, existing);
    if (!live) continue;
    effects.push({
      id: `concentration:${marker.id}`,
      markerId: marker.id,
      fx: 'concentration',
      color: concentrationColor(live.spellId),
      startedAt: live.startedAt * 1000
    });
  }
  return effects;
};

/** What a caster's concentration becomes after a cast: new, or (for a later pick of one multi-target cast) grown */
export const concentrationAfterCast = (
  spellId: string,
  nowSeconds: number,
  added: { templateIds: string[]; markerIds: string[] }
): MarkerConcentration => ({ spellId, startedAt: nowSeconds, ...added });

type ConcentrationClient = Pick<SessionDocClient, 'write' | 'scene' | 'stopCapturing'>;
type ConcentrationWriter = Pick<
  SessionDocClient['write'],
  'transaction' | 'deleteAoeTemplate' | 'deleteMarker' | 'setMarkerFields'
>;

const deleteListedRows = (writer: ConcentrationWriter, sceneId: string, concentration: MarkerConcentration) => {
  concentration.templateIds.forEach((id) => writer.deleteAoeTemplate(sceneId, id));
  concentration.markerIds.forEach((id) => writer.deleteMarker(sceneId, id));
};

/**
 * Ends a caster's concentration: the rows it lists are deleted and the field cleared in one transaction.
 * The write is the caller's own (tracked for undo when the GM does it, the TV's own for a player).
 * Returns whether the caster was concentrating.
 */
export const endConcentration = (
  client: ConcentrationClient,
  sceneId: string,
  casterId: string,
  writer: ConcentrationWriter = client.write
): boolean => {
  const snapshot = client.scene(sceneId);
  const caster = snapshot?.markers.find((marker) => marker.id === casterId);
  if (!snapshot || !caster?.concentration) return false;
  const live = liveConcentration(caster.concentration, sceneRowIds(snapshot));
  client.stopCapturing();
  writer.transaction(() => {
    if (live) deleteListedRows(writer, sceneId, live);
    writer.setMarkerFields(sceneId, casterId, { concentration: null });
  });
  client.stopCapturing();
  return true;
};

/** A spell effect bound to a token: the row that draws it and the spell's name */
export interface TokenSpellEffect {
  templateId: string;
  spellId: string;
  spellName: string;
}

type OwnerSnapshot = {
  markers: ReadonlyArray<Pick<MarkerRow, 'id' | 'title' | 'imageLocation' | 'concentration'>>;
  aoeTemplates: ReadonlyArray<Pick<AoeTemplateRow, 'id' | 'spellId' | 'anchorMarkerId'>>;
};

export interface SpellRowsOwnedBy {
  /** Effect-only rows (Bless, Hold person, Blur...) bound to the token */
  effects: TokenSpellEffect[];
  /** Every spell row anchored to the token, effects and areas that follow it */
  anchoredTemplateIds: string[];
  /** The spell that conjured the token, when it is a summon */
  summonedBy: string | null;
}

const isSummonArt = (imageLocation: string | null | undefined) => !!imageLocation?.startsWith(`${SUMMON_ART_PATH}/`);

/** What spells put on or tied to a token: its effects, the areas that follow it, and the spell that conjured it */
export const spellRowsOwnedBy = (snapshot: OwnerSnapshot, markerId: string): SpellRowsOwnedBy => {
  const anchored = snapshot.aoeTemplates.filter((template) => template.spellId && template.anchorMarkerId === markerId);
  const effects = anchored.flatMap((template) => {
    const spell = resolveSpellAnyRuleset(template.spellId ?? '');
    return spell && isEffectOnlyPreset(spell.resolved)
      ? [{ templateId: template.id, spellId: spell.id, spellName: spell.name }]
      : [];
  });
  const marker = snapshot.markers.find((row) => row.id === markerId);
  const conjuredBy = snapshot.markers
    .map((row) => row.concentration)
    .find((concentration) => isMarkerConcentration(concentration) && concentration.markerIds.includes(markerId));
  const conjuringSpell = isMarkerConcentration(conjuredBy) ? resolveSpellAnyRuleset(conjuredBy.spellId) : null;
  const summonedBy = conjuringSpell
    ? conjuringSpell.name
    : isSummonArt(marker?.imageLocation)
      ? marker?.title || 'summon'
      : null;
  return { effects, anchoredTemplateIds: anchored.map((template) => template.id), summonedBy };
};

type RemovalClient = Pick<SessionDocClient, 'write' | 'scene' | 'stopCapturing'>;

/**
 * Deletes spell rows and tidies every concentration that listed them: a field with nothing left is cleared,
 * a partly gone list is pruned. One transaction, so undo restores it as one step.
 */
export const removeSpellRows = (
  client: RemovalClient,
  sceneId: string,
  rows: { templateIds?: readonly string[]; markerIds?: readonly string[] },
  writer: ConcentrationWriter = client.write
) => {
  const snapshot = client.scene(sceneId);
  if (!snapshot) return;
  const templateIds = new Set(rows.templateIds ?? []);
  const markerIds = new Set(rows.markerIds ?? []);
  const remaining = {
    templateIds: new Set(snapshot.aoeTemplates.map((row) => row.id).filter((id) => !templateIds.has(id))),
    markerIds: new Set(snapshot.markers.map((row) => row.id).filter((id) => !markerIds.has(id)))
  };
  const updates = snapshot.markers.flatMap((marker) => {
    if (!marker.concentration || markerIds.has(marker.id)) return [];
    const live = liveConcentration(marker.concentration, remaining);
    return sameConcentration(live, marker.concentration) ? [] : [{ markerId: marker.id, concentration: live }];
  });
  client.stopCapturing();
  writer.transaction(() => {
    templateIds.forEach((id) => writer.deleteAoeTemplate(sceneId, id));
    markerIds.forEach((id) => writer.deleteMarker(sceneId, id));
    updates.forEach(({ markerId, concentration }) => writer.setMarkerFields(sceneId, markerId, { concentration }));
  });
  client.stopCapturing();
};

/**
 * Deletes tokens together with what their spells left: the rows their own concentrations list, the effects and
 * areas anchored to them, and the entries of casters whose lists named them. One transaction, one undo step.
 */
export const deleteMarkersWithSpells = (
  client: RemovalClient,
  sceneId: string,
  markerIds: readonly string[],
  writer: ConcentrationWriter = client.write
) => {
  const snapshot = client.scene(sceneId);
  if (!snapshot || markerIds.length === 0) return;
  const existing = sceneRowIds(snapshot);
  const owned = markerIds.map((markerId) => {
    const caster = snapshot.markers.find((marker) => marker.id === markerId);
    const listed = liveConcentration(caster?.concentration, existing);
    return {
      templateIds: [...(listed?.templateIds ?? []), ...spellRowsOwnedBy(snapshot, markerId).anchoredTemplateIds],
      markerIds: [markerId, ...(listed?.markerIds ?? [])]
    };
  });
  removeSpellRows(
    client,
    sceneId,
    {
      templateIds: owned.flatMap((rows) => rows.templateIds),
      markerIds: owned.flatMap((rows) => rows.markerIds)
    },
    writer
  );
};

export interface SummonMarkerOptions {
  id: string;
  sceneId: string;
  caster?: CasterMarker;
}

/** The token a summon conjures: the spell's name, the variant's built-in art, a ring in the spell's colour */
export const buildSummonMarkers = (
  spell: ResolvedSpell,
  variantId: string | undefined,
  placement: SpellPlacement,
  { id, sceneId, caster }: SummonMarkerOptions
): MarkerRow[] => {
  const { summon, cast } = spell.resolved;
  const variant = spellSummonVariant(spell, variantId);
  if (!summon || !variant) return [];
  return [
    {
      id,
      sceneId,
      visibility: MarkerVisibility.Always,
      title: spell.name,
      label: caster?.label ?? null,
      imageLocation: `${SUMMON_ART_PATH}/${variant.icon}.svg`,
      imageScale: 1,
      positionX: placement.position.x,
      positionY: placement.position.y,
      shape: MarkerShape.Circle,
      shapeColor: cast.palette[0],
      size: resolveSummonSize(summon, variant.id),
      note: null,
      pinnedTooltip: false,
      conditions: []
    }
  ];
};

export interface CastSpellContext {
  client: Pick<SessionDocClient, 'write' | 'stopCapturing' | 'scene'>;
  presence: Pick<PresenceChannel, 'castSpell'> | null | undefined;
  sceneId: string;
  ruleset: Ruleset;
  /** Visibility of the template a cast leaves */
  templateVisibility: StageMode;
  /** Snaps a summoned token to the grid, like any token placed on the map */
  snapToGrid?: (point: Point) => Point;
  /** Short feedback ("Hold person ended. Now concentrating on Bless") */
  notify?: (message: string) => void;
  now?: () => number;
  newId: () => string;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
}

export interface SpellCastRequest {
  spellId: string;
  variantId?: string;
  /** The slot it is cast with; an area that grows with the slot uses that size. Omitted: the spell's own level */
  slotLevel?: number;
  placement: SpellPlacement;
  caster?: CasterMarker;
  /** The tokens a targeted spell is bound to, each getting its own effect; without any it binds to the caster */
  targets?: TargetMarker[];
  /** Area-pick spells: where the area was placed; it plays once there (no beams), the effects go on `targets` */
  areaPlacement?: SpellPlacement;
}

/** Where one cast lands: each picked target, else the request's placement bound to the caster */
const castBindings = (
  request: SpellCastRequest,
  placement: SpellPlacement
): { bound?: TargetMarker; placement: SpellPlacement }[] =>
  request.targets?.length
    ? request.targets.map((target) => ({ bound: target, placement: selfPlacement(target) }))
    : [{ bound: request.caster, placement }];

const concentrationNotice = (previousSpellId: string, spell: ResolvedSpell) => {
  const previous = resolveSpellAnyRuleset(previousSpellId)?.name ?? 'Concentration';
  return `${previous} ended. Concentrating on ${spell.name}`;
};

/** Registers the rows a cast just made on its caster; its previous concentration ends first (the 5e rule) */
const registerConcentration = (
  context: CastSpellContext,
  spell: ResolvedSpell,
  request: SpellCastRequest,
  added: { templateIds: string[]; markerIds: string[] },
  nowSeconds: number
) => {
  const { caster } = request;
  if (!caster || !spell.resolved.concentration) return;
  const { client, sceneId, notify } = context;
  const snapshot = client.scene(sceneId);
  const row = snapshot?.markers.find((marker) => marker.id === caster.id);
  if (!snapshot || !row) return;
  const current = liveConcentration(row.concentration, sceneRowIds(snapshot));
  if (current) {
    deleteListedRows(client.write, sceneId, current);
    notify?.(concentrationNotice(current.spellId, spell));
  }
  client.write.setMarkerFields(sceneId, caster.id, {
    concentration: concentrationAfterCast(spell.id, nowSeconds, added)
  });
};

// One undo step on its own, kept apart from the edits around it
const writeSpellResults = (
  context: CastSpellContext,
  spell: ResolvedSpell,
  request: SpellCastRequest,
  placement: SpellPlacement,
  summonedMarkerId: string | null
) => {
  const { client, sceneId, templateVisibility, now = Date.now, newId } = context;
  const nowMs = now();
  const templates = castBindings(request, placement).flatMap(({ bound, placement: landing }) => {
    const templateOptions = { id: newId(), sceneId, visibility: templateVisibility, nowMs };
    const template = isEffectOnlyPreset(spell.resolved)
      ? bound && buildTokenEffectRow(spell, bound, templateOptions)
      : buildSpellTemplate(spell, landing, {
          ...templateOptions,
          anchorMarkerId: summonedMarkerId ?? bound?.id ?? null
        });
    return template ? [template] : [];
  });
  const markers = summonedMarkerId
    ? buildSummonMarkers(spell, request.variantId, placement, {
        id: summonedMarkerId,
        sceneId,
        caster: request.caster
      })
    : [];
  client.stopCapturing();
  client.write.transaction(() => {
    markers.forEach((marker) => client.write.upsertMarker(sceneId, marker));
    templates.forEach((template) => client.write.upsertAoeTemplate(sceneId, template));
    registerConcentration(
      context,
      spell,
      request,
      { templateIds: templates.map((template) => template.id), markerIds: summonedMarkerId ? [summonedMarkerId] : [] },
      Math.floor(nowMs / 1000)
    );
  });
  client.stopCapturing();
};

/**
 * Plays a spell on every screen and leaves its results in the doc: the template (or token effect) at once,
 * a summoned token (with any area that follows it) or the effects of an area pick when the animation reaches its impact. A concentration
 * spell cast by a token is registered on it, ending that token's previous one.
 * Returns the recent-spells entry for the cast, or null when the spell is unknown for the ruleset.
 */
export const castSpell = (context: CastSpellContext, request: SpellCastRequest): RecentSpell | null => {
  const spell = resolveSpellAtSlot(request.spellId, context.ruleset, request.slotLevel);
  if (!spell) return null;
  const { setTimer = setTimeout, snapToGrid } = context;
  const isSummon = !!spell.resolved.summon;
  const placement: SpellPlacement =
    isSummon && snapToGrid
      ? { ...request.placement, position: snapToGrid(request.placement.position) }
      : request.placement;
  const summonedMarkerId = isSummon ? context.newId() : null;

  const flights = request.areaPlacement
    ? [{ bound: undefined, placement: request.areaPlacement }]
    : castBindings(request, placement);
  flights.forEach(({ bound, placement: landing }) =>
    context.presence?.castSpell({
      ...buildSpellCast(spell, landing, request.caster, context.newId(), bound),
      sceneId: context.sceneId
    })
  );

  const writeResults = () => writeSpellResults(context, spell, request, placement, summonedMarkerId);
  if (isSummon || request.areaPlacement)
    setTimer(writeResults, spell.resolved.cast.durationMs * SUMMON_IMPACT_FRACTION);
  else writeResults();

  const upcast = request.slotLevel !== undefined && request.slotLevel > spell.resolved.level;
  return {
    spellId: spell.id,
    ...(request.variantId && { variantId: request.variantId }),
    ...(upcast && { slotLevel: request.slotLevel })
  };
};
