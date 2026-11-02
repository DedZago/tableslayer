import type { TokenEffectKind } from '../../helpers/spells';

/**
 * One ambient effect bound to a token. The consumer derives the list from its spell rows and the
 * casters that are concentrating; the layer follows each token's live position.
 */
export interface TokenEffect {
  id: string;
  markerId: string;
  fx: TokenEffectKind;
  /** Any CSS colour string chroma-js reads */
  color: string;
  /** Feet; the reach of an orbit, or the bright radius of a glow */
  radius?: number;
  /** Picks a look within the effect (sigil: 0 hex, 1 crosshair; charm: 0 hearts, 1 glyph) */
  variant?: number;
  /** Epoch ms; the effect fades in from here */
  startedAt: number;
}

export interface TokenEffectLayerExports {
  /** Links the programs of the given kinds so an effect never links one when it appears */
  prewarm(fxs: TokenEffectKind[]): void;
}
