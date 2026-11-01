import { AnnotationEffect } from '../components/AnnotationLayer/types';

export type AnnotationEffectCategory = 'elements' | 'magic' | 'terrain' | 'clouds';

export type AnnotationEffectCategoryDefinition = {
  id: AnnotationEffectCategory;
  label: string;
  color: string;
  description: string;
};

export type AnnotationEffectDefinition = {
  effect: AnnotationEffect;
  label: string;
  hint: string;
  category: AnnotationEffectCategory;
  /** Layer color for the effect: the opacity slider tint, and the tint of effects that use it (Force) */
  color: string;
};

export const ANNOTATION_EFFECT_CATEGORIES: AnnotationEffectCategoryDefinition[] = [
  { id: 'elements', label: 'Elements', color: '#f97316', description: 'Fire, lava, lightning, water, ice and acid' },
  { id: 'magic', label: 'Magic', color: '#a855f7', description: 'Spell auras and magical zones' },
  { id: 'terrain', label: 'Terrain', color: '#84cc16', description: 'Hazards and difficult ground' },
  { id: 'clouds', label: 'Clouds and swarms', color: '#94a3b8', description: 'Gas, fog, sleet and swarms' }
];

/** Every drawable effect, in display order */
export const ANNOTATION_EFFECTS: AnnotationEffectDefinition[] = [
  { effect: AnnotationEffect.Fire, label: 'Fire', hint: 'Flames that flicker', category: 'elements', color: '#ff4d1a' },
  {
    effect: AnnotationEffect.Lava,
    label: 'Lava',
    hint: 'Molten rock under a cracked crust',
    category: 'elements',
    color: '#ff5a1f'
  },
  {
    effect: AnnotationEffect.Lightning,
    label: 'Lightning',
    hint: 'Crackling electric arcs',
    category: 'elements',
    color: '#6f8cff'
  },
  { effect: AnnotationEffect.Water, label: 'Water', hint: 'Rippling water', category: 'elements', color: '#3380cc' },
  {
    effect: AnnotationEffect.Ice,
    label: 'Ice',
    hint: 'Frozen, slippery ground',
    category: 'elements',
    color: '#b3d9ff'
  },
  {
    effect: AnnotationEffect.Acid,
    label: 'Acid',
    hint: 'A bubbling corrosive pool',
    category: 'elements',
    color: '#b5e61d'
  },
  {
    effect: AnnotationEffect.Magic,
    label: 'Magic',
    hint: 'Shimmering arcane glow',
    category: 'magic',
    color: '#9333ea'
  },
  {
    effect: AnnotationEffect.Radiant,
    label: 'Radiant',
    hint: 'Holy light, like spirit guardians',
    category: 'magic',
    color: '#ffd76a'
  },
  {
    effect: AnnotationEffect.Necrotic,
    label: 'Necrotic',
    hint: 'Withered ground with sickly veins',
    category: 'magic',
    color: '#5fd35a'
  },
  {
    effect: AnnotationEffect.Force,
    label: 'Force',
    hint: 'A wall or field of force',
    category: 'magic',
    color: '#7fb2ff'
  },
  {
    effect: AnnotationEffect.Darkness,
    label: 'Darkness',
    hint: 'Magical darkness that blocks sight',
    category: 'magic',
    color: '#2a1440'
  },
  {
    effect: AnnotationEffect.SpaceTear,
    label: 'Space tear',
    hint: 'A rift in reality',
    category: 'magic',
    color: '#330066'
  },
  {
    effect: AnnotationEffect.Grease,
    label: 'Grease',
    hint: 'Slick, slippery ground',
    category: 'terrain',
    color: '#4d3319'
  },
  {
    effect: AnnotationEffect.Mud,
    label: 'Mud',
    hint: 'Deep mud, difficult terrain',
    category: 'terrain',
    color: '#6b4a26'
  },
  { effect: AnnotationEffect.Blood, label: 'Blood', hint: 'Pools of blood', category: 'terrain', color: '#8a0b12' },
  {
    effect: AnnotationEffect.Thorns,
    label: 'Thorns',
    hint: 'Spike growth that hurts to cross',
    category: 'terrain',
    color: '#5a6b2a'
  },
  {
    effect: AnnotationEffect.Entangle,
    label: 'Entangle',
    hint: 'Grasping vines',
    category: 'terrain',
    color: '#3a7d2c'
  },
  { effect: AnnotationEffect.Web, label: 'Web', hint: 'Sticky webbing', category: 'terrain', color: '#e6e8eb' },
  {
    effect: AnnotationEffect.PoisonGas,
    label: 'Poison gas',
    hint: 'A choking green cloud',
    category: 'clouds',
    color: '#59cc33'
  },
  {
    effect: AnnotationEffect.FogCloud,
    label: 'Fog cloud',
    hint: 'Thick fog, heavily obscured',
    category: 'clouds',
    color: '#d9dde3'
  },
  {
    effect: AnnotationEffect.Sleet,
    label: 'Sleet',
    hint: 'Freezing rain and slick ice',
    category: 'clouds',
    color: '#cce6ff'
  },
  {
    effect: AnnotationEffect.InsectSwarm,
    label: 'Insect swarm',
    hint: 'A cloud of biting insects',
    category: 'clouds',
    color: '#5a3d1a'
  }
];

const BY_EFFECT = new Map(ANNOTATION_EFFECTS.map((definition) => [definition.effect, definition]));

export const annotationEffectDefinition = (effect: AnnotationEffect): AnnotationEffectDefinition | undefined =>
  BY_EFFECT.get(effect);

export const annotationEffectsInCategory = (category: AnnotationEffectCategory): AnnotationEffectDefinition[] =>
  ANNOTATION_EFFECTS.filter((definition) => definition.category === category);
