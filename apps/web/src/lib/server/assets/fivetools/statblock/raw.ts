import { z } from 'zod';

export const rawMonsterSchema = z.looseObject({
  name: z.string(),
  source: z.string()
});

export type RawMonster = z.infer<typeof rawMonsterSchema>;
