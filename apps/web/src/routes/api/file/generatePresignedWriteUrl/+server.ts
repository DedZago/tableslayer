import { apiFactory } from '$lib/factories';
import { generatePresignedWriteUrl } from '$lib/server';
import { validateMediaUpload } from '$lib/utils/mediaUpload';
import mime from 'mime';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const validationSchema = z.object({
  fileName: z
    .string()
    .min(1, 'File name cannot be empty')
    .regex(/^[a-zA-Z0-9-_/.]+$/, 'Invalid file name format')
    .refine((name) => !name.includes('//') && !name.endsWith('/'), {
      message: 'Invalid file name structure'
    }),
  size: z.number().int().positive().optional(),
  contentType: z
    .string()
    .min(1, 'Content type cannot be empty')
    .regex(/^[-\w]+\/[-\w]+$/, 'Invalid content type format')
});

export const POST = apiFactory(
  async ({ body, locals }) => {
    if (!locals.user?.id) {
      throw new Error('Unauthorized');
    }
    const { fileName, contentType } = body;

    const folder = fileName.split('/')[0];
    const transient = ['fog', 'thumbnail', 'annotations'].includes(folder);
    if (!transient && !['map', 'marker', 'avatar', 'pause-screen', 'asset', 'handout'].includes(folder)) {
      throw new Error('Unsupported upload folder');
    }
    if (fileName.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('Invalid file path');
    }
    if (transient && !['image/png', 'image/jpeg'].includes(contentType)) throw new Error('Unsupported image type');
    if (!transient) validateMediaUpload({ type: contentType, size: body.size ?? 1 });
    const location = transient
      ? fileName
      : `uploads/${locals.user.id}/${randomUUID()}.${mime.getExtension(contentType)}`;
    const signedUrl = await generatePresignedWriteUrl(location, contentType);
    return { signedUrl, location };
  },
  {
    validationSchema,
    validationErrorMessage: 'Check your form for errors',
    unauthorizedMessage: 'You are not authorized to create presigned URLs',
    unexpectedErrorMessage: 'An unexpected error occurred while creating the presigned URL.'
  }
);
