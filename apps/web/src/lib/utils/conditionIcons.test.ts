import { IconTag } from '@tabler/icons-svelte';
import { MARKER_CONDITION_ORDER } from '@tableslayer/stage';
import { describe, expect, it } from 'vitest';
import { conditionIcon } from './conditionIcons';

describe('conditionIcon', () => {
  it('gives every catalog condition its own icon', () => {
    for (const id of MARKER_CONDITION_ORDER) expect(conditionIcon(id), id).not.toBe(IconTag);
  });

  it('falls back to the tag icon for custom conditions', () => {
    expect(conditionIcon('custom:1')).toBe(IconTag);
  });
});
