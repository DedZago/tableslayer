import { z } from 'zod';

export const handoutDescriptorSchema = z.object({
  presentationId: z.uuid(),
  artworkLocation: z.string().min(1).max(1024),
  title: z.string().trim().max(200).nullable(),
  presenterId: z.string().min(1).max(200),
  publishedAt: z.number().int().nonnegative()
});
