export { type HoveredMarker } from '../../types/awareness';
export {
  AnnotationEffect,
  AnnotationEffectDefaults,
  getDefaultEffectProps,
  type AnnotationEffectProps,
  type AnnotationLayerData,
  type AnnotationsLayerProps
} from './components/AnnotationLayer/types';
export {
  AOE_EFFECT_DEFAULT_COLORS,
  AOE_EFFECT_LABELS,
  AoeEffect,
  AoeShape,
  type AoeTemplate,
  type AoeTemplateLayerExports,
  type AoeTemplateLayerProps,
  type AoeToolSettings,
  type SpellAimArea,
  type SpellAimPlaced,
  type SpellAimSettings,
  type SpellAimed,
  type SpellAreaTargets,
  type SpellTargeted
} from './components/AoeTemplateLayer/types';
export { DrawMode, RenderMode, ToolType, peekRLEDimensions } from './components/DrawingLayer/types';
export { type EdgeOverlayProps } from './components/EdgeOverlayLayer/types';
export { type FogLayerProps } from './components/FogLayer/types';
export { type FogOfWarLayerProps } from './components/FogOfWarLayer/types';
export { GridMode, GridType, type GridLayerProps } from './components/GridLayer/types';
export {
  LIGHT_PULSE_DURATION,
  LIGHT_STYLE_COLORS,
  LightPulse,
  LightStyle,
  type Light,
  type LightLayerExports,
  type LightLayerProps
} from './components/LightLayer/types';
export { MapLayerType, type MapLayerProps } from './components/MapLayer/types';
export {
  MarkerShape,
  MarkerSize,
  MarkerVisibility,
  type Marker,
  type MarkerCondition,
  type MarkerLayerExports,
  type MarkerLayerProps
} from './components/MarkerLayer/types';
export { MeasurementType, type MeasurementLayerProps } from './components/MeasurementLayer/types';
export { ParticleType, type ParticleSystemProps } from './components/ParticleSystem/types';
export { default as PerformanceDebugger } from './components/PerformanceDebugger/PerformanceDebugger.svelte';
export { default as PerformanceOverlay } from './components/PerformanceOverlay/PerformanceOverlay.svelte';
export { default as PointerInputManager } from './components/PointerInputManager/PointerInputManager.svelte';
export { SceneRotation, type PostProcessingProps, type SceneLayerProps } from './components/Scene/types';
export {
  type CameraShake,
  type SpellCast,
  type SpellCastLayerExports,
  type SpellCastPoint,
  type SpellPrewarmExports
} from './components/SpellCastLayer/types';
export { default as Stage } from './components/Stage/Stage.svelte';
export * from './components/Stage/types';
export { type TokenEffect, type TokenEffectLayerExports } from './components/TokenEffectLayer/types';
export {
  AshPreset,
  BlizzardPreset,
  DustStormPreset,
  EmbersPreset,
  FirefliesPreset,
  LeavesPreset,
  RainPreset,
  SnowPreset
} from './components/WeatherLayer/presets';
export {
  WeatherType,
  type DepthOfFieldConfig,
  type WeatherLayerPreset,
  type WeatherLayerProps
} from './components/WeatherLayer/types';
export {
  ANNOTATION_EFFECTS,
  ANNOTATION_EFFECT_CATEGORIES,
  annotationEffectDefinition,
  annotationEffectsInCategory,
  type AnnotationEffectCategory,
  type AnnotationEffectCategoryDefinition,
  type AnnotationEffectDefinition
} from './helpers/annotationEffects';
export {
  EXPIRY_FADE_MS,
  anchoredTemplateMoves,
  angleFromCursor,
  formatTemplateLabel,
  getTemplateHandlePoints,
  getTemplateLocalBounds,
  getTemplateOutline,
  isTemplateAnchored,
  isTemplateExpired,
  nextTemplateInStack,
  normalizeTemplateAngle,
  rotateTemplateAngle,
  sizeFromCursor,
  spellAimDraft,
  spellAimPlacement,
  spellRangeRadiusPx,
  templateCardAnchor,
  templateExpiryFade,
  templateFadeMs,
  templateIntersectsRect,
  templateLocalToLayer,
  templateSdf,
  withAnchoredPosition,
  worldToTemplateLocal,
  type AnchorMarker,
  type TemplateBounds,
  type TemplatePoint
} from './helpers/aoeTemplates';
export { debugState, isDebugEnabled, setDebugEnabled } from './helpers/debugState.svelte';
export { parseFogRooms, pointInPolygon, polygonArea, smallestRoomContaining, type FogRoom } from './helpers/fogRooms';
export { getGridCellSize, snapToGrid } from './helpers/grid';
export {
  displayToMapSpace,
  getAlignedMapTransform,
  getLockedMapZoom,
  getMapGridCellSize,
  getMapSpaceDisplay,
  mapToDisplaySpace,
  type AlignedMapTransform,
  type MapImageSize,
  type MapTransform,
  type Point2
} from './helpers/mapSpace';
export {
  MARKER_CONDITIONS,
  MARKER_CONDITION_CATEGORIES,
  MARKER_CONDITION_ORDER,
  conditionIdsInCategory,
  conditionsKey,
  resolveCondition,
  sortConditions,
  toggleCondition,
  type ConditionCategory,
  type ConditionCategoryDefinition,
  type ConditionDefinition,
  type ResolvedCondition
} from './helpers/markerConditions';
export {
  get1PercentLowFps,
  getAverageFps,
  getFrameTimes,
  performanceHistory,
  performanceMetrics,
  resetMetrics,
  type PerformanceHistory,
  type PerformanceMetrics
} from './helpers/performanceMetrics.svelte';
export {
  DEFAULT_RULESET,
  RULESETS,
  RULESET_LABELS,
  byRuleset,
  isRuleset,
  type Ruleset,
  type RulesetSpec
} from './helpers/rulesets';
export {
  MAX_CONCURRENT_SPELL_CASTS,
  SPELL_CAST_LINK_GRACE_MS,
  SPELL_FX_LIST,
  pruneSpellCasts,
  receiveSpellCast,
  spellCastProgress,
  type BroadcastSpellCast
} from './helpers/spellCasts';
export {
  INSTANT_FADE_MS,
  SPELLS,
  SPELL_CATEGORIES,
  SPELL_CATEGORY_GROUPS,
  instantTemplateExpiresAt,
  isEffectOnlyPreset,
  resolveSpell,
  resolveSpellAnyRuleset,
  resolveSpellAtSlot,
  resolveSummonSize,
  spellAreaAtSlot,
  spellFxKinds,
  spellsInCategory,
  type MarkerConcentration,
  type ResolvedSpell,
  type SpellArea,
  type SpellCastFx,
  type SpellCastSpec,
  type SpellCategory,
  type SpellCategoryDefinition,
  type SpellDefinition,
  type SpellPreset,
  type SpellSummon,
  type SpellSummonVariant,
  type SpellUpcast,
  type TokenEffectKind,
  type TokenFx
} from './helpers/spells';
export { isSpellTargetInRange, spellTargetAt } from './helpers/spellTargets';
export { TOKEN_FX_LIST } from './helpers/tokenEffects';
