import { RULESETS } from '@tableslayer/stage';
import { describe, expect, it } from 'vitest';
import { VALID_RULESETS } from './schema';

describe('VALID_RULESETS', () => {
  it('mirrors the stage RULESETS', () => {
    expect([...VALID_RULESETS]).toEqual([...RULESETS]);
  });
});
