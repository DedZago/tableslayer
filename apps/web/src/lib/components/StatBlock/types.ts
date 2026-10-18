import type { rollFormula } from '$lib/utils/statBlock';
import type { Inline, StatBlock } from '$lib/utils/statBlock/types';
import type { Snippet } from 'svelte';

export type StatBlockRoll = ReturnType<typeof rollFormula>;
export type StatBlockRollHandler = (label: string, formula: string, roll: StatBlockRoll) => void;
export type HitPointsFields = { hitPoints?: number | null; tempHitPoints?: number | null };
export type StatBlockVariant = 'full' | 'compact';

export type StatBlockPanelProps = {
  statBlock: StatBlock;
  hitPoints?: number | null;
  tempHitPoints?: number | null;
  readonly?: boolean;
  variant?: StatBlockVariant;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onHitPointsChange?: (fields: HitPointsFields) => void;
  onRoll?: StatBlockRollHandler;
  headerActions?: Snippet;
};

export type StatBlockInlineProps = {
  paragraphs: Inline[][];
  inline?: boolean;
  rollLabel?: string;
  onRoll?: StatBlockRollHandler;
};
