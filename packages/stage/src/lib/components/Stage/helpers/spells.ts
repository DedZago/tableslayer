import { AOE_EFFECT_DEFAULT_COLORS, AoeEffect, AoeShape } from '../components/AoeTemplateLayer/types';
import { byRuleset, RULESETS, type Ruleset, type RulesetSpec } from './rulesets';

export type SpellCategory =
  | 'blast'
  | 'zone-control'
  | 'zone-obscure'
  | 'zone-magic'
  | 'aura'
  | 'summon'
  | 'target-hold'
  | 'target-curse'
  | 'target-boon'
  | 'target-enhance';
export type SpellCastFx = 'burst' | 'cone' | 'bolt' | 'wave' | 'zone' | 'aura' | 'summon' | 'rain' | 'beam';

/** Ambient effects a spell leaves on a token; persisted through the spell id, so ids are append-only */
export type TokenFx =
  | 'orbit'
  | 'glow'
  | 'shimmer'
  | 'ghosts'
  | 'ward'
  | 'chains'
  | 'motes'
  | 'haze'
  | 'sigil'
  | 'rift'
  | 'charm'
  | 'clock'
  | 'streaks'
  | 'halo'
  | 'veil'
  | 'wind'
  | 'blind'
  | 'calm'
  | 'heal'
  | 'trance'
  | 'outline'
  | 'dread'
  | 'slumber';

/** Every ring the TokenEffectLayer draws: the spell effects plus the caster's concentration outline */
export type TokenEffectKind = TokenFx | 'concentration';

/** What a caster is concentrating on; the rows listed end with it */
export interface MarkerConcentration {
  spellId: string;
  /** Unix seconds */
  startedAt: number;
  templateIds: string[];
  markerIds: string[];
}

/** An instant spell's area holds full strength through the cast, then fades out over this long */
export const INSTANT_FADE_MS = 3000;

/** Unix seconds (rounded up) at which an instant spell's template is gone: the cast, then the fade */
export const instantTemplateExpiresAt = (castStartMs: number, castDurationMs: number): number =>
  Math.ceil((castStartMs + castDurationMs + INSTANT_FADE_MS) / 1000);

/** Feet, like AoeTemplate: radius | side | length */
export interface SpellArea {
  shape: AoeShape;
  size: number;
  width?: number;
}

export interface SpellSummonVariant {
  id: string;
  label: string;
  /** Built-in art id */
  icon: string;
  /** Token size when it differs from the summon's */
  size?: 1 | 2 | 3;
}

export interface SpellSummon {
  variants: SpellSummonVariant[];
  size: 1 | 2 | 3;
  count?: number;
}

export interface SpellCastSpec {
  fx: SpellCastFx;
  durationMs: number;
  palette: [string, string];
  projectile?: boolean;
  variant?: number;
}

export interface SpellPreset {
  /** 0 = cantrip */
  level: number;
  /** Absent for pure summons */
  area?: SpellArea;
  /** Effect of the lingering template */
  effect: AoeEffect;
  color: string;
  /** Cones, lines, cubes and emanations start at the caster */
  origin: 'caster' | 'point';
  /** Feet; 0 = self */
  rangeFt: number;
  /** False = instant: the template holds through the cast, fades over INSTANT_FADE_MS, then goes */
  lingers: boolean;
  /** Follows a token: the caster, or the summoned token when the spell also summons one */
  anchored: boolean;
  concentration: boolean;
  /** Radial hub text, e.g. "20 ft sphere · 8d6 fire · Dex save" */
  hint: string;
  cast: SpellCastSpec;
  summon?: SpellSummon;
  /** Ambient effect on the token the spell is bound to (the target, or the caster) */
  tokenFx?: TokenFx;
  /** Picks a look within the effect (sigil: 0 hex, 1 crosshair; charm: 0 hearts, 1 glyph) */
  tokenFxVariant?: number;
  /** Feet; the reach of an orbit or a glow when the spell has no area of its own */
  tokenFxRadiusFt?: number;
  /** Aimed at tokens rather than a point or direction */
  aim?: 'target';
  /**
   * Place `area`, then pick the creatures inside it: `choose` starts with nobody picked, `saves` with everyone
   * inside picked (the GM unticks those who save). No area row is written, only an effect on each creature.
   */
  areaPick?: 'choose' | 'saves';
  /** Template fill opacity, default SPELL_TEMPLATE_OPACITY of the casting app */
  templateOpacity?: number;
}

export interface SpellDefinition {
  /** Persisted in aoe_template.spell_id: never rename */
  id: string;
  /** Sentence case UI label */
  name: string;
  /** One plain line for the area's label card: no numbers, no rules text */
  description: string;
  category: SpellCategory;
  /** Rulesets that list the spell */
  rulesets: readonly Ruleset[];
  preset: RulesetSpec<SpellPreset>;
}

export interface ResolvedSpell extends SpellDefinition {
  resolved: SpellPreset;
}

export interface SpellCategoryDefinition {
  id: SpellCategory;
  label: string;
  hint: string;
  /** Categories sharing a group open from one item, so the spell ring stays within the radial menu's limit */
  group?: string;
}

