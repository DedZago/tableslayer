import type { HandoutDescriptor, SessionDocClient } from '$lib/realtime';
import type { HandoutSource } from '$lib/server/handouts/types';

export type HandoutPreview = { source: HandoutSource; artworkLocation: string; title: string };
export type HandoutControlsProps = {
  partyId: string;
  client: SessionDocClient | null;
  bucketUrl: string;
  preview: HandoutPreview | null;
  onPreviewChange: (preview: HandoutPreview | null) => void;
};
export type HandoutImageProps = { artworkLocation: string; title?: string | null; bucketUrl: string };

export type HandoutOverlayProps = { handout: HandoutDescriptor; bucketUrl: string };
