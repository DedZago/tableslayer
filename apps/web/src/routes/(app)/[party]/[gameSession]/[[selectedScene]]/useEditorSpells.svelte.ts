import type { MarkerRow } from '$lib/realtime';
import { readRecentSpells, withRecentSpell, writeRecentSpells, type RecentSpell } from '$lib/utils/recentSpells';
import {
  buildSpellAim,
  castSpell,
  NO_AIM_PICKS,
  placeAimArea,
  selfPlacement,
  spellAimProgress,
  spellAimPrompt,
  spellNeedsCaster,
  spellPickedMarkerIds,
  targetCastRequest,
  toggleAimPick,
  type CasterMarker,
  type SpellAimPicks,
  type SpellCastRequest
} from '$lib/utils/spellCasting';
import {
  EDITOR_NO_CASTER_HINT,
  parseSpellItemId,
  spellFxToPrewarm,
  spellMenuItem,
  type SpellMenuState
} from '$lib/utils/spellMenus';
import {
  MapLayerType,
  resolveSpell,
  StageMode,
  type RadialMenuItemProps,
  type SpellAimed,
  type SpellAreaTargets,
  type SpellTargeted,
  type StageExports,
  type StageProps
} from '@tableslayer/stage';
import { v4 as uuidv4 } from 'uuid';
import type { EditorSession } from './useEditorSession.svelte';

export interface EditorSpellsOptions {
  session: EditorSession;
  getStage: () => StageExports | undefined;
  getStageProps: () => StageProps;
  getSceneId: () => string;
  /** The caster is the single selected token */
  getSelectedMarkerIds: () => string[];
  getMarkerRow: (markerId: string) => MarkerRow | undefined;
  setActiveLayer: (layer: MapLayerType) => void;
  notify: (message: string) => void;
}

const isPickedAim = ({ mode }: { mode?: string }) => mode === 'target' || mode === 'area-targets';

/**
 * The GM's spell wheel: a radial menu opened from the toolbar button or the S key, aiming through
 * the AoE layer, and the same `castSpell` the TV uses.
 */
export class EditorSpells {
  /** Where the wheel is open, in client pixels */
  menu = $state<{ x: number; y: number } | null>(null);
  /** The spell being aimed, and the layer to go back to once it is placed or cancelled */
  aim = $state<
    | ({
        spellId: string;
        variantId?: string;
        casterId?: string;
        previousLayer: MapLayerType;
      } & SpellAimPicks)
    | null
  >(null);
  recentSpells = $state<RecentSpell[]>(readRecentSpells());

  #options: EditorSpellsOptions;

  constructor(options: EditorSpellsOptions) {
    this.#options = options;
  }

