import { db } from '$lib/db/app';
import { gameSessionTable, partyMemberTable } from '$lib/db/app/schema';
import { and, eq, inArray } from 'drizzle-orm';

export const assertGameSessionEditor = async (userId: string, gameSessionId: string, partyId: string) => {
  const membership = await db
    .select({ partyId: gameSessionTable.partyId })
    .from(gameSessionTable)
    .innerJoin(partyMemberTable, eq(partyMemberTable.partyId, gameSessionTable.partyId))
    .where(
      and(
        eq(gameSessionTable.id, gameSessionId),
        eq(gameSessionTable.partyId, partyId),
        eq(partyMemberTable.userId, userId),
        inArray(partyMemberTable.role, ['admin', 'editor'])
      )
    )
    .get();
  if (!membership) throw new Error('Unauthorized');
  return membership;
};
