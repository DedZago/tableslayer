import type { MarkerRow } from '$lib/realtime';
import { getGridCellSize, getMapSpaceDisplay, GridMode, type StageProps } from '@tableslayer/stage';
import {
  TOKEN_CLIPBOARD_FORMAT,
  tokenClipboardSchema,
  type ClipboardGrant,
  type ClipboardPoint,
  type TokenClipboard
} from './tokenClipboardSchema';

export * from './tokenClipboardSchema';
export type ClipboardGeometry = {
  cell: number | null;
  displayScale: number;
  rotation: number;
  mapDefined: boolean;
};

export const getClipboardGeometry = (
  props: StageProps,
  mapSize: { width: number; height: number } | null
): ClipboardGeometry => {
  const requestedMapDefined = props.grid.gridMode === GridMode.MapDefined;
  const mapDefined = requestedMapDefined && mapSize !== null;
  const display = mapDefined && mapSize ? getMapSpaceDisplay(props.grid, mapSize, props.display) : props.display;
  const cell = getGridCellSize(props.grid, display);
  return {
    cell: (!requestedMapDefined || !!mapSize) && Number.isFinite(cell) && cell > 0 ? cell : null,
    displayScale: mapDefined ? props.map.zoom : 1,
    rotation: props.map.rotation,
    mapDefined
  };
};

const rotate = (point: ClipboardPoint, degrees: number): ClipboardPoint => {
  const angle = (degrees * Math.PI) / 180;
  return {
    x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle)
  };
};

export const createTokenClipboard = (
  markers: MarkerRow[],
  geometry: ClipboardGeometry,
  grant: ClipboardGrant
): TokenClipboard => {
  if (!markers.length) throw new Error('Select tokens to copy');
  const anchor = {
    x:
      (Math.min(...markers.map((marker) => marker.positionX)) +
        Math.max(...markers.map((marker) => marker.positionX))) /
      2,
    y:
      (Math.min(...markers.map((marker) => marker.positionY)) +
        Math.max(...markers.map((marker) => marker.positionY))) /
      2
  };
  const tokens = markers.map((marker) => {
    const delta = { x: marker.positionX - anchor.x, y: marker.positionY - anchor.y };
    const local = geometry.mapDefined ? delta : rotate(delta, -geometry.rotation);
    return {
      title: marker.title,
      label: marker.label,
      imageLocation: marker.imageLocation,
      imageScale: marker.imageScale,
      shape: marker.shape,
      shapeColor: marker.shapeColor,
      size: marker.size,
      visibility: marker.visibility,
      note: JSON.parse(JSON.stringify(marker.note)),
      assetId: marker.assetId ?? null,
      offset: geometry.cell ? { x: local.x / geometry.cell, y: local.y / geometry.cell } : local,
      displayOffset: { x: local.x * geometry.displayScale, y: local.y * geometry.displayScale }
    };
  });
  return tokenClipboardSchema.parse({
    format: TOKEN_CLIPBOARD_FORMAT,
    version: 1,
    ...grant,
    basis: geometry.cell ? 'grid' : 'display',
    anchor,
    tokens
  });
};

export const tokenPastePositions = (
  clipboard: TokenClipboard,
  geometry: ClipboardGeometry,
  pointer: ClipboardPoint,
  snap: (point: ClipboardPoint) => ClipboardPoint,
  repetition: number
): ClipboardPoint[] => {
  const step = geometry.cell ?? 40 / geometry.displayScale;
  const repeatOffset = { x: step * repetition, y: -step * repetition };
  const shift = geometry.mapDefined ? repeatOffset : rotate(repeatOffset, geometry.rotation);
  const anchor = snap({ x: pointer.x + shift.x, y: pointer.y + shift.y });
  return clipboard.tokens.map((token) => {
    const delta =
      clipboard.basis === 'grid' && geometry.cell
        ? { x: token.offset.x * geometry.cell, y: token.offset.y * geometry.cell }
        : { x: token.displayOffset.x / geometry.displayScale, y: token.displayOffset.y / geometry.displayScale };
    const rotated = geometry.mapDefined ? delta : rotate(delta, geometry.rotation);
    return { x: anchor.x + rotated.x, y: anchor.y + rotated.y };
  });
};

export const clipboardTargetIsEditable = (target: EventTarget | null): boolean =>
  typeof Element !== 'undefined' &&
  target instanceof Element &&
  !!target.closest(
    'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
  );