  #casterRow(markerId: string | undefined): CasterMarker | undefined {
    return markerId ? this.#options.getMarkerRow(markerId) : undefined;
  }

  #selectedCaster(): CasterMarker | undefined {
    const ids = this.#options.getSelectedMarkerIds();
    return ids.length === 1 ? this.#casterRow(ids[0]) : undefined;
  }

  get menuState(): SpellMenuState {
    return {
      ruleset: this.#options.session.ruleset,
      recent: this.recentSpells,
      hasCaster: !!this.#selectedCaster(),
      noCasterHint: EDITOR_NO_CASTER_HINT
    };
  }

  get items(): RadialMenuItemProps[] {
    return spellMenuItem(this.menuState).submenu ?? [];
  }

  get menuTitle(): string {
    return this.#selectedCaster() ? 'Cast from the selected token' : 'Cast spell';
  }

  /** Aiming stops when its caster is deleted */
  get casterGone(): boolean {
    const casterId = this.aim?.casterId;
    return !!casterId && !this.#casterRow(casterId);
  }

  open(point: { x: number; y: number }) {
    this.menu = point;
  }

  /** Opening a spell ring links just the programs its spells use, so none compiles mid-animation */
  onSubmenuOpen = (itemId: string) => {
    const { cast, token } = spellFxToPrewarm(itemId, {
      ruleset: this.#options.session.ruleset,
      recent: this.recentSpells
    });
    if (cast.length > 0 || token.length > 0) this.#options.getStage()?.spells.prewarm(cast, token);
  };

  close() {
    this.menu = null;
  }

  select(itemId: string) {
    const picked = parseSpellItemId(itemId);
    if (!picked) return;
    const spell = resolveSpell(picked.spellId, this.#options.session.ruleset);
    if (!spell) return;
    const caster = this.#selectedCaster();
    if (spellNeedsCaster(spell) && !caster) {
      this.#options.notify(EDITOR_NO_CASTER_HINT);
      return;
    }
    const aim = buildSpellAim(spell, picked.variantId, caster);
    if (!aim) {
      if (caster) this.#cast({ ...picked, placement: selfPlacement(caster), caster });
      return;
    }
    const stageProps = this.#options.getStageProps();
    if (!stageProps.aoeTemplates) return;
    this.aim = { ...picked, casterId: caster?.id, previousLayer: stageProps.activeLayer, ...NO_AIM_PICKS };
    stageProps.aoeTemplates.tool = { ...stageProps.aoeTemplates.tool, spell: aim };
    this.#options.setActiveLayer(MapLayerType.AoeTemplate);
    if (!isPickedAim(aim)) this.#options.notify(`${spellAimPrompt(spell.name, aim, { mouse: true })}. Esc cancels`);
  }

  /** The aim as the stage gets it, with the placed area and the picks so far */
  #syncAim() {
    const aim = this.aim;
    const spell = aim && resolveSpell(aim.spellId, this.#options.session.ruleset);
    const templates = this.#options.getStageProps().aoeTemplates;
    if (!aim || !spell || !templates) return;
    const settings = buildSpellAim(spell, aim.variantId, this.#casterRow(aim.casterId), spellAimProgress(spell, aim));
    if (settings) templates.tool = { ...templates.tool, spell: settings };
  }

  /** The tokens the spell would be cast on, as the cast bar counts them */
  get pickedCount(): number {
    const aim = this.aim;
    const spell = aim && resolveSpell(aim.spellId, this.#options.session.ruleset);
    return aim && spell ? spellPickedMarkerIds(spell, aim).length : 0;
  }

  /** Target and area-pick aim: what the cast bar says ("Click targets for Bless", "Slow: 2 of 4 creatures · drag to move") */
  get targetPrompt(): string | null {
    const aim = this.aim;
    const spell = aim && resolveSpell(aim.spellId, this.#options.session.ruleset);
    const settings = this.#options.getStageProps().aoeTemplates?.tool.spell;
    if (!aim || !spell || !settings || !isPickedAim(settings)) return null;
    return spellAimPrompt(spell.name, settings, { mouse: true, picked: this.pickedCount, inside: aim.inside.length });
  }

  /** Drops the aim and puts the tool layer back; a no-op when nothing is aimed */
  cancelAim() {
    const aim = this.aim;
    if (!aim) return;
    this.aim = null;
    const stageProps = this.#options.getStageProps();
    if (stageProps.aoeTemplates) {
      const { spell: _spell, ...tool } = stageProps.aoeTemplates.tool;
      stageProps.aoeTemplates.tool = tool;
    }
    if (stageProps.activeLayer === MapLayerType.AoeTemplate) this.#options.setActiveLayer(aim.previousLayer);
  }

  /** Stage callback: the aimed spell was placed */
  onSpellAimed = ({ spellId, position, angle }: SpellAimed) => {
    const aim = this.aim;
    if (!aim || aim.spellId !== spellId) return;
    this.cancelAim();
    this.#cast({
      spellId,
      variantId: aim.variantId,
      placement: { position, angle },
      caster: this.#casterRow(aim.casterId)
    });
  };

  /** Stage callback: a token was clicked while a targeted spell is aimed; it toggles in or out of the picks */
  onSpellTargeted = ({ spellId, markerId }: SpellTargeted) => {
    const aim = this.aim;
    if (!aim || aim.spellId !== spellId || !this.#options.getMarkerRow(markerId)) return;
    this.aim = toggleAimPick(aim, markerId);
    this.#syncAim();
  };

  /** Stage callback: an area-pick spell was placed or moved, or the tokens inside it changed */
  onSpellAreaTargets = ({ spellId, placement, markerIds }: SpellAreaTargets) => {
    const aim = this.aim;
    if (!aim || aim.spellId !== spellId) return;
    this.aim = placeAimArea(aim, { placement, markerIds });
    this.#syncAim();
  };

  /** Casts the targeted spell once on every picked token that still exists; Enter or the cast bar's button */
  confirmTargets() {
    const aim = this.aim;
    const spell = aim && resolveSpell(aim.spellId, this.#options.session.ruleset);
    if (!aim || !spell) return;
    const targets = spellPickedMarkerIds(spell, aim).flatMap((id) => this.#options.getMarkerRow(id) ?? []);
    if (targets.length === 0) return;
    this.cancelAim();
    this.#cast(targetCastRequest(aim, this.#casterRow(aim.casterId), targets));
  }

  #cast(request: SpellCastRequest) {
    const { session, getStage, getStageProps, getSceneId } = this.#options;
    const client = session.client;
    if (!client) return;
    const stage = getStage();
    const recent = castSpell(
      {
        client,
        presence: client.presence,
        sceneId: getSceneId(),
        ruleset: session.ruleset,
        templateVisibility: getStageProps().aoeTemplates?.tool.visibility ?? StageMode.Player,
        snapToGrid: (point) => stage?.markers.snapPosition(point) ?? point,
        notify: this.#options.notify,
        newId: uuidv4
      },
      request
    );
    if (!recent) return;
    this.recentSpells = withRecentSpell(this.recentSpells, recent);
    writeRecentSpells(this.recentSpells);
  }
}
