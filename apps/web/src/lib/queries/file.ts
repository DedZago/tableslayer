import { mutationFactory } from '$lib/factories';
import { incrementUrlVersion } from '$lib/utils/fileVersion';
import { validateMediaUpload } from '$lib/utils/mediaUpload';
import mime from 'mime';
import { v4 as uuidv4 } from 'uuid';

// Generic function to upload blob to R2, does not create a user file entry
const uploadBlobToR2 = async (blob: Blob, fileName: string, contentType: string) => {
  const file = new File([blob], fileName, { type: contentType });

  // Step 1: Fetch Presigned URL
  const presignedUrlResponse = await fetch('/api/file/generatePresignedWriteUrl', {
    method: 'POST',
    body: JSON.stringify({ fileName, contentType }),
    headers: { 'Content-Type': 'application/json' }
  });

  if (!presignedUrlResponse.ok) {
    throw new Error('Failed to generate presigned URL');
  }

  const { signedUrl } = (await presignedUrlResponse.json()) as { signedUrl: string };

  // Step 2: Upload to Cloudflare R2
  const uploadResponse = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file
  });

  if (!uploadResponse.ok) {
    throw new Error('File upload to Cloudflare R2 failed');
  }

  return { location: fileName };
};

// Uploads fog to R2, does not create a user file entry because they are throwaway
export const useUploadFogFromBlobMutation = () => {
  return mutationFactory<{ blob: Blob; sceneId: string; currentUrl?: string | null }, { location: string }, Error>({
    mutationKey: ['uploadFog'],
    mutationFn: async ({ blob, sceneId, currentUrl }) => {
      const basePath = `fog/${sceneId}.png`;
      const contentType = 'image/png';

      // Upload to base path (overwrites existing file)
      await uploadBlobToR2(blob, basePath, contentType);

      // Return versioned URL
      const versionedUrl = incrementUrlVersion(currentUrl, basePath);
      return { location: versionedUrl };
    },
    onSuccess: () => {
      return;
    }
  });
};

// Uploads scene thumbnail to R2, does not create a user file entry because they are throwaway
export const useUploadSceneThumbnailMutation = () => {
  return mutationFactory<{ blob: Blob; sceneId: string; currentUrl?: string | null }, { location: string }, Error>({
    mutationKey: ['uploadSceneThumbnail'],
    mutationFn: async ({ blob, sceneId, currentUrl }) => {
      const basePath = `thumbnail/${sceneId}.jpg`;
      const contentType = 'image/jpeg';

      // Upload to base path (overwrites existing file)
      await uploadBlobToR2(blob, basePath, contentType);

      // Return versioned URL
      const versionedUrl = incrementUrlVersion(currentUrl, basePath);
      return { location: versionedUrl };
    },
    onSuccess: () => {
      return;
    }
  });
};

// Uploads annotation layer to R2, does not create a user file entry because they are throwaway
export const useUploadAnnotationFromBlobMutation = () => {
  return mutationFactory<
    { blob: Blob; sceneId: string; layerId: string; currentUrl?: string | null },
    { location: string },
    Error
  >({
    mutationKey: ['uploadAnnotation'],
    mutationFn: async ({ blob, sceneId, layerId, currentUrl }) => {
      const basePath = `annotations/${sceneId}/${layerId}.png`;
      const contentType = 'image/png';

      // Upload to base path (overwrites existing file)
      await uploadBlobToR2(blob, basePath, contentType);

      // Return versioned URL
      const versionedUrl = incrementUrlVersion(currentUrl, basePath);
      return { location: versionedUrl };
    },
    onSuccess: () => {
      return;
    }
  });
};

export const uploadMediaFile = async (file: File, folder: string) => {
  validateMediaUpload(file);
  const extension = mime.getExtension(file.type);
  const response = await fetch('/api/file/generatePresignedWriteUrl', {
    method: 'POST',
    body: JSON.stringify({ fileName: `${folder}/${uuidv4()}.${extension}`, contentType: file.type, size: file.size }),
    headers: { 'Content-Type': 'application/json' }
  });
  if (!response.ok) throw new Error((await response.json()).message || 'Failed to prepare the upload');
  const { signedUrl, location } = (await response.json()) as { signedUrl: string; location: string };
  const uploaded = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!uploaded.ok) throw new Error('File upload failed');
  const created = await fetch('/api/file/createFile', {
    method: 'POST',
    body: JSON.stringify({ location }),
    headers: { 'Content-Type': 'application/json' }
  });
  if (!created.ok) throw new Error((await created.json()).message || 'Failed to register the uploaded file');
  return created.json() as Promise<{ userId: string; fileId: number; location: string }>;
};

export const useUploadFileMutation = () =>
  mutationFactory<
    { file: File; folder: string; id?: string; currentUrl?: string | null },
    { userId: string; fileId: number; location: string },
    Error
  >({
    mutationKey: ['uploadFile'],
    mutationFn: ({ file, folder }) => uploadMediaFile(file, folder),
    onSuccess: () => {
      return;
    }
  });
