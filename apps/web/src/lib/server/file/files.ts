import { db } from '$lib/db/app';
import { filesTable, userFilesTable } from '$lib/db/app/schema';
import { mediaUploadLimit, validateMediaUpload } from '$lib/utils/mediaUpload';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import mime from 'mime';
import { unlink } from 'node:fs/promises';
import type { Readable } from 'stream';
import {
  copyLocalAsset,
  isLocalStorage,
  localAssetPath,
  localAssetUrl,
  readLocalAsset,
  signedLocalUploadUrl,
  statLocalAsset,
  writeLocalAsset
} from './localStorage';
import { validateStoredMedia } from './validateImage';

// Setup R2 Client
export const r2 = new S3Client({
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY!
  },
  region: 'auto',
  forcePathStyle: true
});

const CLOUDFLARE_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME!;

const generateRandomFileName = (originalName: string) => {
  const extensionMatch = originalName.match(/\.([a-zA-Z0-9]+)$/);
  const extension = extensionMatch ? `.${extensionMatch[1]}` : '';
  return `${randomUUID()}${extension}`;
};

const uploadToR2 = async (
  fileStream: Readable | Buffer,
  fileName: string,
  contentType: string,
  destinationFolder?: string,
  contentLength?: number,
  caching: boolean = true // Default to true
) => {
  // Normalize the destination folder
  const normalizedFolder = destinationFolder?.replace(/^\/+|\/+$/g, '') || '';
  let key = fileName;

  // If there's a destination folder, include it in the key
  if (normalizedFolder) {
    key = `${normalizedFolder}/${fileName}`;
  }

  const putObjectParams = {
    Bucket: CLOUDFLARE_BUCKET_NAME,
    Key: key,
    Body: fileStream,
    ContentType: contentType,
    ...(contentLength && { ContentLength: contentLength }),
    ...(caching === false && { CacheControl: 'no-cache, no-store, must-revalidate' }) // Apply no-cache headers if caching is false
  };

  try {
    if (isLocalStorage()) await writeLocalAsset(key, fileStream);
    else await r2.send(new PutObjectCommand(putObjectParams));
    return key;
  } catch (error) {
    console.error('Error uploading to R2:', error);
    throw error;
  }
};

/**
 * Function to upload a file from a URL.
 */
