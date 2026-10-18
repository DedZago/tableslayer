import { describe, expect, it } from 'vitest';
import { isLayoutSymbolKey } from './stageKeyCommands';

const keyEvent = (key: string, modifiers: Partial<KeyboardEvent> = {}, altGraph = false) =>
  ({
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    getModifierState: (state: string) => state === 'AltGraph' && altGraph,
    ...modifiers
  }) as unknown as KeyboardEvent;

describe('isLayoutSymbolKey', () => {
  it('lets AltGr brackets through (Windows reports Ctrl+Alt)', () => {
    expect(isLayoutSymbolKey(keyEvent('[', { ctrlKey: true, altKey: true }, true))).toBe(true);
    expect(isLayoutSymbolKey(keyEvent(']', { ctrlKey: true, altKey: true }))).toBe(true);
    expect(isLayoutSymbolKey(keyEvent('{', { ctrlKey: true, altKey: true, shiftKey: true }))).toBe(true);
  });

  it('lets Option brackets through on macOS', () => {
    expect(isLayoutSymbolKey(keyEvent('[', { altKey: true }))).toBe(true);
  });

  it('blocks plain Ctrl and Cmd shortcuts', () => {
    expect(isLayoutSymbolKey(keyEvent('[', { ctrlKey: true }))).toBe(false);
    expect(isLayoutSymbolKey(keyEvent('[', { metaKey: true }))).toBe(false);
  });

  it('never lets other keys through', () => {
    expect(isLayoutSymbolKey(keyEvent('z', { ctrlKey: true }))).toBe(false);
    expect(isLayoutSymbolKey(keyEvent('f', { ctrlKey: true, altKey: true }, true))).toBe(false);
    expect(isLayoutSymbolKey(keyEvent('€', { ctrlKey: true, altKey: true }, true))).toBe(false);
  });
});
