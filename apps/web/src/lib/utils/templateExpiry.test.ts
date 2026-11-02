import type { SessionDocClient } from '$lib/realtime';
import { describe, expect, it, vi } from 'vitest';
import { expiredTemplateIds, orphanedEffectTemplateIds, planSceneSweep, sweepExpiredTemplates } from './templateExpiry';

const templates = [
  { id: 'gone', expiresAt: 100 },
  { id: 'now', expiresAt: 200 },
  { id: 'later', expiresAt: 300 },
  { id: 'forever', expiresAt: null },
  { id: 'legacy' }
];

describe('expiredTemplateIds', () => {
  it('returns rows expired at or before now and ignores rows without an expiry', () => {
    expect(expiredTemplateIds(templates, 200)).toEqual(['gone', 'now']);
    expect(expiredTemplateIds(templates, 50)).toEqual([]);
  });
});

describe('sweepExpiredTemplates', () => {
  const makeClient = () => {
    const deleteAoeTemplate = vi.fn();
    const transaction = vi.fn((fn: () => void) => fn());
    const client = {
      scene: () => ({ aoeTemplates: templates, markers: [] }),
      systemWrite: { deleteAoeTemplate, transaction }
    } as unknown as SessionDocClient;
    return { client, deleteAoeTemplate, transaction };
  };

  it('deletes expired rows through the system writer in one transaction', () => {
    const { client, deleteAoeTemplate, transaction } = makeClient();
    sweepExpiredTemplates(client, 'scene-1', 200);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteAoeTemplate.mock.calls).toEqual([
      ['scene-1', 'gone'],
      ['scene-1', 'now']
    ]);
  });

  it('writes nothing when nothing has expired', () => {
    const { client, transaction } = makeClient();
    sweepExpiredTemplates(client, 'scene-1', 10);
    expect(transaction).not.toHaveBeenCalled();
  });
});

const conc = (templateIds: string[], markerIds: string[] = []) => ({
  spellId: 'hold-person',
  startedAt: 100,
  templateIds,
  markerIds
});
const tpl = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  spellId: null,
  anchorMarkerId: null,
  expiresAt: null,
  ...extra
});

describe('orphanedEffectTemplateIds', () => {
  it('finds effect rows whose token is gone, and leaves other spells and unanchored rows', () => {
    const rows = [
      tpl('chains', { spellId: 'hold-person', anchorMarkerId: 'goblin' }),
      tpl('kept', { spellId: 'hold-person', anchorMarkerId: 'alive' }),
      tpl('zone', { spellId: 'web', anchorMarkerId: 'goblin' }),
      tpl('free', { spellId: 'hold-person' })
    ];
    expect(orphanedEffectTemplateIds(rows, new Set(['alive']))).toEqual(['chains']);
  });
});

describe('planSceneSweep', () => {
  it('deletes orphaned effect rows and prunes the caster list', () => {
    const plan = planSceneSweep(
      {
        markers: [{ id: 'wizard', concentration: conc(['chains', 'second']) }],
        aoeTemplates: [
          tpl('chains', { spellId: 'hold-person', anchorMarkerId: 'goblin' }),
          tpl('second', { spellId: 'hold-person', anchorMarkerId: 'wizard' })
        ]
      },
      0
    );
    expect(plan.deleteTemplateIds).toEqual(['chains']);
    expect(plan.concentrationUpdates).toEqual([{ markerId: 'wizard', concentration: conc(['second']) }]);
  });

  it('clears a concentration when nothing it lists remains', () => {
    const plan = planSceneSweep({ markers: [{ id: 'wizard', concentration: conc(['gone']) }], aoeTemplates: [] }, 0);
    expect(plan.concentrationUpdates).toEqual([{ markerId: 'wizard', concentration: null }]);
    expect(plan.memory.size).toBe(0);
  });

  it('writes nothing for a concentration that is intact, and remembers it', () => {
    const plan = planSceneSweep(
      { markers: [{ id: 'wizard', concentration: conc(['zone']) }], aoeTemplates: [tpl('zone')] },
      0
    );
    expect(plan.concentrationUpdates).toEqual([]);
    expect(plan.deleteTemplateIds).toEqual([]);
    expect(plan.memory.get('wizard')).toEqual(conc(['zone']));
  });

  it('ends what a removed caster was concentrating on, including summoned tokens', () => {
    const remembered = new Map([['wizard', conc(['zone'], ['sphere'])]]);
    const plan = planSceneSweep(
      { markers: [{ id: 'sphere', concentration: null }], aoeTemplates: [tpl('zone'), tpl('other')] },
      0,
      remembered
    );
    expect(plan.deleteTemplateIds).toEqual(['zone']);
    expect(plan.deleteMarkerIds).toEqual(['sphere']);
  });

  it('is idempotent: a second plan over the swept scene is empty', () => {
    const plan = planSceneSweep({ markers: [{ id: 'wizard', concentration: conc(['gone']) }], aoeTemplates: [] }, 0);
    const next = planSceneSweep({ markers: [{ id: 'wizard', concentration: null }], aoeTemplates: [] }, 0, plan.memory);
    expect(next).toMatchObject({ deleteTemplateIds: [], deleteMarkerIds: [], concentrationUpdates: [] });
  });
});
