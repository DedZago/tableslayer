export type HandoutSource =
  | { type: 'asset'; id: string; artwork: 'portrait' | 'token' }
  | { type: 'upload'; location: string }
  | { type: 'marker'; sceneId: string; markerId: string; location: string };