export const SPELL_CATEGORIES: SpellCategoryDefinition[] = [
  { id: 'blast', label: 'Blasts', hint: 'Instant bursts, cones and lines' },
  { id: 'zone-control', label: 'Control zones', hint: 'Areas that hinder or hurt movement' },
  { id: 'zone-obscure', label: 'Obscuring zones', hint: 'Clouds, darkness and silence' },
  { id: 'zone-magic', label: 'Magic zones', hint: 'Lights, patterns and slumber' },
  { id: 'aura', label: 'Auras', hint: 'Effects that follow the caster' },
  { id: 'summon', label: 'Summons', hint: 'Conjured weapons, steeds and familiars' },
  { id: 'target-hold', label: 'Holds and charms', hint: 'Pin down, slow or sway a creature', group: 'target' },
  { id: 'target-curse', label: 'Curses and marks', hint: 'Hex, mark or blind a creature', group: 'target' },
  { id: 'target-boon', label: 'Blessings and wards', hint: 'Boons and protections on a creature', group: 'target' },
  { id: 'target-enhance', label: 'Enhancements', hint: 'Speed, flight and invisibility', group: 'target' }
];

export const SPELL_CATEGORY_GROUPS: { id: string; label: string; hint: string }[] = [
  { id: 'target', label: 'Targeted', hint: 'Pick the creatures to affect' }
];

const BOTH: readonly Ruleset[] = RULESETS;
const ONLY_2014: readonly Ruleset[] = ['dnd5e-2014'];

const circle = (size: number): SpellArea => ({ shape: AoeShape.Circle, size });
const cube = (size: number): SpellArea => ({ shape: AoeShape.Square, size });
const cone = (size: number): SpellArea => ({ shape: AoeShape.Cone, size });
const line = (size: number, width: number): SpellArea => ({ shape: AoeShape.Line, size, width });

const effectColor = (effect: AoeEffect) => AOE_EFFECT_DEFAULT_COLORS[effect];

const blast = (
  level: number,
  area: SpellArea,
  effect: AoeEffect,
  rangeFt: number,
  hint: string,
  cast: SpellCastSpec
): SpellPreset => ({
  level,
  area,
  effect,
  color: effectColor(effect),
  origin: rangeFt === 0 ? 'caster' : 'point',
  rangeFt,
  lingers: false,
  anchored: false,
  concentration: false,
  hint,
  cast
});

const zone = (
  level: number,
  area: SpellArea,
  effect: AoeEffect,
  rangeFt: number,
  hint: string,
  cast: Omit<SpellCastSpec, 'fx'>
): SpellPreset => ({
  level,
  area,
  effect,
  color: effectColor(effect),
  origin: 'point',
  rangeFt,
  lingers: true,
  anchored: false,
  concentration: true,
  hint,
  cast: { fx: 'zone', ...cast }
});

const summon = (
  level: number,
  rangeFt: number,
  hint: string,
  summoned: SpellSummon,
  palette: [string, string],
  castVariant?: number
): SpellPreset => ({
  level,
  effect: AoeEffect.None,
  color: palette[0],
  origin: 'point',
  rangeFt,
  lingers: true,
  anchored: false,
  concentration: false,
  hint,
  cast: { fx: 'summon', durationMs: 2000, palette, variant: castVariant },
  summon: summoned
});

const targeted = (
  level: number,
  rangeFt: number,
  hint: string,
  tokenFx: TokenFx,
  color: string,
  palette: [string, string],
  { castVariant, ...extras }: Partial<SpellPreset> & { castVariant?: number } = {}
): SpellPreset => ({
  level,
  effect: AoeEffect.None,
  color,
  origin: 'point',
  rangeFt,
  lingers: true,
  anchored: true,
  concentration: true,
  hint,
  cast: { fx: 'beam', durationMs: 1400, palette, variant: castVariant },
  tokenFx,
  aim: 'target',
  ...extras
});

const areaPicked = (
  level: number,
  area: SpellArea,
  rangeFt: number,
  hint: string,
  tokenFx: TokenFx,
  color: string,
  areaPick: 'choose' | 'saves',
  cast: SpellCastSpec,
  extras: Partial<SpellPreset> = {}
): SpellPreset =>
  targeted(level, rangeFt, hint, tokenFx, color, cast.palette, {
    area,
    areaPick,
    aim: undefined,
    cast,
    ...extras
  });

const variants = (...entries: [id: string, label: string, size?: 1 | 2 | 3][]): SpellSummonVariant[] =>
  entries.map(([id, label, size]) => ({ id, label, icon: id, ...(size && { size }) }));

