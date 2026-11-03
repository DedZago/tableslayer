import type { MarkerRow } from '$lib/realtime';
import { aoeFieldsFromPatch, aoeRowFromTemplate } from '$lib/utils/aoeTemplateRows';
import {
  expandToGroups,
  groupIdOf,
  groupMembers,
  planGroupToggle,
  toggleGroupInSelection,
  type GroupedRows,
  type GroupMember
} from '$lib/utils/assetGroups';
import {
  concentrationHighlight,
  isConcentrationActive,
  nextConcentrationFocus,
  type ConcentrationHighlight
} from '$lib/utils/concentration';
import { devError, devLog } from '$lib/utils/debug';
import { readRecentSpells, withRecentSpell, writeRecentSpells, type RecentSpell } from '$lib/utils/recentSpells';
import {
  buildSpellAim,
  castSpell,
  concentratingSpellName,
  deleteMarkersWithSpells,
  endConcentration,
  NO_AIM_PICKS,
  placeAimArea,
  removeSpellRows,
  sceneRowIds,
  selfPlacement,
  spellAimProgress,
  spellAimPrompt,
  spellNeedsCaster,
  spellPickedMarkerIds,
  spellRowsOwnedBy,
  targetCastRequest,
  toggleAimPick,
  type CasterMarker,
  type SpellAimPicks,
  type SpellCastRequest
} from '$lib/utils/spellCasting';
import { parseSpellItemId, spellFxToPrewarm, TV_NO_CASTER_HINT, type SpellMenuState } from '$lib/utils/spellMenus';
import {
  AnnotationEffect,
  AOE_EFFECT_DEFAULT_COLORS,
  AoeEffect,
  AoeShape,
  DrawMode,
  getDefaultEffectProps,
  MapLayerType,
  MeasurementType,
  resolveCondition,
  resolveSpellAnyRuleset,
  resolveSpellAtSlot,
  StageMode,
  type AnnotationLayerData,
  type AoeTemplate,
  type AoeToolSettings,
  type Marker,
  type MarkerCondition,
  type RadialMenuItemProps,
  type SpellAimed,
  type SpellAimPlaced,
  type SpellAreaTargets,
  type SpellTargeted,
  type StageExports
} from '@tableslayer/stage';
import { v4 as uuidv4 } from 'uuid';
import { DRAW_COLORS, newPlayerLayer, playerDrawings, playerLayerFor, type DrawBrush } from './playDrawing';
import {
  aoeMenu,
  drawItem,
  generalMenu,
  groupItems,
  MENU_ID,
  menuMembers,
  tokenMenu,
  type MenuTarget
} from './playMenus';
import type { PlaySession, SessionRoute } from './usePlaySession.svelte';

// Fog brush size in grid units (number of grid squares the brush spans)
const PLAYFIELD_FOG_BRUSH_SIZE = 2;
const FOG_COMMIT_DEBOUNCE_MS = 500;
const FOG_IDLE_RESET_MS = 3000;
// The draw tool (and its panel) turns off after this long without a stroke
const DRAW_IDLE_MS = 30000;
const NOTICE_MS = 2500;
// Touchscreens may report a long press as both a hold and a contextmenu; the second open is ignored
const MENU_REOPEN_GUARD_MS = 600;

export interface PlayToolsOptions {
  session: PlaySession;
  userId: string;
  getStage: () => StageExports | undefined;
  routes: () => SessionRoute[];
  defaultSessionFilter: () => string | undefined;
  canFit: () => boolean;
  onFit: () => void;
}

/**
 * Touch-play editing tools: every edit commits straight to the shared doc (fog
 * masks, drawings, scene switches). There is no save pipeline here — the
 * PartyKit server persists.
 */
export class PlayTools {
  // Local-only view state (never shared)
  activeLayer = $state<MapLayerType>(MapLayerType.None);
  /** Brush size in grid squares (local, applies to the next stroke) */
  lineWidth = $state(0.25);
  fogTool = $state<{ mode: DrawMode; size: number }>({ mode: DrawMode.Erase, size: PLAYFIELD_FOG_BRUSH_SIZE });
  measurement = $state<{ type: number; coneAngle?: number; beamWidth?: number }>({ type: MeasurementType.Line });

  // Touch toolbar modes (local-only): multi-select, token-to-token distances, AoE templates
  groupSelect = $state(false);
  distanceMode = $state(false);
  /** Selected tokens and AoEs (plus lights that came along with a group, which the TV can't pick alone) */
  selection = $state<GroupMember[]>([]);
  aoeTool = $state<Partial<AoeToolSettings>>({
    shape: AoeShape.Circle,
    effect: AoeEffect.Fire,
    color: AOE_EFFECT_DEFAULT_COLORS[AoeEffect.Fire],
    visibility: StageMode.Player
  });

  /** The radial menu and what it acts on */
  menu = $state<{ target: MenuTarget; x: number; y: number } | null>(null);
  /** The custom condition form, opened from the menu's "New…" */
  conditionForm = $state<{ x: number; y: number; markerIds: string[] } | null>(null);
  /** Short feedback line ("Grouped 3 items") */
  notice = $state<string | null>(null);

  /** The spell being aimed: the AoE layer is active with its preset locked until a tap places it */
  spellAim = $state<
    ({ spellId: string; variantId?: string; slotLevel?: number; casterId?: string } & SpellAimPicks) | null
  >(null);
  /** A concentrating token tapped on this screen: what its concentration holds is highlighted (local only) */
  focusedMarkerId = $state<string | null>(null);
  /** Spells cast lately on this device, offered first in the spell ring */
  recentSpells = $state<RecentSpell[]>(readRecentSpells());

