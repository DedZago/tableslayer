import { z } from 'zod';
import type { Ability, Inline, StatBlock, StatEntry, StatSpellcasting } from './types';

const MAX_STAT_BLOCK_JSON_LENGTH = 65536;

const textSchema = z.string().max(2000);
const textListSchema = z.array(textSchema).max(100);
const abilitySchema = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const paragraphSchema = z.array(z.lazy(() => inlineSchema)).max(100);

export const inlineSchema: z.ZodType<Inline> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: textSchema }),
  z.object({ kind: z.literal('hit'), bonus: z.number().int() }),
  z.object({ kind: z.literal('damage'), formula: textSchema }),
  z.object({ kind: z.literal('dice'), formula: textSchema }),
  z.object({ kind: z.literal('dc'), dc: z.number().int() }),
  z.object({ kind: z.literal('attack'), label: textSchema }),
  z.object({
    kind: z.literal('ref'),
    refType: z.enum(['spell', 'condition', 'item', 'creature', 'skill', 'action', 'status', 'sense', 'other']),
    text: textSchema
  }),
  z.object({ kind: z.literal('recharge'), min: z.number().int() }),
  z.object({ kind: z.literal('em'), text: textSchema })
]);

export const statEntrySchema: z.ZodType<StatEntry> = z.object({
  name: textSchema,
  nameInlines: z.array(inlineSchema).max(100),
  body: z.array(paragraphSchema).max(100),
  attack: z
    .object({
      toHit: z.number().int(),
      kind: textSchema,
      reach: textSchema.optional(),
      range: textSchema.optional(),
      damage: z
        .array(z.object({ formula: textSchema, average: z.number().optional(), type: textSchema.optional() }))
        .max(100)
    })
    .optional(),
  save: z.object({ dc: z.number().int(), ability: abilitySchema.optional() }).optional(),
  recharge: z.number().int().optional(),
  cost: z.number().int().optional()
});

const spellcastingSchema: z.ZodType<StatSpellcasting> = z.object({
  name: textSchema,
  header: z.array(paragraphSchema).max(100),
  displayAs: z.enum(['trait', 'action', 'bonus', 'reaction', 'legendary']),
  dc: z.number().int().optional(),
  toHit: z.number().int().optional(),
  ability: abilitySchema.optional(),
  groups: z.array(z.object({ label: textSchema, slots: z.number().int().optional(), spells: textListSchema })).max(100),
  footer: z.array(paragraphSchema).max(100)
});

const entriesSchema = z.array(statEntrySchema).max(100);

const abilityScoreSchema = z.object({
  score: z.number().int(),
  mod: z.number().int(),
  save: z.number().int().optional()
});

export const statBlockSchema: z.ZodType<StatBlock> = z
  .object({
    version: z.literal(1),
    source: z.object({
      provider: z.literal('5etools'),
      name: textSchema,
      source: textSchema,
      page: z.number().int().optional(),
      adapterVersion: textSchema
    }),
    name: textSchema,
    size: textListSchema,
    type: textSchema,
    alignment: textSchema,
    ac: z.array(z.object({ value: z.number().int(), note: textSchema.optional() })).max(100),
    hp: z.object({ average: z.number().int().nullable(), formula: textSchema.optional(), note: textSchema.optional() }),
    speed: z
      .array(
        z.object({
          mode: z.enum(['walk', 'fly', 'swim', 'climb', 'burrow']),
          feet: z.number().int(),
          note: textSchema.optional()
        })
      )
      .max(100),
    canHover: z.boolean().optional(),
    abilities: z.object({
      str: abilityScoreSchema,
      dex: abilityScoreSchema,
      con: abilityScoreSchema,
      int: abilityScoreSchema,
      wis: abilityScoreSchema,
      cha: abilityScoreSchema
    }),
    skills: z.array(z.object({ name: textSchema, bonus: textSchema })).max(100),
    senses: textListSchema,
    passive: z.number().int().optional(),
    languages: textListSchema,
    cr: z.object({
      display: textSchema,
      value: z.number(),
      xp: z.number().int().optional(),
      pb: z.number().int(),
      lair: textSchema.optional()
    }),
    initiative: z.number().int().optional(),
    vulnerable: textListSchema,
    resist: textListSchema,
    immune: textListSchema,
    conditionImmune: textListSchema,
    traits: entriesSchema,
    actions: entriesSchema,
    bonusActions: entriesSchema,
    reactions: entriesSchema,
    legendary: entriesSchema,
    legendaryHeader: z.array(paragraphSchema).max(100).optional(),
    legendaryCount: z.number().int().optional(),
    mythic: entriesSchema,
    spellcasting: z.array(spellcastingSchema).max(100),
    warnings: textListSchema
  })
  .superRefine((statBlock, context) => {
    if (JSON.stringify(statBlock).length > MAX_STAT_BLOCK_JSON_LENGTH) {
      context.addIssue({ code: 'custom', message: 'Stat block is too large' });
    }
  });