const definitions: SpellDefinition[] = [
  {
    id: 'burning-hands',
    name: 'Burning hands',
    description: "Fan of flame from the caster's fingertips",
    category: 'blast',
    rulesets: BOTH,
    preset: {
      base: blast(1, cone(15), AoeEffect.Fire, 0, '15 ft cone · 3d6 fire · Dex save', {
        fx: 'cone',
        durationMs: 1200,
        palette: ['#ff6a1a', '#ffd166']
      })
    }
  },
  {
    id: 'thunderwave',
    name: 'Thunderwave',
    description: 'Booming wave that shoves creatures away',
    category: 'blast',
    rulesets: BOTH,
    preset: {
      base: blast(1, cube(15), AoeEffect.Thunder, 0, '15 ft cube · 2d8 thunder · Con save', {
        fx: 'wave',
        durationMs: 1300,
        palette: ['#b8c4e8', '#ffffff']
      }),
      'dnd5e-2024': { area: circle(15), hint: '15 ft emanation · 2d8 thunder · Con save' }
    }
  },
  {
    id: 'shatter',
    name: 'Shatter',
    description: 'Ringing crack of sound that splits whatever it touches',
    category: 'blast',
    rulesets: BOTH,
    preset: {
      base: blast(2, circle(10), AoeEffect.Thunder, 60, '10 ft sphere · 3d8 thunder · Con save', {
        fx: 'burst',
        durationMs: 1400,
        palette: ['#9db4ff', '#ffffff']
      })
    }
  },
  {
    id: 'fireball',
    name: 'Fireball',
    description: 'Bright bead that bursts into roaring flame',
    category: 'blast',
    rulesets: BOTH,
    preset: {
      base: blast(3, circle(20), AoeEffect.Fire, 150, '20 ft sphere · 8d6 fire · Dex save', {
        fx: 'burst',
        durationMs: 2200,
        palette: ['#ff6a1a', '#ffd166'],
        projectile: true
      })
    }
  },
  {
    id: 'lightning-bolt',
    name: 'Lightning bolt',
    description: 'Straight line of crackling lightning',
    category: 'blast',
    rulesets: BOTH,
    preset: {
      base: blast(3, line(100, 5), AoeEffect.Lightning, 0, '100 × 5 ft line · 8d6 lightning · Dex save', {
        fx: 'bolt',
        durationMs: 1200,
        palette: ['#5aa8ff', '#e6f1ff']
      })
    }
  },
  {
    id: 'cone-of-cold',
    name: 'Cone of cold',
    description: 'Blast of freezing air that frosts everything in its path',
    category: 'blast',
    rulesets: BOTH,
    preset: {
      base: blast(5, cone(60), AoeEffect.Frost, 0, '60 ft cone · 8d8 cold · Con save', {
        fx: 'cone',
        durationMs: 1500,
        palette: ['#9ee8ff', '#ffffff'],
        variant: 2
      })
    }
  },
  {
    id: 'ice-knife',
    name: 'Ice knife',
    description: 'Shard of ice that shatters into frost on impact',
    category: 'blast',
    rulesets: BOTH,
    preset: {
      base: blast(1, circle(5), AoeEffect.Frost, 60, '5 ft burst · 2d6 cold · Dex save', {
        fx: 'burst',
        durationMs: 1500,
        palette: ['#9ee8ff', '#ffffff'],
        projectile: true,
        variant: 1
      })
    }
  },
  {
    id: 'color-spray',
    name: 'Color spray',
    description: 'Dazzling fan of bright colours that blinds the weak',
    category: 'blast',
    rulesets: BOTH,
    preset: {
      base: blast(1, cone(15), AoeEffect.Radiant, 0, '15 ft cone · Blinds 6d10 HP of creatures', {
        fx: 'cone',
        durationMs: 1300,
        palette: ['#ff4d6d', '#4dd2ff'],
        variant: 1
      }),
      'dnd5e-2024': { hint: '15 ft cone · Blinded · Con save' }
    }
  },
  {
    id: 'ice-storm',
    name: 'Ice storm',
    description: 'Hail and frozen rain that batter and chill the ground',
    category: 'zone-control',
    rulesets: BOTH,
    preset: {
      base: blast(4, circle(20), AoeEffect.Frost, 300, '20 ft radius · 2d8 bludgeoning, 4d6 cold · Dex save', {
        fx: 'rain',
        durationMs: 2200,
        palette: ['#cfe6f2', '#9ee8ff']
      })
    }
  },
  {
    id: 'web',
    name: 'Web',
    description: 'Sticky strands that hold creatures in place',
    category: 'zone-control',
    rulesets: BOTH,
    preset: {
      base: zone(2, cube(20), AoeEffect.Web, 60, '20 ft cube · Restrains · Dex save', {
        durationMs: 1600,
        variant: 4,
        palette: ['#e8e8e8', '#ffffff']
      })
    }
  },
  {
    id: 'grease',
    name: 'Grease',
    description: 'Slick patch that makes creatures slip and fall',
    category: 'zone-control',
    rulesets: BOTH,
    preset: {
      base: {
        ...zone(1, cube(10), AoeEffect.Grease, 60, '10 ft square · Knocks prone · Dex save', {
          durationMs: 1500,
          palette: ['#6b7280', '#c49b2a']
        }),
        concentration: false
      }
    }
  },
  {
    id: 'entangle',
    name: 'Entangle',
    description: 'Grasping weeds and vines that restrain those inside',
    category: 'zone-control',
    rulesets: BOTH,
    preset: {
      base: zone(1, cube(20), AoeEffect.Entangle, 90, '20 ft square · Restrains · Str save', {
        durationMs: 1700,
        palette: ['#4d9a3a', '#a3e635']
      })
    }
  },
  {
    id: 'spike-growth',
    name: 'Spike growth',
    description: 'Hidden thorns that tear at anyone crossing',
    category: 'zone-control',
    rulesets: BOTH,
    preset: {
      base: zone(2, circle(20), AoeEffect.SpikeGrowth, 150, '20 ft radius · 2d4 piercing per 5 ft moved', {
        durationMs: 1700,
        palette: ['#9a8450', '#e7d8a0']
      })
    }
  },
  {
    id: 'sleet-storm',
    name: 'Sleet storm',
    description: 'Freezing rain that makes the ground slick and douses fires',
    category: 'zone-control',
    rulesets: BOTH,
    preset: {
      base: zone(3, circle(40), AoeEffect.SleetStorm, 150, '40 ft radius · Difficult terrain, prone · Dex save', {
        durationMs: 2000,
        palette: ['#cfe6f2', '#ffffff'],
        variant: 3
      })
    }
  },
  {
    id: 'fog-cloud',
    name: 'Fog cloud',
    description: 'Thick fog that hides everything inside',
    category: 'zone-obscure',
    rulesets: BOTH,
    preset: {
      base: zone(1, circle(20), AoeEffect.FogCloud, 120, '20 ft sphere · Heavily obscured', {
        durationMs: 1800,
        variant: 5,
        palette: ['#d4d8de', '#ffffff']
      })
    }
  },
  {
    id: 'darkness',
    name: 'Darkness',
    description: 'Magical gloom that no light can pierce',
    category: 'zone-obscure',
    rulesets: BOTH,
    preset: {
      base: zone(2, circle(15), AoeEffect.Darkness, 60, '15 ft sphere · Magical darkness', {
        durationMs: 1800,
        variant: 6,
        palette: ['#4b2a6b', '#150a24']
      })
    }
  },
  {
    id: 'silence',
    name: 'Silence',
    description: 'Quiet zone where no sound can be made',
    category: 'zone-obscure',
    rulesets: BOTH,
    preset: {
      base: zone(2, circle(20), AoeEffect.Silence, 120, '20 ft sphere · No sound, no verbal spells', {
        durationMs: 1700,
        palette: ['#6b7a99', '#cbd5e1']
      })
    }
  },
  {
    id: 'stinking-cloud',
    name: 'Stinking cloud',
    description: 'Foul green gas that sickens those who breathe it',
    category: 'zone-obscure',
    rulesets: ONLY_2014,
    preset: {
      base: zone(3, circle(20), AoeEffect.PoisonGas, 90, '20 ft sphere · Poisoned · Con save', {
        durationMs: 1800,
        variant: 5,
        palette: ['#7fd13b', '#d9f99d']
      })
    }
  },
  {
    id: 'hunger-of-hadar',
    name: 'Hunger of Hadar',
    description: 'Void of cold darkness that gnaws at anything inside',
    category: 'zone-obscure',
    rulesets: BOTH,
    preset: {
      base: zone(3, circle(20), AoeEffect.HungerOfHadar, 150, '20 ft sphere · Cold and acid · Dex save', {
        durationMs: 2000,
        variant: 6,
        palette: ['#3a2a6b', '#7dd3fc']
      })
    }
  },
  {
    id: 'moonbeam',
    name: 'Moonbeam',
    description: 'Silvery beam of moonlight that burns those inside',
    category: 'zone-magic',
    rulesets: BOTH,
    preset: {
      base: zone(2, circle(5), AoeEffect.Moonbeam, 120, '5 ft radius · 2d10 radiant · Con save', {
        durationMs: 1800,
        palette: ['#c7d2fe', '#ffffff'],
        variant: 2
      })
    }
  },
  {
    id: 'cloud-of-daggers',
    name: 'Cloud of daggers',
    description: 'Whirling blades that slice anything within',
    category: 'zone-magic',
    rulesets: BOTH,
    preset: {
      base: zone(2, cube(5), AoeEffect.CloudOfDaggers, 60, '5 ft cube · 4d4 slashing', {
        durationMs: 1500,
        palette: ['#cbd5e1', '#ffffff']
      })
    }
  },
  {
    id: 'hypnotic-pattern',
    name: 'Hypnotic pattern',
    description: 'Twisting colours that leave viewers entranced',
    category: 'zone-magic',
    rulesets: BOTH,
    preset: {
      base: areaPicked(
        3,
        cube(30),
        120,
        '30 ft cube · Incapacitated · Wis save',
        'trance',
        effectColor(AoeEffect.HypnoticPattern),
        'saves',
        { fx: 'zone', durationMs: 1800, palette: ['#d56bff', '#5eead4'] },
        { effect: AoeEffect.HypnoticPattern }
      ),
      'dnd5e-2024': { hint: '30 ft cube · Charmed, incapacitated, speed 0 · Wis save' }
    }
  },
  {
    id: 'faerie-fire',
    name: 'Faerie fire',
    description: 'Coloured glow that outlines creatures and reveals them',
    category: 'zone-magic',
    rulesets: BOTH,
    preset: {
      base: areaPicked(
        1,
        cube(20),
        60,
        '20 ft cube · Outlined, advantage to hit · Dex save',
        'outline',
        effectColor(AoeEffect.FaerieFire),
        'saves',
        { fx: 'zone', durationMs: 1700, palette: ['#7dffb2', '#f0abfc'] },
        { effect: AoeEffect.FaerieFire }
      )
    }
  },
  {
    id: 'sleep',
    name: 'Sleep',
    description: 'Drifting magical sand that puts creatures to sleep',
    category: 'zone-magic',
    rulesets: BOTH,
    preset: {
      base: areaPicked(
        1,
        circle(20),
        90,
        '20 ft sphere · Sleeps 5d8 HP of creatures',
        'slumber',
        effectColor(AoeEffect.Sleep),
        'saves',
        { fx: 'zone', durationMs: 2000, palette: ['#6d7bd9', '#e0e7ff'], variant: 1 },
        { effect: AoeEffect.Sleep, concentration: false }
      ),
      'dnd5e-2024': {
        area: circle(5),
        rangeFt: 60,
        concentration: true,
        hint: '5 ft sphere · Incapacitated, then unconscious · Wis save'
      }
    }
  },
  {
    id: 'spirit-guardians',
    name: 'Spirit guardians',
    description: 'Spirits that circle the caster and punish nearby foes',
    category: 'aura',
    rulesets: BOTH,
    preset: {
      base: {
        level: 3,
        area: circle(15),
        effect: AoeEffect.SpiritGuardians,
        color: effectColor(AoeEffect.SpiritGuardians),
        origin: 'caster',
        rangeFt: 0,
        lingers: true,
        anchored: true,
        concentration: true,
        hint: '15 ft radius · 3d8 radiant or necrotic · Wis save',
        cast: { fx: 'aura', durationMs: 2000, palette: ['#cfe9ff', '#fde68a'] },
        tokenFx: 'orbit',
        templateOpacity: 0.22
      },
      'dnd5e-2024': { hint: '15 ft emanation · 3d8 radiant or necrotic · Wis save' }
    }
  },
  {
    id: 'flaming-sphere',
    name: 'Flaming sphere',
    description: 'Rolling ball of fire that follows its master',
    category: 'aura',
    rulesets: BOTH,
    preset: {
      base: {
        ...summon(
          2,
          60,
          '5 ft radius · 2d6 fire · Dex save',
          { variants: variants(['fire-sphere', 'Fire sphere']), size: 1 },
          ['#ff6a1a', '#ffd166']
        ),
        area: circle(5),
        effect: AoeEffect.Fire,
        anchored: true,
        concentration: true
      }
    }
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Steady glow that lights up an object',
    category: 'target-boon',
    rulesets: BOTH,
    preset: {
      base: targeted(
        0,
        5,
        'Touch · 20 ft bright, 20 ft dim light · 1 hour',
        'glow',
        '#ffe9a8',
        ['#ffe9a8', '#ffffff'],
        {
          concentration: false,
          tokenFxRadiusFt: 20,
          cast: { fx: 'beam', durationMs: 1200, palette: ['#ffe9a8', '#ffffff'] }
        }
      )
    }
  },
  {
    id: 'blur',
    name: 'Blur',
    description: 'Shimmering haze that makes the caster hard to hit',
    category: 'aura',
    rulesets: BOTH,
    preset: {
      base: {
        ...targeted(2, 0, 'Self · Attackers have disadvantage · 1 min', 'shimmer', '#c4b5fd', ['#c4b5fd', '#e0e7ff']),
        origin: 'caster',
        aim: undefined,
        cast: { fx: 'aura', durationMs: 1600, palette: ['#c4b5fd', '#e0e7ff'] }
      }
    }
  },
  {
    id: 'mirror-image',
    name: 'Mirror image',
    description: 'Illusory duplicates that confuse attackers',
    category: 'aura',
    rulesets: BOTH,
    preset: {
      base: {
        ...targeted(2, 0, 'Self · Three illusory duplicates · 1 min', 'ghosts', '#a5f3fc', ['#a5f3fc', '#ffffff']),
        origin: 'caster',
        aim: undefined,
        concentration: false,
        cast: { fx: 'aura', durationMs: 1600, palette: ['#a5f3fc', '#ffffff'] }
      }
    }
  },
  {
    id: 'protection-from-evil-and-good',
    name: 'Protection from evil and good',
    description: 'Faint ward that turns aside otherworldly foes',
    category: 'target-boon',
    rulesets: BOTH,
    preset: {
      base: targeted(
        1,
        5,
        'Touch · Disadvantage for aberrations, celestials, elementals, fey, fiends and undead',
        'ward',
        '#fde68a',
        ['#fde68a', '#ffffff']
      ),
      'dnd5e-2024': {
        hint: 'Touch · Disadvantage for aberrations, celestials, elementals, fey, fiends and undead · 10 min'
      }
    }
  },
  {
    id: 'bless',
    name: 'Bless',
    description: 'Golden light that favours an ally',
    category: 'target-boon',
    rulesets: BOTH,
    preset: {
      base: targeted(1, 30, 'Up to 3 creatures · +1d4 to attacks and saves · 1 min', 'motes', '#ffd166', [
        '#ffd166',
        '#fff7d6'
      ])
    }
  },
  {
    id: 'bane',
    name: 'Bane',
    description: 'Dark curse that weakens a foe',
    category: 'target-curse',
    rulesets: BOTH,
    preset: {
      base: targeted(
        1,
        30,
        'Up to 3 creatures · -1d4 to attacks and saves · Cha save',
        'haze',
        '#7c3aed',
        ['#7c3aed', '#1e1b4b'],
        { castVariant: 2 }
      )
    }
  },
  {
    id: 'shield-of-faith',
    name: 'Shield of faith',
    description: 'Shimmering field that turns blows aside',
    category: 'target-boon',
    rulesets: BOTH,
    preset: {
      base: targeted(1, 60, 'One creature · +2 AC · 10 min', 'ward', '#7dd3fc', ['#7dd3fc', '#ffffff'])
    }
  },
  {
    id: 'hold-person',
    name: 'Hold person',
    description: 'Spectral chains that bind a creature in place',
    category: 'target-hold',
    rulesets: BOTH,
    preset: {
      base: targeted(
        2,
        60,
        'One humanoid · Paralyzed · Wis save · 1 min',
        'chains',
        '#aab4c8',
        ['#aab4c8', '#ffffff'],
        { castVariant: 1 }
      )
    }
  },
  {
    id: 'hold-monster',
    name: 'Hold monster',
    description: 'Heavy chains that pin down a creature of any kind',
    category: 'target-hold',
    rulesets: BOTH,
    preset: {
      base: targeted(
        5,
        90,
        'One creature (not undead) · Paralyzed · Wis save · 1 min',
        'chains',
        '#aab4c8',
        ['#aab4c8', '#ffffff'],
        { tokenFxVariant: 1, castVariant: 1 }
      )
    }
  },
  {
    id: 'hex',
    name: 'Hex',
    description: 'Cursed mark that follows a foe and drains their strength',
    category: 'target-curse',
    rulesets: BOTH,
    preset: {
      base: targeted(
        1,
        90,
        'One creature · Extra 1d6 necrotic · Disadvantage on one ability · 1 hr',
        'sigil',
        '#a855f7',
        ['#a855f7', '#f5d0fe'],
        { castVariant: 2 }
      )
    }
  },
  {
    id: 'hunters-mark',
    name: "Hunter's mark",
    description: 'Glowing mark that lets the hunter track their quarry',
    category: 'target-curse',
    rulesets: BOTH,
    preset: {
      base: targeted(
        1,
        90,
        'One creature · Extra 1d6 damage · Tracks the target · 1 hr',
        'sigil',
        '#4ade80',
        ['#4ade80', '#dcfce7'],
        { tokenFxVariant: 1, castVariant: 2 }
      ),
      'dnd5e-2024': { hint: 'One creature · Extra 1d6 force damage · Tracks the target · 1 hr' }
    }
  },
  {
    id: 'banishment',
    name: 'Banishment',
    description: 'Rift that sends a creature out of this world',
    category: 'target-hold',
    rulesets: BOTH,
    preset: {
      base: targeted(4, 60, 'One creature · Banished for 1 min · Cha save', 'rift', '#8b5cf6', ['#8b5cf6', '#e9d5ff'], {
        castVariant: 2
      })
    }
  },
  {
    id: 'charm-person',
    name: 'Charm person',
    description: 'Warm glamour that makes a creature friendly',
    category: 'target-hold',
    rulesets: BOTH,
    preset: {
      base: targeted(1, 30, 'One humanoid · Charmed · Wis save · 1 hour', 'charm', '#f472b6', ['#f472b6', '#fce7f3'], {
        concentration: false
      })
    }
  },
  {
    id: 'command',
    name: 'Command',
    description: 'Single commanding word that a creature must obey',
    category: 'target-hold',
    rulesets: BOTH,
    preset: {
      base: targeted(
        1,
        60,
        'One creature · A one-word order · Wis save · 1 round',
        'charm',
        '#fcd34d',
        ['#fcd34d', '#ffffff'],
        { concentration: false, lingers: false, tokenFxVariant: 1, castVariant: 1 }
      )
    }
  },
  {
    id: 'slow',
    name: 'Slow',
    description: 'Ticking dial that drags time around a creature',
    category: 'target-hold',
    rulesets: BOTH,
    preset: {
      base: areaPicked(
        3,
        cube(40),
        120,
        'Up to 6 creatures in a 40 ft cube · Half speed, -2 AC and Dex saves, no reactions · Wis save · 1 min',
        'clock',
        '#5eead4',
        'choose',
        { fx: 'zone', durationMs: 1700, palette: ['#5eead4', '#ccfbf1'] }
      )
    }
  },
  {
    id: 'calm-emotions',
    name: 'Calm emotions',
    description: 'Soothing ripples that quiet anger and fear',
    category: 'target-hold',
    rulesets: BOTH,
    preset: {
      base: areaPicked(
        2,
        circle(20),
        60,
        '20 ft sphere · Ends charm and fear, or makes hostile creatures indifferent · Cha save · 1 min',
        'calm',
        '#7dd3fc',
        'choose',
        { fx: 'zone', durationMs: 1800, palette: ['#7dd3fc', '#e0f2fe'], variant: 5 }
      )
    }
  },
  {
    id: 'blindness-deafness',
    name: 'Blindness/deafness',
    description: 'Smoky shroud that steals sight or hearing',
    category: 'target-curse',
    rulesets: BOTH,
    preset: {
      base: targeted(
        2,
        30,
        'One creature · Blinded or deafened · Con save · 1 min',
        'blind',
        '#64748b',
        ['#475569', '#e2e8f0'],
        { concentration: false, castVariant: 2 }
      ),
      'dnd5e-2024': { rangeFt: 120 }
    }
  },
  {
    id: 'haste',
    name: 'Haste',
    description: 'Crackling speed lines that quicken an ally',
    category: 'target-enhance',
    rulesets: BOTH,
    preset: {
      base: targeted(
        3,
        30,
        'One willing creature · Double speed, +2 AC, an extra action · 1 min',
        'streaks',
        '#facc15',
        ['#facc15', '#fef9c3']
      )
    }
  },
  {
    id: 'aid',
    name: 'Aid',
    description: 'Radiant halo that bolsters allies',
    category: 'target-boon',
    rulesets: BOTH,
    preset: {
      base: targeted(
        2,
        30,
        'Up to 3 creatures · +5 max and current HP · 8 hr',
        'halo',
        '#fde68a',
        ['#fde68a', '#ffffff'],
        {
          concentration: false
        }
      )
    }
  },
  {
    id: 'heroism',
    name: 'Heroism',
    description: 'Brave flames that keep fear at bay',
    category: 'target-boon',
    rulesets: BOTH,
    preset: {
      base: targeted(
        1,
        5,
        'One willing creature · Immune to frightened, temp HP each turn · 1 min',
        'halo',
        '#fb923c',
        ['#fb923c', '#fed7aa'],
        { tokenFxVariant: 1 }
      )
    }
  },
  {
    id: 'invisibility',
    name: 'Invisibility',
    description: 'Shimmering veil that hides a creature from sight',
    category: 'target-enhance',
    rulesets: BOTH,
    preset: {
      base: targeted(
        2,
        5,
        'One creature · Invisible until it attacks or casts · 1 hr',
        'veil',
        '#c4b5fd',
        ['#c4b5fd', '#ffffff'],
        { castVariant: 1 }
      )
    }
  },
  {
    id: 'fly',
    name: 'Fly',
    description: 'Swirling winds that lift a creature off the ground',
    category: 'target-enhance',
    rulesets: BOTH,
    preset: {
      base: targeted(3, 5, 'One willing creature · Fly speed 60 ft · 10 min', 'wind', '#a5f3fc', ['#a5f3fc', '#ffffff'])
    }
  },
  {
    id: 'mass-cure-wounds',
    name: 'Mass cure wounds',
    description: 'Surge of healing light that mends everyone it touches',
    category: 'target-boon',
    rulesets: BOTH,
    preset: {
      base: areaPicked(
        5,
        circle(30),
        60,
        'Up to 6 creatures in a 30 ft sphere · Heal 3d8 + modifier HP',
        'heal',
        '#4ade80',
        'choose',
        { fx: 'burst', durationMs: 1500, palette: ['#4ade80', '#ecfccb'] },
        { concentration: false, lingers: false }
      ),
      'dnd5e-2024': { hint: 'Up to 6 creatures in a 30 ft sphere · Heal 5d8 + modifier HP' }
    }
  },
  {
    id: 'fear',
    name: 'Fear',
    description: 'Creeping dread that sends creatures fleeing',
    category: 'target-curse',
    rulesets: BOTH,
    preset: {
      base: areaPicked(
        3,
        cone(30),
        0,
        '30 ft cone · Frightened, drops what it holds · Wis save · 1 min',
        'dread',
        '#e11d48',
        'saves',
        { fx: 'cone', durationMs: 1400, palette: ['#e11d48', '#1c0a14'] },
        { origin: 'caster' }
      ),
      'dnd5e-2024': { hint: '30 ft cone · Frightened, must flee · Wis save · 1 min' }
    }
  },
  {
    id: 'spiritual-weapon',
    name: 'Spiritual weapon',
    description: 'Floating weapon of force that strikes on its own',
    category: 'summon',
    rulesets: BOTH,
    preset: {
      base: summon(
        2,
        60,
        'Spectral weapon · 1d8 + modifier force',
        {
          variants: variants(
            ['sword', 'Sword'],
            ['mace', 'Mace'],
            ['hammer', 'Hammer'],
            ['spear', 'Spear'],
            ['axe', 'Axe'],
            ['flail', 'Flail']
          ),
          size: 1
        },
        ['#fde68a', '#fbbf24'],
        1
      ),
      'dnd5e-2024': { concentration: true }
    }
  },
  {
    id: 'find-steed',
    name: 'Find steed',
    description: 'Loyal mount that answers the call',
    category: 'summon',
    rulesets: BOTH,
    preset: {
      base: summon(
        2,
        30,
        'Spectral steed · Telepathic mount',
        {
          variants: variants(
            ['warhorse', 'Warhorse', 2],
            ['pony', 'Pony'],
            ['elk', 'Elk', 2],
            ['camel', 'Camel', 2],
            ['mastiff', 'Mastiff']
          ),
          size: 1
        },
        ['#fde68a', '#a78bfa']
      ),
      'dnd5e-2024': {
        hint: 'Otherworldly steed · Telepathic mount',
        summon: {
          variants: variants(
            ['warhorse', 'Otherworldly warhorse', 2],
            ['pony', 'Otherworldly pony'],
            ['elk', 'Otherworldly elk', 2],
            ['camel', 'Otherworldly camel', 2],
            ['mastiff', 'Otherworldly mastiff']
          ),
          size: 1
        }
      }
    }
  },
  {
    id: 'find-familiar',
    name: 'Find familiar',
    description: 'Small spirit companion that scouts and helps',
    category: 'summon',
    rulesets: BOTH,
    preset: {
      base: summon(
        1,
        10,
        'Spirit companion · Delivers touch spells',
        {
          variants: variants(
            ['owl', 'Owl'],
            ['cat', 'Cat'],
            ['raven', 'Raven'],
            ['bat', 'Bat'],
            ['snake', 'Snake'],
            ['frog', 'Frog'],
            ['spider', 'Spider'],
            ['hawk', 'Hawk']
          ),
          size: 1
        },
        ['#a7f3d0', '#fde68a']
      ),
      'dnd5e-2024': {
        summon: {
          variants: variants(
            ['owl', 'Owl'],
            ['cat', 'Cat'],
            ['raven', 'Raven'],
            ['bat', 'Bat'],
            ['lizard', 'Lizard'],
            ['frog', 'Frog'],
            ['spider', 'Spider'],
            ['hawk', 'Hawk']
          ),
          size: 1
        }
      }
    }
  },
  {
    id: 'mage-hand',
    name: 'Mage hand',
    description: 'Spectral hand that carries small objects',
    category: 'summon',
    rulesets: BOTH,
    preset: {
      base: summon(0, 30, 'Spectral hand · Carries up to 10 lb', { variants: variants(['hand', 'Hand']), size: 1 }, [
        '#c4b5fd',
        '#ffffff'
      ])
    }
  },
  {
    id: 'unseen-servant',
    name: 'Unseen servant',
    description: 'Invisible helper that tends simple chores',
    category: 'summon',
    rulesets: BOTH,
    preset: {
      base: summon(1, 60, 'Invisible servant · Simple chores', { variants: variants(['wisp', 'Wisp']), size: 1 }, [
        '#93c5fd',
        '#e0f2fe'
      ])
    }
  }
];