  /** The draw tool's brush; the tool is on while it is set */
  drawBrush = $state<DrawBrush | null>(null);
  /** Where the draw panel sits (the point the menu was opened at) */
  drawPanel = $state<{ x: number; y: number } | null>(null);

  #options: PlayToolsOptions;
  #menuOpenedAt = 0;
  #noticeTimer: ReturnType<typeof setTimeout> | null = null;
  // Id the next new player layer gets; it is shown as an empty draft layer until its first stroke saves it
  #draftLayerId = $state(uuidv4());
  #lastPaintBrush: Exclude<DrawBrush, { kind: 'erase' }> = { kind: 'color', color: DRAW_COLORS[0].color };
  #drawIdleTimer: ReturnType<typeof setTimeout> | null = null;
  #strokeLayerIds = new Set<string>();
  #strokeWrites: Promise<void> = Promise.resolve();
  #resetLayerTimer: ReturnType<typeof setTimeout> | null = null;
  #pendingFogCommit: { timer: ReturnType<typeof setTimeout>; sceneId: string } | null = null;

  constructor(options: PlayToolsOptions) {
    this.#options = options;
  }

  #annotations() {
    return this.#options.session.activeScene?.annotations ?? [];
  }

  /** Another tool (measure, AoE) replaces the draw tool without clearing the brush */
  get isDrawActive() {
    return this.drawBrush !== null && this.activeLayer === MapLayerType.Annotation;
  }

  /** The layer strokes paint on: this brush's player layer, or the draft that becomes it */
  get annotationsActiveLayer(): string | null {
    const brush = this.drawBrush;
    if (!brush || brush.kind === 'erase') return null;
    return playerLayerFor(this.#annotations(), brush)?.id ?? this.#draftLayerId;
  }

  /** Eraser targets: player drawings only, so GM drawings can never be erased from the TV */
  get eraseLayerIds(): string[] {
    return playerDrawings(this.#annotations()).map((annotation) => annotation.id);
  }

  get playerDrawingCount() {
    return playerDrawings(this.#annotations()).length;
  }

  /** The empty layer a new brush paints on until its first stroke writes it to the doc */
  get draftLayers(): AnnotationLayerData[] {
    const brush = this.drawBrush;
    const id = this.annotationsActiveLayer;
    if (!this.isDrawActive || !brush || brush.kind === 'erase' || id !== this.#draftLayerId) return [];
    // Saved: the doc row takes over under the same id, so the layer never remounts
    if (this.#annotations().some((annotation) => annotation.id === id)) return [];
    const row = newPlayerLayer(id, '', [], brush);
    return [
      {
        id,
        name: row.name,
        color: row.color,
        opacity: row.opacity,
        url: null,
        mask: null,
        visibility: StageMode.Player,
        effect: brush.kind === 'effect' ? getDefaultEffectProps(brush.effect) : undefined
      }
    ];
  }

  get selectedMarkerIds(): string[] {
    return this.#selectedIn('markers');
  }

  set selectedMarkerIds(ids: string[]) {
    this.#replaceSelected('markers', ids);
  }

  get aoeSelectedIds(): string[] {
    return this.#selectedIn('aoeTemplates');
  }

  set aoeSelectedIds(ids: string[]) {
    this.#replaceSelected('aoeTemplates', ids);
  }

  #selectedIn(collection: GroupMember['collection']) {
    return this.selection.filter((member) => member.collection === collection).map((member) => member.id);
  }

  #replaceSelected(collection: GroupMember['collection'], ids: string[]) {
    this.selection = [
      ...this.selection.filter((member) => member.collection !== collection),
      ...ids.map((id) => ({ collection, id }))
    ];
  }

  #rows(): GroupedRows {
    const scene = this.#options.session.activeScene;
    return { markers: scene?.markers ?? [], lights: scene?.lights ?? [], aoeTemplates: scene?.aoeTemplates ?? [] };
  }

  #markerRows(ids: string[]): MarkerRow[] {
    return (this.#options.session.activeScene?.markers ?? []).filter((marker) => ids.includes(marker.id));
  }

  /** Custom conditions players can see somewhere in the scene, offered for reuse */
  #customSuggestions(): MarkerCondition[] {
    const byId = new Map<string, MarkerCondition>();
    for (const marker of this.#options.session.activeScene?.markers ?? []) {
      for (const condition of marker.conditions ?? []) {
        if (!condition.dmOnly && condition.id.startsWith('custom:') && !byId.has(condition.id)) {
          byId.set(condition.id, condition);
        }
      }
    }
    return [...byId.values()];
  }

  #say(text: string) {
    this.notice = text;
    if (this.#noticeTimer) clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => (this.notice = null), NOTICE_MS);
  }

  // ---------------------------------------------------------------------------
  // Radial menu
  // ---------------------------------------------------------------------------

  /** Opens the menu for whatever is under a client point: a token, an AoE, or the map */
  openMenuAt(point: { x: number; y: number }) {
    const stage = this.#options.getStage();
    const markerId = stage?.markers.hitTest(point);
    if (markerId) return this.openTokenMenu(markerId, point);
    const layerPoint = stage?.markers.clientToPosition(point);
    const aoeId = layerPoint ? stage?.aoeTemplates.hitTest(layerPoint) : null;
    if (aoeId) return this.openAoeMenu(aoeId, point);
    this.#openMenu({ kind: 'general' }, point);
  }

  openTokenMenu(markerId: string, point: { x: number; y: number }) {
    const pressed: GroupMember = { collection: 'markers', id: markerId };
    const members = this.groupSelect ? menuMembers(pressed, this.selection) : [pressed];
    this.#openMenu({ kind: 'token', markerId, members }, point);
  }

  openAoeMenu(aoeId: string, point: { x: number; y: number }) {
    const pressed: GroupMember = { collection: 'aoeTemplates', id: aoeId };
    const members = this.groupSelect ? menuMembers(pressed, this.selection) : [pressed];
    this.#openMenu({ kind: 'aoe', aoeId, members }, point);
  }

  #openMenu(target: MenuTarget, point: { x: number; y: number }) {
    if (this.menu && performance.now() - this.#menuOpenedAt < MENU_REOPEN_GUARD_MS) return;
    this.#menuOpenedAt = performance.now();
    this.conditionForm = null;
    this.menu = { target, ...point };
  }

  /** The draw panel's brush button: pick another color, effect or the eraser */
  openDrawMenu(point: { x: number; y: number }) {
    this.#openMenu({ kind: 'draw' }, point);
  }

  closeMenu() {
    this.menu = null;
  }

  #menuIds(collection: GroupMember['collection']): string[] {
    const target = this.menu?.target;
    if (!target || !('members' in target)) return [];
    return target.members.filter((member) => member.collection === collection).map((member) => member.id);
  }

  get menuItems(): RadialMenuItemProps[] {
    const target = this.menu?.target;
    if (!target) return [];
    if (target.kind === 'draw') return drawItem(this.playerDrawingCount).submenu ?? [];
    if (target.kind === 'general') {
      return generalMenu({
        canUndo: this.canUndo,
        canRedo: this.canRedo,
        canFit: this.#options.canFit(),
        groupSelect: this.groupSelect,
        distanceMode: this.distanceMode,
        selectionCount: this.selection.length,
        playerDrawingCount: this.playerDrawingCount,
        spells: this.#spellMenuState(false)
      });
    }
    const rows = this.#rows();
    const groups = groupItems(rows, target.members);
    if (target.kind === 'token') {
      return tokenMenu({
        markers: this.#markerRows(this.#menuIds('markers')),
        customSuggestions: this.#customSuggestions(),
        groupItems: groups,
        selectionCount: this.selection.length,
        spells: this.#spellMenuState(true),
        concentratingOn: this.#concentratingOn(target.members),
        ...this.#tokenSpellRows(target.members)
      });
    }
    const aoeIds = this.#menuIds('aoeTemplates');
    const templates = (this.#options.session.activeScene?.aoeTemplates ?? []).filter((template) =>
      aoeIds.includes(template.id)
    );
    const shared = <T>(values: T[]) => (values.every((value) => value === values[0]) ? values[0] : undefined);
    return aoeMenu({
      count: templates.length,
      spellName: templates.length === 1 ? this.#spellNameOf(templates[0].spellId) : null,
      effect: shared(templates.map((template) => template.effect)),
      opacity: shared(templates.map((template) => template.opacity)),
      groupItems: groups
    });
  }

  /** Hub text when nothing is pressed: what the menu acts on */
  get menuTitle(): string {
    const target = this.menu?.target;
    if (target?.kind === 'draw') return 'Draw';
    if (!target || !('members' in target)) return 'Map';
    if (target.members.length > 1) return `${target.members.length} selected`;
    if (target.kind === 'aoe') return 'Spell area';
    return this.#markerRows([target.markerId])[0]?.title || 'Token';
  }

  /** The menu closes when what it acts on is gone (deleted on the GM screen, or another scene) */
  get menuTargetGone(): boolean {
    const target = this.menu?.target;
    if (!target || !('members' in target)) return false;
    const rows = this.#rows();
    return target.kind === 'token'
      ? !rows.markers.some((marker) => marker.id === target.markerId)
      : !rows.aoeTemplates.some((template) => template.id === target.aoeId);
  }

  get isAoeActive() {
    return this.activeLayer === MapLayerType.AoeTemplate;
  }

  toggleGroupSelect() {
    this.groupSelect = !this.groupSelect;
    this.distanceMode = false;
    this.selection = [];
  }

  toggleDistanceMode() {
    this.distanceMode = !this.distanceMode;
    this.groupSelect = false;
    this.selection = [];
  }

  toggleAoe() {
    this.activeLayer = this.isAoeActive ? MapLayerType.None : MapLayerType.AoeTemplate;
    this.drawBrush = null;
    if (!this.isAoeActive) this.aoeSelectedIds = [];
  }

  setAoeShape(shape: AoeShape) {
    this.aoeTool = { ...this.aoeTool, shape };
    this.activeLayer = MapLayerType.AoeTemplate;
  }

  // With shapes selected a swatch recolors only them; the tool keeps its effect for the next drawing
  setAoeEffect(effect: AoeEffect) {
    if (this.aoeSelectedIds.length) {
      this.setSelectedAoeEffect(effect);
      return;
    }
    this.aoeTool = { ...this.aoeTool, effect, color: AOE_EFFECT_DEFAULT_COLORS[effect] };
    this.activeLayer = MapLayerType.AoeTemplate;
  }

  /** The effect the swatches act on: the selection's shared effect, else the tool's */
  aoeSwatchEffect(templates: Array<{ id: string; effect: AoeEffect }>): AoeEffect | undefined {
    if (!this.aoeSelectedIds.length) return this.aoeTool.effect;
    const effects = new Set(templates.filter((t) => this.aoeSelectedIds.includes(t.id)).map((t) => t.effect));
    return effects.size === 1 ? [...effects][0] : undefined;
  }

  /** Stage callback: a token was tapped; select mode toggles it with its group, distance mode makes it the origin. */
  onMarkerSelected = (marker: Marker | null) => {
    if (!marker || this.spellAim) return;
    const member: GroupMember = { collection: 'markers', id: marker.id };
    if (this.groupSelect) this.selection = toggleGroupInSelection(this.#rows(), member, this.selection);
    else if (this.distanceMode) this.selection = [member];
  };

  /** The select-mode marquee adds what it encloses, with their groups */
  selectMembers(members: GroupMember[]) {
    this.selection = expandToGroups(this.#rows(), [...this.selection, ...members]);
  }

  /** Stage callback: shapes picked by tap. Select mode toggles a tapped shape with its group. */
  onAoeTemplatesSelected = (ids: string[]) => {
    if (this.groupSelect && ids.length === 1) {
      const member: GroupMember = { collection: 'aoeTemplates', id: ids[0] };
      this.selection = toggleGroupInSelection(this.#rows(), member, this.selection);
    } else if (this.groupSelect) {
      this.selectMembers(ids.map((id) => ({ collection: 'aoeTemplates', id })));
    } else {
      this.aoeSelectedIds = ids;
    }
  };

  /**
   * Stage callbacks: AoE shapes drawn on this screen are written straight to the doc, like marker moves.
   * A new shape is not auto-selected, so the toolbar swatches pick the next shape's effect
   * instead of recoloring the last one; tap a shape to select and edit it.
   */
  onAoeTemplateAdded = (template: AoeTemplate) => {
    const sceneId = this.#options.session.activeSceneId;
    if (!sceneId) return;
    this.#options.session.client?.write.upsertAoeTemplate(sceneId, aoeRowFromTemplate(sceneId, template));
  };

  onAoeTemplateUpdated = (id: string, patch: Partial<Omit<AoeTemplate, 'id'>>) => {
    const sceneId = this.#options.session.activeSceneId;
    if (sceneId) this.#options.session.client?.write.setAoeTemplateFields(sceneId, id, aoeFieldsFromPatch(patch));
  };

  onAoeTemplateDeleted = (id: string) => {
    this.#removeTemplates([id]);
  };

  /** Removes areas from the doc; a spell area that was a caster's last row clears its concentration too */
  #removeTemplates(ids: string[]) {
    const { client, activeSceneId } = this.#options.session;
    this.aoeSelectedIds = this.aoeSelectedIds.filter((selected) => !ids.includes(selected));
    if (client && activeSceneId) removeSpellRows(client, activeSceneId, { templateIds: ids });
  }

  // Right-click or a long press on a shape opens its radial menu
  onAoeTemplateMenu = (id: string, position: { x: number; y: number }) => {
    this.openAoeMenu(id, position);
  };

  setSelectedAoeEffect(effect: AoeEffect) {
    const patch = { effect, color: AOE_EFFECT_DEFAULT_COLORS[effect] };
    this.aoeSelectedIds.forEach((id) => this.onAoeTemplateUpdated(id, patch));
  }

  setSelectedAoeOpacity(opacity: number) {
    this.aoeSelectedIds.forEach((id) => this.onAoeTemplateUpdated(id, { opacity }));
  }

  deleteSelectedAoeTemplates() {
    this.#removeTemplates([...this.aoeSelectedIds]);
  }

  // ---------------------------------------------------------------------------
  // Spells: the ring picks one, the AoE layer aims it, `castSpell` plays and writes it
  // ---------------------------------------------------------------------------

  #spellMenuState(hasCaster: boolean): SpellMenuState {
    return {
      ruleset: this.#options.session.ruleset,
      recent: this.recentSpells,
      hasCaster,
      noCasterHint: TV_NO_CASTER_HINT
    };
  }

  #casterRow(markerId: string | undefined): CasterMarker | undefined {
    return markerId ? this.#markerRows([markerId])[0] : undefined;
  }

  /** The spell the pressed token concentrates on, when it is the only token pressed */
  #concentratingOn(members: GroupMember[]): string | null {
    const ids = members.filter((member) => member.collection === 'markers').map((member) => member.id);
    if (ids.length !== 1) return null;
    return concentratingSpellName(this.#markerRows(ids)[0], this.#options.session.activeScene);
  }

  #spellNameOf(spellId: string | null | undefined) {
    return spellId ? (resolveSpellAnyRuleset(spellId)?.name ?? null) : null;
  }

  /** The effects and summoner of the single pressed token, for the "Spell effects" and "Dismiss" items */
  #tokenSpellRows(members: GroupMember[]) {
    const ids = members.filter((member) => member.collection === 'markers').map((member) => member.id);
    const snapshot = this.#options.session.activeScene;
    if (ids.length !== 1 || !snapshot) return {};
    const owned = spellRowsOwnedBy(snapshot, ids[0]);
    // The TV never names effects the GM keeps hidden
    const shown = new Set(
      snapshot.aoeTemplates.filter((row) => row.visibility === StageMode.Player).map((row) => row.id)
    );
    return {
      spellEffects: owned.effects.filter((effect) => shown.has(effect.templateId)),
      summonedBy: owned.summonedBy
    };
  }

  /** The aimed spell as its slot casts it (an upcast area is larger) */
  #aimedSpell() {
    const aim = this.spellAim;
    return aim ? resolveSpellAtSlot(aim.spellId, this.#options.session.ruleset, aim.slotLevel) : null;
  }

  #spellAimSettings() {
    const aim = this.spellAim;
    const spell = this.#aimedSpell();
    return spell && aim
      ? buildSpellAim(spell, aim.variantId, this.#casterRow(aim.casterId), spellAimProgress(spell, aim))
      : null;
  }

  /** The AoE tool as the stage gets it: while a spell is aimed it carries the spell's preset */
  get stageAoeTool(): Partial<AoeToolSettings> {
    const spell = this.#spellAimSettings();
    return spell ? { ...this.aoeTool, spell } : this.aoeTool;
  }

  /** What to do next while a spell is aimed ("Tap where to cast Fireball") */
  get spellAimPrompt(): string | null {
    const aim = this.spellAim;
    const spell = this.#aimedSpell();
    const settings = this.#spellAimSettings();
    return spell && aim && settings
      ? spellAimPrompt(spell.name, settings, {
          picked: this.#pickedCount(),
          inside: aim.inside.length,
          placed: this.#isAimPlaced()
        })
      : null;
  }

  #pickedCount() {
    const aim = this.spellAim;
    const spell = this.#aimedSpell();
    return aim && spell ? spellPickedMarkerIds(spell, aim).length : 0;
  }

  /** An area spell placed by its first tap, waiting for the tap inside it that casts */
  #isAimPlaced() {
    const mode = this.#spellAimSettings()?.mode;
    return !!this.spellAim?.placement && mode !== 'target' && mode !== 'area-targets';
  }

  /** Target or area-pick aim with at least one token picked: the label of the button that casts it */
  get spellCastLabel(): string | null {
    const mode = this.#spellAimSettings()?.mode;
    return this.#pickedCount() > 0 && (mode === 'target' || mode === 'area-targets') ? 'Cast' : null;
  }

  /** Aiming stops when its caster is deleted on the GM screen */
  get spellAimCasterGone(): boolean {
    const casterId = this.spellAim?.casterId;
    return !!casterId && !this.#casterRow(casterId);
  }

  cancelSpellAim() {
    if (!this.spellAim) return;
    this.spellAim = null;
    if (this.isAoeActive) this.activeLayer = MapLayerType.None;
  }

  /** Opening a spell ring links just the programs its spells use, so none compiles mid-animation */
  onMenuSubmenuOpen = (itemId: string) => {
    const { cast, token } = spellFxToPrewarm(itemId, {
      ruleset: this.#options.session.ruleset,
      recent: this.recentSpells
    });
    if (cast.length > 0 || token.length > 0) this.#options.getStage()?.spells.prewarm(cast, token);
  };

  #startSpell({ spellId, variantId, slotLevel }: RecentSpell) {
    const spell = resolveSpellAtSlot(spellId, this.#options.session.ruleset, slotLevel);
    if (!spell) return;
    const markerIds = this.#menuIds('markers');
    const caster = markerIds.length === 1 ? this.#casterRow(markerIds[0]) : undefined;
    if (spellNeedsCaster(spell) && !caster) {
      this.#say(TV_NO_CASTER_HINT);
      return;
    }
    if (!buildSpellAim(spell, variantId, caster)) {
      if (caster) this.#cast({ spellId, variantId, slotLevel, placement: selfPlacement(caster), caster });
      return;
    }
    this.drawBrush = null;
    this.spellAim = { spellId, variantId, slotLevel, casterId: caster?.id, ...NO_AIM_PICKS };
    this.activeLayer = MapLayerType.AoeTemplate;
  }

  /** Stage callback: a token was tapped while a targeted spell is aimed; it toggles in or out of the picks */
  onSpellTargeted = ({ spellId, markerId }: SpellTargeted) => {
    const aim = this.spellAim;
    if (!aim || aim.spellId !== spellId || this.#markerRows([markerId]).length === 0) return;
    this.spellAim = toggleAimPick(aim, markerId);
  };

  /** Stage callback: an area-pick spell was placed or moved, or the tokens inside it changed */
  onSpellAreaTargets = ({ spellId, placement, markerIds }: SpellAreaTargets) => {
    const aim = this.spellAim;
    if (!aim || aim.spellId !== spellId) return;
    this.spellAim = placeAimArea(aim, { placement, markerIds });
  };

  /** Enter or Cast: a placed area spell casts where it sits; a targeted spell once on every picked token that still exists */
  confirmSpellAim() {
    const aim = this.spellAim;
    if (aim?.placement && this.#isAimPlaced()) {
      this.onSpellAimed({ spellId: aim.spellId, ...aim.placement });
      return;
    }
    const spell = this.#aimedSpell();
    const targets = aim && spell ? this.#markerRows(spellPickedMarkerIds(spell, aim)) : [];
    if (!aim || targets.length === 0) return;
    this.cancelSpellAim();
    this.#cast(targetCastRequest(aim, this.#casterRow(aim.casterId), targets));
  }

  /** Ends the pressed token's concentration, removing the effects it holds */
  #endConcentration(markerId: string | undefined) {
    const { client, activeSceneId } = this.#options.session;
    if (!client || !activeSceneId || !markerId) return;
    if (endConcentration(client, activeSceneId, markerId)) this.#say('Concentration ended');
  }

  /** Removes a summoned token with the areas that follow it and the entry of the caster that listed it */
  #dismissSummon(markerId: string | undefined) {
    const { client, activeSceneId } = this.#options.session;
    if (!client || !activeSceneId || !markerId) return;
    deleteMarkersWithSpells(client, activeSceneId, [markerId]);
    this.#say('Dismissed');
  }

  /** Stage callback: the aimed spell was placed */
  onSpellAimed = ({ spellId, position, angle }: SpellAimed) => {
    const aim = this.spellAim;
    if (!aim || aim.spellId !== spellId) return;
    this.cancelSpellAim();
    this.#cast({
      spellId,
      variantId: aim.variantId,
      slotLevel: aim.slotLevel,
      placement: { position, angle },
      caster: this.#casterRow(aim.casterId)
    });
  };

  /** Stage callback: an area spell was placed, moved, or un-placed; Enter casts the last placement */
  onSpellAimPlaced = (placed: SpellAimPlaced) => {
    const aim = this.spellAim;
    if (!aim || (placed && aim.spellId !== placed.spellId)) return;
    this.spellAim = { ...aim, placement: placed && { position: placed.position, angle: placed.angle } };
  };

  /** Escape: a placed area goes back to following the pointer first, then the aim is cancelled */
  escapeSpellAim() {
    if (this.#isAimPlaced() && this.#options.getStage()?.aoeTemplates.unplaceSpellAim()) return;
    this.cancelSpellAim();
  }

  /**
   * A plain tap on the map with no tool or mode active (the page detects it, so drags and long presses never count):
   * a concentrating token takes the focus, the focused token again or empty map clears it
   */
  tapForFocus(markerId: string | null) {
    const snapshot = this.#options.session.activeScene;
    const existing = sceneRowIds(snapshot);
    this.focusedMarkerId = nextConcentrationFocus(this.focusedMarkerId, markerId, (id) =>
      isConcentrationActive(snapshot?.markers.find((marker) => marker.id === id)?.concentration, existing)
    );
  }

  /** What the focused token's concentration holds; empty once the token or its concentration is gone */
  get spellHighlight(): ConcentrationHighlight {
    const focused = this.focusedMarkerId;
    return concentrationHighlight(this.#options.session.activeScene, focused ? [focused] : []);
  }

  #cast(request: SpellCastRequest) {
    const { client, activeSceneId, presence, ruleset } = this.#options.session;
    if (!client || !activeSceneId) return;
    const stage = this.#options.getStage();
    const recent = castSpell(
      {
        client,
        presence,
        sceneId: activeSceneId,
        ruleset,
        templateVisibility: StageMode.Player,
        snapToGrid: (point) => stage?.markers.snapPosition(point) ?? point,
        notify: (message) => this.#say(message),
        newId: uuidv4
      },
      request
    );
    if (!recent) return;
    this.recentSpells = withRecentSpell(this.recentSpells, recent);
    writeRecentSpells(this.recentSpells);
  }

  get canUndo() {
    return this.#options.session.client?.canUndo ?? false;
  }

  get canRedo() {
    return this.#options.session.client?.canRedo ?? false;
  }

  undo() {
    this.#options.session.client?.undo();
  }

  redo() {
    this.#options.session.client?.redo();
  }

  clearActiveTool() {
    this.spellAim = null;
    this.activeLayer = MapLayerType.None;
    this.drawBrush = null;
    this.drawPanel = null;
    if (this.#drawIdleTimer) clearTimeout(this.#drawIdleTimer);
  }

  /** Fog: reset the tool 3s after the user stops painting. Restarts itself while a stroke is in progress. */
  resetToNoneAfterDelay() {
    if (this.#resetLayerTimer) clearTimeout(this.#resetLayerTimer);
    this.#resetLayerTimer = setTimeout(() => {
      this.#resetLayerTimer = null;
      if (this.#options.getStage()?.fogOfWar?.isDrawing()) return this.resetToNoneAfterDelay();
      if (this.activeLayer === MapLayerType.FogOfWar) this.clearActiveTool();
    }, FOG_IDLE_RESET_MS);
  }

  // ---------------------------------------------------------------------------
  // Drawing: every stroke is saved to the doc as one undo step
  // ---------------------------------------------------------------------------

  /** Turns the draw tool on with a brush; the panel opens at `anchor` (or stays where it is) */
  setDrawBrush(brush: DrawBrush, anchor?: { x: number; y: number }) {
    if (brush.kind !== 'erase') this.#lastPaintBrush = brush;
    // A fresh draft for a new brush (unsaved pixels never change color) or once the draft became a layer
    const draftTaken = this.#annotations().some((annotation) => annotation.id === this.#draftLayerId);
    if (draftTaken || JSON.stringify(brush) !== JSON.stringify(this.drawBrush)) this.#draftLayerId = uuidv4();
    this.drawBrush = brush;
    this.activeLayer = MapLayerType.Annotation;
    if (anchor || !this.drawPanel) this.drawPanel = anchor ?? { x: window.innerWidth / 2, y: window.innerHeight };
    this.#armDrawIdle();
  }

  /** Draw panel toggle: eraser ↔ the last color or effect */
  toggleEraser() {
    this.setDrawBrush(this.drawBrush?.kind === 'erase' ? this.#lastPaintBrush : { kind: 'erase' });
  }

  #armDrawIdle() {
    if (this.#drawIdleTimer) clearTimeout(this.#drawIdleTimer);
    this.#drawIdleTimer = setTimeout(() => {
      this.#drawIdleTimer = null;
      if (this.#options.getStage()?.annotations?.isDrawing()) return this.#armDrawIdle();
      if (this.isDrawActive) this.clearActiveTool();
    }, DRAW_IDLE_MS);
  }

  /** Removes every player drawing in the scene as one undo step */
  clearPlayerDrawings() {
    const ids = this.eraseLayerIds;
    if (ids.length === 0) return;
    this.#write((write, sceneId) => ids.forEach((id) => write.deleteAnnotation(sceneId, id)));
    if (this.drawBrush?.kind === 'erase') this.clearActiveTool();
    this.#say(
      `Cleared ${ids.length === 1 ? 'the player drawing' : `${ids.length} player drawings`}. Undo brings ${ids.length === 1 ? 'it' : 'them'} back`
    );
  }

  /** Several doc writes as one undo step, kept apart from the steps around it */
  #write(fn: (write: NonNullable<PlaySession['client']>['write'], sceneId: string) => void) {
    const { client, activeSceneId } = this.#options.session;
    if (!client || !activeSceneId) return;
    client.stopCapturing();
    fn(client.write, activeSceneId);
    client.stopCapturing();
  }

  #toggleCondition(markerIds: string[], condition: MarkerCondition) {
    this.#write((write, sceneId) => write.toggleMarkerCondition(sceneId, markerIds, condition, { playerView: true }));
  }

  /** The custom condition form's Add: a new status, put on the tokens the menu acted on */
  addCustomCondition(label: string, color: string) {
    const markerIds = this.conditionForm?.markerIds ?? [];
    const name = label.trim().slice(0, 24);
    this.conditionForm = null;
    if (!name || markerIds.length === 0) return;
    this.#toggleCondition(markerIds, { id: `custom:${uuidv4()}`, label: name, color });
    this.#say(`${name} added`);
  }

  #groupAction(itemId: string, members: GroupMember[]) {
    const rows = this.#rows();
    const [first] = members;
    const groupOfFirst = () => {
      const groupId = first ? groupIdOf(rows, first) : null;
      return groupId ? groupMembers(rows, groupId) : [];
    };
    switch (itemId) {
      case MENU_ID.group: {
        const plan = planGroupToggle(rows, members, uuidv4);
        if (plan.kind !== 'group') return;
        this.#write((write, sceneId) => write.setGroup(sceneId, plan.members, plan.groupId));
        this.selection = plan.members;
        this.#say(`Grouped ${plan.members.length} items. They now move together`);
        return;
      }
      case MENU_ID.ungroup: {
        const group = members.length > 1 ? expandToGroups(rows, members) : groupOfFirst();
        this.#write((write, sceneId) => write.setGroup(sceneId, group, null));
        this.#say(`Ungrouped ${group.length} items`);
        return;
      }
      case MENU_ID.leaveGroup:
        if (!first) return;
        this.#write((write, sceneId) => write.setGroup(sceneId, [first], null));
        this.#say('Left the group');
        return;
      case MENU_ID.groupWith:
        this.groupSelect = true;
        this.distanceMode = false;
        this.selection = expandToGroups(rows, members);
        this.#say('Tap what should move with it, then hold one and choose Group');
    }
  }

  selectMenuItem(itemId: string) {
    devLog('play', 'Menu item selected:', itemId);
    const target = this.menu?.target;
    const members = target && 'members' in target ? target.members : [];
    const markerIds = this.#menuIds('markers');
    const aoeIds = this.#menuIds('aoeTemplates');
    const valueOf = (prefix: string) => itemId.slice(prefix.length);

    const spell = parseSpellItemId(itemId);
    if (spell) {
      this.#startSpell(spell);
      return;
    }
    if (itemId === MENU_ID.endConcentration) {
      this.#endConcentration(markerIds[0]);
      return;
    }
    if (itemId === MENU_ID.dismissSpell) {
      this.#dismissSummon(markerIds[0]);
      return;
    }
    if (itemId.startsWith(MENU_ID.removeSpellEffect)) {
      this.#removeTemplates([valueOf(MENU_ID.removeSpellEffect)]);
      this.#say('Spell removed');
      return;
    }
    if (itemId.startsWith(MENU_ID.condition)) {
      const id = valueOf(MENU_ID.condition);
      const known = [...this.#customSuggestions(), ...this.#markerRows(markerIds).flatMap((m) => m.conditions ?? [])];
      const condition = resolveCondition({ id }).category === 'custom' ? known.find((c) => c.id === id) : { id };
      if (condition) this.#toggleCondition(markerIds, condition);
      return;
    }
    if (itemId.startsWith(MENU_ID.exhaustionLevel)) {
      const value = Number(valueOf(MENU_ID.exhaustionLevel));
      this.#write((write, sceneId) =>
        write.setMarkerConditionValue(sceneId, markerIds, 'exhaustion', value, { playerView: true })
      );
      return;
    }
    if (itemId.startsWith(MENU_ID.measureCone)) {
      this.activeLayer = MapLayerType.Measurement;
      this.measurement = { type: MeasurementType.Cone, coneAngle: Number(valueOf(MENU_ID.measureCone)) };
      return;
    }
    if (itemId.startsWith(MENU_ID.measureBeam)) {
      this.activeLayer = MapLayerType.Measurement;
      this.measurement = { type: MeasurementType.Beam, beamWidth: Number(valueOf(MENU_ID.measureBeam)) };
      return;
    }
    if (itemId.startsWith(MENU_ID.aoeShape)) {
      this.setAoeShape(valueOf(MENU_ID.aoeShape) as AoeShape);
      return;
    }
    // The panel opens where the menu was; switching brushes from the panel leaves it in place
    const anchor = this.menu && this.menu.target.kind !== 'draw' ? { x: this.menu.x, y: this.menu.y } : undefined;
    if (itemId.startsWith(MENU_ID.drawColor)) {
      const color = DRAW_COLORS.find(({ id }) => id === valueOf(MENU_ID.drawColor))?.color;
      if (color) this.setDrawBrush({ kind: 'color', color }, anchor);
      return;
    }
    if (itemId.startsWith(MENU_ID.drawEffect)) {
      this.setDrawBrush({ kind: 'effect', effect: Number(valueOf(MENU_ID.drawEffect)) as AnnotationEffect }, anchor);
      return;
    }
    if (itemId.startsWith(MENU_ID.aoeEffect)) {
      const effect = Number(valueOf(MENU_ID.aoeEffect)) as AoeEffect;
      this.#write(() =>
        aoeIds.forEach((id) => this.onAoeTemplateUpdated(id, { effect, color: AOE_EFFECT_DEFAULT_COLORS[effect] }))
      );
      return;
    }
    if (itemId.startsWith(MENU_ID.aoeOpacity)) {
      const opacity = Number(valueOf(MENU_ID.aoeOpacity));
      this.#write(() => aoeIds.forEach((id) => this.onAoeTemplateUpdated(id, { opacity })));
      return;
    }

    switch (itemId) {
      case MENU_ID.measureLine:
        this.activeLayer = MapLayerType.Measurement;
        this.measurement = { type: MeasurementType.Line };
        return;
      case MENU_ID.measureCircle:
        this.activeLayer = MapLayerType.Measurement;
        this.measurement = { type: MeasurementType.Circle };
        return;
      case MENU_ID.measureSquare:
        this.activeLayer = MapLayerType.Measurement;
        this.measurement = { type: MeasurementType.Square };
        return;
      case MENU_ID.distance:
        this.toggleDistanceMode();
        return;
      case MENU_ID.select:
        this.toggleGroupSelect();
        return;
      case MENU_ID.clearSelection:
        this.selection = [];
        return;
      case MENU_ID.undo:
        this.undo();
        return;
      case MENU_ID.redo:
        this.redo();
        return;
      case MENU_ID.fit:
        this.#options.onFit();
        return;
      case MENU_ID.drawEraser:
        this.setDrawBrush({ kind: 'erase' }, anchor);
        return;
      case MENU_ID.drawClear:
        this.clearPlayerDrawings();
        return;
      case MENU_ID.newCondition:
        if (this.menu) this.conditionForm = { x: this.menu.x, y: this.menu.y, markerIds };
        return;
      case MENU_ID.distanceFrom:
        this.groupSelect = false;
        this.distanceMode = true;
        this.selection = markerIds.slice(0, 1).map((id) => ({ collection: 'markers', id }));
        return;
      case MENU_ID.pin: {
        const marker = this.#markerRows(markerIds)[0];
        if (marker)
          this.#write((write, sceneId) =>
            write.setMarkerFields(sceneId, marker.id, { pinnedTooltip: !marker.pinnedTooltip })
          );
        return;
      }
      case MENU_ID.aoeDelete:
        this.#removeTemplates(aoeIds);
        return;
      default:
        this.#groupAction(itemId, members);
    }
  }

  /** Stage callback: a fog stroke changed — commit the RLE to the doc, debounced. */
  onFogUpdate = () => {
    this.resetToNoneAfterDelay();
    const sceneId = this.#options.session.activeSceneId;
    if (!sceneId) return;
    if (this.#pendingFogCommit) clearTimeout(this.#pendingFogCommit.timer);
    this.#pendingFogCommit = {
      sceneId,
      timer: setTimeout(() => {
        this.#pendingFogCommit = null;
        if (this.#options.session.activeSceneId === sceneId) this.#commitFog(sceneId);
      }, FOG_COMMIT_DEBOUNCE_MS)
    };
  };

  /**
   * Commit a pending fog stroke to the scene it was drawn on. Called when the
   * active scene changes, while the fog canvas still shows that scene's mask.
   */
  flushPendingFogCommit() {
    if (!this.#pendingFogCommit) return;
    const { timer, sceneId } = this.#pendingFogCommit;
    this.#pendingFogCommit = null;
    clearTimeout(timer);
    this.#commitFog(sceneId);
  }

  async #commitFog(sceneId: string) {
    const { session, getStage } = this.#options;
    const stage = getStage();
    if (!stage?.fogOfWar || !session.client) return;
    if (stage.fogOfWar.isDrawing()) return; // the next stroke end re-arms the commit

    try {
      const rle = await stage.fogOfWar.toRLE();
      if (rle && !stage.fogOfWar.isDrawing()) {
        session.client.write.setFogMask(sceneId, rle);
        devLog('play', `Committed fog mask (${rle.length} bytes) to doc`);
      }
    } catch (error) {
      devError('play', 'Failed to commit fog mask', error);
    }
  }

  /**
   * Stage callback, once per layer a stroke touched (an eraser stroke can touch several).
   * The masks are read back at once, in stroke order, and written together as one undo step.
   */
  onAnnotationUpdate = (layerId: string) => {
    this.#armDrawIdle();
    if (this.#strokeLayerIds.size === 0) queueMicrotask(() => this.#saveStroke());
    this.#strokeLayerIds.add(layerId);
  };

  #saveStroke() {
    const { session, getStage } = this.#options;
    const ids = [...this.#strokeLayerIds];
    this.#strokeLayerIds.clear();
    const stage = getStage();
    const sceneId = session.activeSceneId;
    const brush = this.drawBrush;
    const draftId = this.#draftLayerId;
    if (!stage?.annotations || !sceneId) return;

    // The readback snapshots each mask now; awaiting comes later
    const masks = Promise.all(ids.map((id) => stage.annotations.toRLE(id)));
    this.#strokeWrites = this.#strokeWrites.then(async () => {
      try {
        const rles = await masks;
        const { client } = session;
        if (!client) return;
        const annotations = session.activeSceneId === sceneId ? this.#annotations() : [];
        client.stopCapturing();
        ids.forEach((id, index) => {
          const rle = rles[index];
          if (rle.length === 0) return;
          if (annotations.some((annotation) => annotation.id === id) || session.activeSceneId !== sceneId) {
            client.write.setAnnotationMask(sceneId, id, rle);
          } else if (id === draftId && brush && brush.kind !== 'erase') {
            client.write.upsertAnnotation(sceneId, newPlayerLayer(id, sceneId, annotations, brush), rle);
          }
        });
        client.stopCapturing();
      } catch (error) {
        devError('play', 'Failed to save drawing', error);
      }
    });
  }

  destroy() {
    if (this.#noticeTimer) clearTimeout(this.#noticeTimer);
    if (this.#resetLayerTimer) clearTimeout(this.#resetLayerTimer);
    if (this.#drawIdleTimer) clearTimeout(this.#drawIdleTimer);
    if (this.#pendingFogCommit) clearTimeout(this.#pendingFogCommit.timer);
  }
}
