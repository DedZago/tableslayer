import { base64ToUint8, uint8ToBase64, type AnnotationRow, type MarkerRow } from '$lib/realtime';
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
import { devError, devLog } from '$lib/utils/debug';
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
  StageMode,
  type AnnotationLayerData,
  type AoeTemplate,
  type AoeToolSettings,
  type Marker,
  type MarkerCondition,
  type RadialMenuItemProps,
  type StageExports
} from '@tableslayer/stage';
import { v4 as uuidv4 } from 'uuid';
import {
  aoeMenu,
  DRAW_COLORS,
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
const DRAWING_IDLE_RESET_MS = 3000;
const PERSIST_BUTTON_HIDE_MS = 3000;
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
 * masks, persisted drawings, scene switches) or to awareness (temporary
 * drawings). There is no save pipeline here — the PartyKit server persists.
 */
export class PlayTools {
  // Local-only view state (never shared)
  activeLayer = $state<MapLayerType>(MapLayerType.None);
  annotationsActiveLayer = $state<string | null>(null);
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

  // Temporary drawing state
  currentTemporaryLayerId = $state<string | null>(null);
  tempLayerUrls = $state<Record<string, string>>({});

  // Persist button
  showPersistButton = $state(false);
  persistButtonPosition = $state({ x: 0, y: 0 });

  #options: PlayToolsOptions;
  #menuOpenedAt = 0;
  #noticeTimer: ReturnType<typeof setTimeout> | null = null;
  #persistButtonLayerId: string | null = null;
  #pendingPersistPosition: { x: number; y: number } | null = null;
  #persistButtonTimer: ReturnType<typeof setTimeout> | null = null;
  #resetLayerTimer: ReturnType<typeof setTimeout> | null = null;
  #pendingFogCommit: { timer: ReturnType<typeof setTimeout>; sceneId: string } | null = null;
  #expiryTicker: ReturnType<typeof setInterval>;
  #now = $state(Date.now());
  // Memoized base64 → bytes per layer so mask references stay stable across rebuilds
  #tempMaskCache = new Map<string, { b64: string; bytes: Uint8Array }>();