export const SPELLS: Record<string, SpellDefinition> = Object.fromEntries(
  definitions.map((definition) => [definition.id, definition])
);

export const spellsInCategory = (category: SpellCategory, ruleset: Ruleset): SpellDefinition[] =>
  definitions.filter((spell) => spell.category === category && spell.rulesets.includes(ruleset));

/** The spell with its preset resolved for the ruleset; null for an unknown id or a spell the ruleset doesn't list */
export const resolveSpell = (id: string, ruleset: Ruleset): ResolvedSpell | null => {
  const spell = SPELLS[id];
  if (!spell?.rulesets.includes(ruleset)) return null;
  return { ...spell, resolved: byRuleset(spell.preset, ruleset) };
};

/** A spell that only decorates tokens: no template shape of its own, or an area that is only placed to pick creatures */
export const isEffectOnlyPreset = (preset: Pick<SpellPreset, 'tokenFx' | 'area' | 'areaPick'>) =>
  !!preset.tokenFx && (!preset.area || !!preset.areaPick);

/** The spell as the first ruleset listing it resolves it; for code that has no ruleset (render props) */
export const resolveSpellAnyRuleset = (id: string): ResolvedSpell | null => {
  const ruleset = SPELLS[id]?.rulesets[0];
  return ruleset ? resolveSpell(id, ruleset) : null;
};

/** The cast and token effect programs a set of spells needs, for prewarming just those */
export const spellFxKinds = (spells: readonly ResolvedSpell[]): { cast: SpellCastFx[]; token: TokenEffectKind[] } => {
  const cast = new Set<SpellCastFx>();
  const token = new Set<TokenEffectKind>();
  for (const { resolved } of spells) {
    cast.add(resolved.cast.fx);
    if (resolved.tokenFx) token.add(resolved.tokenFx);
    if (resolved.concentration) token.add('concentration');
  }
  return { cast: [...cast], token: [...token] };
};

export const resolveSummonSize = (summoned: SpellSummon, variantId: string): 1 | 2 | 3 =>
  summoned.variants.find((variant) => variant.id === variantId)?.size ?? summoned.size;
