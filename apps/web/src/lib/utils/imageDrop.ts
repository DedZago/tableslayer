import { validateMediaUpload } from './mediaUpload';

export const hasFileDrop = (transfer: DataTransfer | null) => !!transfer?.types.includes('Files');
export const hasWebsiteImageDrop = (transfer: DataTransfer | null) =>
  !!transfer && (transfer.types.includes('text/uri-list') || !!transfer.getData('text/html'));
export const WEBSITE_IMAGE_DROP_MESSAGE = 'Save the image, then drop the image file here';

export const singleDroppedImage = (files: FileList | File[]) => {
  if (files.length !== 1) throw new Error('Drop one image file to replace token artwork');
  const file = files[0];
  validateMediaUpload(file, true);
  return file;
};