export const uploadFileFromUrl = async (imageUrl: string, userId: string, destinationFolder?: string) => {
  try {
    // Get the image as a buffer
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to download image from ${imageUrl}: ${response.status} ${response.statusText}`);
    }

    const originalFileName = imageUrl.split('/').pop() || 'unknown_file';
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const fileBuffer = Buffer.from(await response.arrayBuffer());
    const contentLength = fileBuffer.byteLength;
    await validateStoredMedia(Buffer.from(fileBuffer), contentType);

    // Generate a random file name with the original extension
    const fileName = generateRandomFileName(originalFileName);

    // Upload to R2 using the helper function
    const fullPath = await uploadToR2(fileBuffer, fileName, contentType, destinationFolder, contentLength);

    // Insert file details into your database with the correct full path
    const fileRow = await db.insert(filesTable).values({ location: fullPath }).returning().get();
    const fileToUserRow = await db.insert(userFilesTable).values({ userId, fileId: fileRow.id }).returning().get();

    return fileToUserRow;
  } catch (error) {
    console.error('Error uploading from URL:', error);
    throw error;
  }
};

/**
 * Function to upload a file from a local file input (in the browser).
 */
export const uploadFileFromInput = async (file: File, userId: string, destinationFolder?: string) => {
  try {
    validateMediaUpload(file);
    const originalFileName = file.name;
    const contentType = file.type || 'application/octet-stream';
    const fileBuffer = await file.arrayBuffer(); // Convert the file to a buffer
    const contentLength = fileBuffer.byteLength;
    await validateStoredMedia(Buffer.from(fileBuffer), contentType);

    // Generate a random file name with the original extension
    const fileName = generateRandomFileName(originalFileName);

    // Upload to R2 using the helper function
    const fullPath = await uploadToR2(Buffer.from(fileBuffer), fileName, contentType, destinationFolder, contentLength);

    // Insert file details into your database with the correct full path
    const fileRow = await db.insert(filesTable).values({ location: fullPath }).returning().get();
    const fileToUserRow = await db.insert(userFilesTable).values({ userId, fileId: fileRow.id }).returning().get();

    return {
      userId: fileToUserRow.userId,
      fileId: fileToUserRow.fileId,
      location: fileRow.location
    };
  } catch (error) {
    console.error('Error uploading from file input:', error);
    throw error;
  }
};

export const uploadFileFromBlob = async (blob: Blob, userId: string, destinationFolder?: string) => {
  const file = new File([blob], 'fog', { type: blob.type });
  return await uploadFileFromInput(file, userId, destinationFolder);
};

// We don't bother storing any user db records for the fog of war files
export const uploadFogFromBlob = async (sceneId: string, blob: Blob) => {
  try {
    const file = new File([blob], 'fog', { type: blob.type });
    const fileType = 'image/png';
    const fileName = `${sceneId}.png`;
    const fileBuffer = await file.arrayBuffer();
    const contentLength = fileBuffer.byteLength;

    const fullPath = await uploadToR2(Buffer.from(fileBuffer), fileName, fileType, 'fog', contentLength, false);
    return fullPath;
  } catch (error) {
    console.error('Error uploading fog from blob:', error);
    throw error;
  }
};

// Upload scene thumbnail with sceneId naming
export const uploadSceneThumbnailFromBlob = async (sceneId: string, blob: Blob) => {
  try {
    const file = new File([blob], 'thumbnail', { type: blob.type });
    const fileType = 'image/jpeg';
    const fileName = `${sceneId}.jpg`;
    const fileBuffer = await file.arrayBuffer();
    const contentLength = fileBuffer.byteLength;

    const fullPath = await uploadToR2(Buffer.from(fileBuffer), fileName, fileType, 'thumbnail', contentLength, false);
    return fullPath;
  } catch (error) {
    console.error('Error uploading scene thumbnail from blob:', error);
    throw error;
  }
};

export const uploadSceneMapFromFile = async (_sceneId: string, file: File, userId: string) =>
  uploadFileFromInput(file, userId, 'map');

export const uploadMarkerImageFromFile = async (_markerId: string, file: File, userId: string) =>
  uploadFileFromInput(file, userId, 'marker');

export const getFile = async (fileId: number) => {
  try {
    const fileRow = await db.select().from(filesTable).where(eq(filesTable.id, fileId)).get();
    if (!fileRow) {
      throw new Error(`File with ID ${fileId} found`);
    }
    return fileRow;
  } catch (error) {
    console.log('Error getting file from table', error);
    throw error;
  }
};

export const getR2FileInfo = async (fileName: string) => {
  if (isLocalStorage()) {
    const info = await statLocalAsset(fileName);
    return { ContentType: mime.getType(fileName) || undefined, ContentLength: info.size, LastModified: info.mtime };
  }
  try {
    const getObjectParams = {
      Bucket: CLOUDFLARE_BUCKET_NAME,
      Key: fileName
    };

    const result = await r2.send(new GetObjectCommand(getObjectParams));

    return {
      ContentType: result.ContentType,
      ContentLength: result.ContentLength,
      LastModified: result.LastModified
    };
  } catch (error) {
    console.error('Error fetching asset info from R2:', error);
    throw error;
  }
};

export const generatePresignedReadUrl = async (fileName: string): Promise<string> => {
  if (isLocalStorage()) return localAssetUrl(fileName);
  const command = new GetObjectCommand({
    Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME!,
    Key: fileName
  });

  const signedUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });
  return signedUrl;
};

export const generatePresignedWriteUrl = async (fileName: string, contentType: string): Promise<string> => {
  if (isLocalStorage()) return signedLocalUploadUrl(fileName, contentType);
  const command = new PutObjectCommand({
    Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME!,
    Key: fileName,
    ContentType: contentType
  });

  const signedUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });
  return signedUrl;
};

const removeUploadedObject = async (key: string) => {
  if (isLocalStorage()) await unlink(localAssetPath(key));
  else await r2.send(new DeleteObjectCommand({ Bucket: CLOUDFLARE_BUCKET_NAME, Key: key }));
};

const readUploadedObject = async (key: string, contentType: string) => {
  const limit = mediaUploadLimit(contentType);
  if (isLocalStorage()) {
    if ((await statLocalAsset(key)).size > limit) throw new Error('Upload exceeds the size limit');
    return readLocalAsset(key);
  }
  const object = await r2.send(new GetObjectCommand({ Bucket: CLOUDFLARE_BUCKET_NAME, Key: key }));
  if (!object.Body) throw new Error('Uploaded file is missing');
  if ((object.ContentLength ?? 0) > limit) {
    (object.Body as Readable).destroy();
    throw new Error('Upload exceeds the size limit');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of object.Body as Readable) {
    size += chunk.length;
    if (size > limit) {
      (object.Body as Readable).destroy();
      throw new Error('Upload exceeds the size limit');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

export const storeImportedArtwork = async (data: Buffer, contentType: string, userId: string) => {
  validateMediaUpload({ type: contentType, size: data.length }, true);
  await validateStoredMedia(data, contentType);
  const extension = mime.getExtension(contentType);
  if (!extension) throw new Error('Unsupported artwork type');
  const location = `originals/${userId}/${randomUUID()}.${extension}`;
  await uploadToR2(data, location, contentType, undefined, data.length);
  try {
    const row = await db.transaction(async (tx) => {
      const file = await tx.insert(filesTable).values({ location }).returning().get();
      await tx.insert(userFilesTable).values({ userId, fileId: file.id });
      return file;
    });
    return row.location;
  } catch (error) {
    await removeUploadedObject(location).catch((cleanupError) =>
      console.warn('Imported artwork cleanup failed', cleanupError)
    );
    throw error;
  }
};

export const createUserFileFromLocation = async (location: string, userId: string) => {
  if (
    !location.startsWith(`uploads/${userId}/`) ||
    !/^uploads\/[a-zA-Z0-9_-]+\/[a-f0-9-]+\.[a-z0-9]+$/.test(location)
  ) {
    throw new Error('Unauthorized');
  }
  const contentType = mime.getType(location) || '';
  const data = await readUploadedObject(location, contentType);
  await validateStoredMedia(data, contentType);
  const original = `originals/${userId}/${generateRandomFileName(location)}`;
  await uploadToR2(data, original, contentType, undefined, data.length);
  try {
    const result = await db.transaction(async (tx) => {
      const row = await tx.insert(filesTable).values({ location: original }).returning().get();
      await tx.insert(userFilesTable).values({ userId, fileId: row.id });
      return { userId, fileId: row.id, location: original };
    });
    await removeUploadedObject(location).catch((error) => console.warn('Staged upload cleanup failed', error));
    return result;
  } catch (error) {
    await removeUploadedObject(original).catch((cleanupError) =>
      console.warn('Failed upload cleanup failed', cleanupError)
    );
    throw error;
  }
};

/**
 * Copy a file in R2 storage to a new location
 * @param sourceKey - The source file path in R2
 * @param destinationKey - The destination file path in R2
 * @returns The destination key if successful
 */
export const copyR2File = async (sourceKey: string, destinationKey: string): Promise<string> => {
  if (isLocalStorage()) return copyLocalAsset(sourceKey, destinationKey);
  try {
    const copyObjectParams = {
      Bucket: CLOUDFLARE_BUCKET_NAME,
      CopySource: `${CLOUDFLARE_BUCKET_NAME}/${sourceKey}`,
      Key: destinationKey
    };

    await r2.send(new CopyObjectCommand(copyObjectParams));
    return destinationKey;
  } catch (error) {
    console.error('Error copying file in R2:', error);
    throw error;
  }
};

/**
 * Copy a scene's map file to a new scene
 * @param sourceLocation - The source file location (may include ?v=X versioning)
 * @param newSceneId - The new scene ID to use for the filename
 * @param folder - The folder to copy to (e.g., 'map', 'thumbnail')
 * @returns The new file location with ?v=1
 */
export const copySceneFile = async (
  sourceLocation: string,
  newSceneId: string,
  folder: 'map' | 'thumbnail'
): Promise<string> => {
  try {
    // Strip any query parameters (like ?v=1) from the source location
    const sourceKey = sourceLocation.split('?')[0];

    // Extract the file extension from the source
    const extensionMatch = sourceKey.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[1] : 'jpg';

    // Create the new file key with the new scene ID
    const destinationKey = `${folder}/${newSceneId}.${extension}`;

    // Copy the file in R2
    await copyR2File(sourceKey, destinationKey);

    // Return the new location with version 1
    return `${destinationKey}?v=1`;
  } catch (error) {
    console.error(`Error copying scene ${folder} file:`, error);
    throw error;
  }
};

export const readCatalogCache = async (location: string): Promise<Buffer | null> => {
  if (!location.startsWith('catalog/5etools/')) throw new Error('Invalid catalog cache path');
  try {
    if (isLocalStorage()) {
      if ((await statLocalAsset(location)).size > 10 * 1024 * 1024)
        throw new Error('Catalog cache exceeds the size limit');
      return readLocalAsset(location);
    }
    const object = await r2.send(new GetObjectCommand({ Bucket: CLOUDFLARE_BUCKET_NAME, Key: location }));
    if (!object.Body) return null;
    if ((object.ContentLength ?? 0) > 10 * 1024 * 1024) {
      (object.Body as Readable).destroy();
      throw new Error('Catalog cache exceeds the size limit');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of object.Body as Readable) {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) {
        (object.Body as Readable).destroy();
        throw new Error('Catalog cache exceeds the size limit');
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    const missing = error as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } };
    if (missing.code === 'ENOENT' || missing.name === 'NoSuchKey' || missing.$metadata?.httpStatusCode === 404)
      return null;
    throw error;
  }
};

export const writeCatalogCache = async (location: string, data: Buffer) => {
  if (!/^catalog\/5etools\/[a-f0-9]{64}\/(?:latest|[a-f0-9]{64})\.json$/.test(location))
    throw new Error('Invalid catalog cache path');
  if (data.length > 10 * 1024 * 1024) throw new Error('Catalog cache exceeds the size limit');
  return uploadToR2(data, location, 'application/json', undefined, data.length, false);
};
