import * as THREE from 'three';
import type { Size } from '../../../types';
import type { IMapDataSource } from './IMapDataSource';

/**
 * Data source for loading static images as textures in a 3D scene.
 *
 * This class implements the IMapDataSource interface to provide static image
 * loading capabilities for map layers. It uses Three.js TextureLoader to load
 * various image formats and create textures suitable for 3D rendering.
 */
export class ImageDataSource implements IMapDataSource {
  /** The loaded texture from the image file */
  private texture: THREE.Texture | null = null;
  /** Dimensions of the loaded image */
  private size: Size | null = null;

  /**
   * Gets the Three.js texture containing the loaded image.
   *
   * @returns The texture with the loaded image, or null if not loaded
   */
  getTexture(): THREE.Texture | null {
    return this.texture;
  }

  /**
   * Gets the dimensions of the loaded image.
   *
   * @returns The width and height of the image, or null if not loaded
   */
  getSize(): Size | null {
    return this.size;
  }

  /**
   * Loads an image from a URL and creates a texture.
   *
   * Decodes off the main thread with createImageBitmap (falls back to
   * TextureLoader where unavailable). The bitmap is flipped at decode time
   * because WebGL ignores UNPACK_FLIP_Y for ImageBitmap sources. Colour
   * profiles are converted by the browser, matching the HTMLImageElement path
   * (three's ImageBitmapLoader forces colorSpaceConversion 'none').
   *
   * @param url - The URL of the image file to load
   * @returns A promise that resolves when the image is loaded and ready
   * @throws Error if the image cannot be loaded or processed
   */
  async load(url: string): Promise<void> {
    this.dispose();

    try {
      if (typeof createImageBitmap === 'undefined') {
        const texture = await new THREE.TextureLoader().loadAsync(url);
        texture.colorSpace = THREE.SRGBColorSpace;
        this.texture = texture;
        this.size = { width: texture.image.width, height: texture.image.height };
        return;
      }

      const response = await fetch(url, { mode: 'cors', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Map image request failed: ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob(), {
        imageOrientation: 'flipY',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'default'
      });
      const texture = new THREE.Texture(bitmap);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      this.texture = texture;
      this.size = { width: bitmap.width, height: bitmap.height };
    } catch (error) {
      console.error('Failed to load image:', error);
      throw error;
    }
  }

  /**
   * Disposes of the loaded texture and resets internal state.
   *
   * This method closes the decoded bitmap, cleans up the Three.js texture to prevent
   * memory leaks, and resets the size information.
   */
  dispose(): void {
    if (this.texture) {
      const image = this.texture.image as unknown;
      if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
      this.texture.dispose();
      this.texture = null;
    }
    this.size = null;
  }
}