  constructor(options: PlayToolsOptions) {
    this.#options = options;

    // Tick once a second: expires temporary layers (display + own awareness state).
    // Only touch the reactive clock while temp layers exist, so an idle playfield
    // doesn't rebuild its render props every second.
    this.#expiryTicker = setInterval(() => {
      if (this.#temporaryLayers().length === 0) {
        if (this.#tempMaskCache.size > 0) this.#tempMaskCache.clear();
        return;
      }
      this.#now = Date.now();
      this.#options.session.presence?.cleanupExpiredTemporaryLayers();
      if (
        this.currentTemporaryLayerId &&
        !this.#temporaryLayers().some((layer) => layer.id === this.currentTemporaryLayerId)
      ) {
        this.currentTemporaryLayerId = null;
      }
    }, 1000);
  }

  #decodeTempMask(layerId: string, b64: string): Uint8Array {
    const cached = this.#tempMaskCache.get(layerId);
    if (cached && cached.b64 === b64) return cached.bytes;
    const bytes = base64ToUint8(b64);
    this.#tempMaskCache.set(layerId, { b64, bytes });
    return bytes;
  }

  #temporaryLayers() {
    return this.#options.session.presence?.temporaryLayers ?? [];
  }

  /** Temporary drawings (all clients) as annotation layers, expired ones dropped. */
  get tempAnnotationLayers(): AnnotationLayerData[] {
    const layers = this.#temporaryLayers();
    if (layers.length === 0) return []; // skip the ticking clock when idle
    const now = this.#now;
    return layers
      .filter((layer) => layer.expiresAt > now || layer.id === this.currentTemporaryLayerId)
      .map((layer) => ({
        id: layer.id,
        name: layer.name,
        color: layer.color,
        opacity: layer.opacity,
        url: this.tempLayerUrls[layer.id] ?? null,
        mask: layer.maskData ? this.#decodeTempMask(layer.id, layer.maskData) : null,
        visibility: StageMode.Player,
        effect:
          layer.effectType && layer.effectType !== AnnotationEffect.None
            ? getDefaultEffectProps(layer.effectType as AnnotationEffect)
            : undefined
      }));
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

  closeMenu() {
    this.menu = null;
  }

  #menuIds(collection: GroupMember['collection']): string[] {
    const target = this.menu?.target;
    if (!target || target.kind === 'general') return [];
    return target.members.filter((member) => member.collection === collection).map((member) => member.id);
  }

  get menuItems(): RadialMenuItemProps[] {
    const target = this.menu?.target;
    if (!target) return [];
    if (target.kind === 'general') {
      return generalMenu({
        canUndo: this.canUndo,
        canRedo: this.canRedo,
        canFit: this.#options.canFit(),
        groupSelect: this.groupSelect,
        distanceMode: this.distanceMode,
        selectionCount: this.selection.length
      });
    }
    const rows = this.#rows();
    const groups = groupItems(rows, target.members);
    if (target.kind === 'token') {
      return tokenMenu({
        markers: this.#markerRows(this.#menuIds('markers')),
        customSuggestions: this.#customSuggestions(),
        groupItems: groups,
        selectionCount: this.selection.length
      });
    }
    const aoeIds = this.#menuIds('aoeTemplates');
    const templates = (this.#options.session.activeScene?.aoeTemplates ?? []).filter((template) =>
      aoeIds.includes(template.id)
    );
    const shared = <T>(values: T[]) => (values.every((value) => value === values[0]) ? values[0] : undefined);
    return aoeMenu({
      count: templates.length,
      effect: shared(templates.map((template) => template.effect)),
      opacity: shared(templates.map((template) => template.opacity)),
      groupItems: groups
    });
  }

  /** Hub text when nothing is pressed: what the menu acts on */
  get menuTitle(): string {
    const target = this.menu?.target;
    if (!target || target.kind === 'general') return 'Map';
    if (target.members.length > 1) return `${target.members.length} selected`;
    if (target.kind === 'aoe') return 'Spell area';
    return this.#markerRows([target.markerId])[0]?.title || 'Token';
  }

  /** The menu closes when what it acts on is gone (deleted on the GM screen, or another scene) */
  get menuTargetGone(): boolean {
    const target = this.menu?.target;
    if (!target || target.kind === 'general') return false;
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
    this.annotationsActiveLayer = null;
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
    if (!marker) return;
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
    const sceneId = this.#options.session.activeSceneId;
    this.aoeSelectedIds = this.aoeSelectedIds.filter((selected) => selected !== id);
    if (sceneId) this.#options.session.client?.write.deleteAoeTemplate(sceneId, id);
  };

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
    [...this.aoeSelectedIds].forEach(this.onAoeTemplateDeleted);
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
    this.activeLayer = MapLayerType.None;
    this.annotationsActiveLayer = null;
    this.currentTemporaryLayerId = null;
  }

  /**
   * Reset the tool 3s after the user stops drawing, and surface the persist
   * button for the finished temporary drawing. Restarts itself while a stroke
   * is still in progress.
   */
  resetToNoneAfterDelay() {
    if (this.#resetLayerTimer) clearTimeout(this.#resetLayerTimer);
    this.#resetLayerTimer = setTimeout(() => {
      const stage = this.#options.getStage();
      if (stage?.annotations?.isDrawing() || stage?.fogOfWar?.isDrawing()) {
        this.#resetLayerTimer = null;
        this.resetToNoneAfterDelay();
        return;
      }

      if (this.#pendingPersistPosition && this.currentTemporaryLayerId) {
        if (this.#persistButtonTimer) clearTimeout(this.#persistButtonTimer);
        this.#persistButtonLayerId = this.currentTemporaryLayerId;
        this.persistButtonPosition = this.#pendingPersistPosition;
        this.showPersistButton = true;
        this.#pendingPersistPosition = null;
        this.#persistButtonTimer = setTimeout(() => this.dismissPersistButton(), PERSIST_BUTTON_HIDE_MS);
      }

      this.clearActiveTool();
      this.#resetLayerTimer = null;
    }, DRAWING_IDLE_RESET_MS);
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
    const members = target && target.kind !== 'general' ? target.members : [];
    const markerIds = this.#menuIds('markers');
    const aoeIds = this.#menuIds('aoeTemplates');
    const valueOf = (prefix: string) => itemId.slice(prefix.length);

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
    if (itemId.startsWith(MENU_ID.drawColor)) {
      const color = DRAW_COLORS.find(({ id }) => id === valueOf(MENU_ID.drawColor))?.color;
      if (color) this.#startTemporaryDrawing(color);
      return;
    }
    if (itemId.startsWith(MENU_ID.drawEffect)) {
      this.#startTemporaryDrawing('#ffffff', Number(valueOf(MENU_ID.drawEffect)) as AnnotationEffect);
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
        this.#write(() => aoeIds.forEach(this.onAoeTemplateDeleted));
        return;
      default:
        this.#groupAction(itemId, members);
    }
  }

  #startTemporaryDrawing(color: string, effectType?: AnnotationEffect) {
    const presence = this.#options.session.presence;
    if (!presence) return;

    // Continue on the existing layer when the same color is picked again
    const existing = this.currentTemporaryLayerId
      ? this.#temporaryLayers().find((l) => l.id === this.currentTemporaryLayerId && l.color === color && !effectType)
      : null;

    if (!existing) {
      this.currentTemporaryLayerId = uuidv4();
      presence.broadcastTemporaryLayer(
        presence.createTemporaryLayer(this.currentTemporaryLayerId, color, '', { effectType })
      );
    }

    this.annotationsActiveLayer = this.currentTemporaryLayerId;
    this.activeLayer = MapLayerType.Annotation;
    this.lineWidth = 0.25;
    this.resetToNoneAfterDelay();
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

  /** Stage callback: an annotation stroke finished. */
  onAnnotationUpdate = (layerId: string, getBlob: () => Promise<Blob>, endPosition?: { x: number; y: number }) => {
    this.resetToNoneAfterDelay();

    getBlob().then(async (resolved) => {
      this.tempLayerUrls[layerId] = URL.createObjectURL(resolved);

      const presence = this.#options.session.presence;
      const stage = this.#options.getStage();
      const tempLayerId = this.currentTemporaryLayerId;
      if (!presence || !stage?.annotations || !tempLayerId) return;

      try {
        const current = this.#temporaryLayers().find((l) => l.id === tempLayerId);
        const rle = await stage.annotations.toRLE();
        if (rle && rle.length > 0) {
          presence.broadcastTemporaryLayer(
            presence.createTemporaryLayer(tempLayerId, current?.color ?? '#ffffff', uint8ToBase64(rle), {
              effectType: current?.effectType
            })
          );
          if (endPosition) this.#pendingPersistPosition = endPosition;
        }
      } catch (error) {
        devError('play', 'Failed to broadcast temporary layer', error);
      }
    });
  };

  /** Persist the finished temporary drawing as a permanent annotation in the doc. */
  async persistCurrentDrawing() {
    const layerId = this.#persistButtonLayerId;
    const { session } = this.#options;
    const sceneId = session.activeSceneId;
    const snapshot = session.activeScene;
    this.dismissPersistButton();

    if (!layerId || !sceneId || !snapshot || !session.client) return;
    const tempLayer = this.#temporaryLayers().find((l) => l.id === layerId);
    if (!tempLayer?.maskData) return;

    try {
      const mask = base64ToUint8(tempLayer.maskData);
      const minOrder = Math.min(1, ...snapshot.annotations.map((a) => a.order));
      const annotation: AnnotationRow = {
        id: uuidv4(),
        sceneId,
        name: tempLayer.effectType ? 'Player effect' : 'Player drawing',
        opacity: 1,
        color: tempLayer.color,
        url: null,
        visibility: StageMode.Player,
        order: minOrder - 1,
        effectType: tempLayer.effectType ?? null
      };

      // The mask rides into the doc with the row and reaches the new layer
      // component as a declarative prop — nothing to coordinate here.
      session.client.write.upsertAnnotation(sceneId, annotation, mask);

      session.presence?.removeTemporaryLayer(layerId);
      this.#tempMaskCache.delete(layerId);
      if (this.currentTemporaryLayerId === layerId) this.currentTemporaryLayerId = null;
      devLog('play', 'Persisted drawing as annotation', annotation.id);
    } catch (error) {
      devError('play', 'Failed to persist drawing', error);
    }
  }

  dismissPersistButton() {
    if (this.#persistButtonTimer) {
      clearTimeout(this.#persistButtonTimer);
      this.#persistButtonTimer = null;
    }
    this.showPersistButton = false;
    this.#persistButtonLayerId = null;
  }

  #deleteAllDrawings() {
    const { session } = this.#options;
    const sceneId = session.activeSceneId;
    const snapshot = session.activeScene;
    if (!sceneId || !snapshot || !session.client) return;

    for (const annotation of snapshot.annotations) {
      session.client.write.deleteAnnotation(sceneId, annotation.id);
    }
    for (const layer of this.#temporaryLayers()) {
      session.presence?.removeTemporaryLayer(layer.id);
    }
    this.tempLayerUrls = {};
    this.#tempMaskCache.clear();
    this.clearActiveTool();
    devLog('play', 'Deleted all drawings for scene', sceneId);
  }

  destroy() {
    clearInterval(this.#expiryTicker);
    if (this.#noticeTimer) clearTimeout(this.#noticeTimer);
    if (this.#resetLayerTimer) clearTimeout(this.#resetLayerTimer);
    if (this.#persistButtonTimer) clearTimeout(this.#persistButtonTimer);
    if (this.#pendingFogCommit) clearTimeout(this.#pendingFogCommit.timer);
  }
}
