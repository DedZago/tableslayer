<script>
  import { IconKeyboard } from '@tabler/icons-svelte';
  import { Icon, Button, Hr, Popover } from '@tableslayer/ui';
  import { onMount } from 'svelte';

  let hasTouchSupport = $state(false);
  let isMac = $state(false);

  onMount(() => {
    hasTouchSupport = navigator.maxTouchPoints > 0 || 'ontouchstart' in document.documentElement;
    isMac = /mac/i.test(navigator.platform);
  });

  const shortcuts = $derived([
    { label: 'Undo', shortcut: isMac ? 'Cmd + Z' : 'Ctrl + Z' },
    { label: 'Redo', shortcut: isMac ? 'Cmd + Shift + Z' : 'Ctrl + Shift + Z' },
    { divider: true },
    { label: 'Brush size', shortcut: 'Mouse wheel' },
    { label: 'Erase brush', shortcut: 'E' },
    { label: 'Add brush', shortcut: 'Shift + E' },
    { divider: true },
    { label: 'Erase rectangle', shortcut: 'R' },
    { label: 'Add rectangle', shortcut: 'Shift + R' },
    { label: 'Erase ellipse', shortcut: 'O' },
    { label: 'Add ellipse', shortcut: 'Shift + O' },
    { divider: true },
    { label: 'Fog room tool', shortcut: 'P' },
    { label: 'Complete fog room', shortcut: hasTouchSupport ? 'Double tap' : 'Enter' },
    { label: 'Cancel fog room', shortcut: 'Esc' },
    { label: 'Toggle fog room', shortcut: hasTouchSupport ? 'Double tap room' : 'Right-click room' },
    { label: 'Delete fog room', shortcut: hasTouchSupport ? 'Hold on room' : 'Delete + hover' },
    { divider: true },
    { label: 'Clear fog', shortcut: 'F' },
    { label: 'Reset fog', shortcut: 'Shift + F' },
    { divider: true },
    { label: 'Unlock markers', shortcut: 'M' },
    { label: 'Lock markers', shortcut: 'Shift + M' },
    { divider: true },
    { label: 'Copy selected tokens', shortcut: isMac ? 'Cmd + C' : 'Ctrl + C' },
    { label: 'Paste tokens', shortcut: isMac ? 'Cmd + V' : 'Ctrl + V' },
    { label: 'Select all tokens', shortcut: isMac ? 'Cmd + A' : 'Ctrl + A' },
    { label: 'Move selected tokens', shortcut: 'Drag a selected token' },
    { label: 'Clear selection', shortcut: 'Esc' },
    { label: 'Unlock lights', shortcut: 'L' },
    { label: 'Lock lights', shortcut: 'Shift + L' },
    { divider: true },
    { label: 'Toggle measurement', shortcut: 'T' },
    { label: 'Toggle drawing', shortcut: 'D' },
    { label: 'Toggle AoE templates', shortcut: 'A' },
    { label: 'Cycle AoE shape', shortcut: 'Shift + A' },
    { label: 'Rotate AoE template 15°', shortcut: '[ / ]' },
    { label: 'Rotate AoE template 45°', shortcut: 'Shift + [ / ]' },
    { label: 'Delete AoE template', shortcut: 'Delete' },
    { label: 'Delete selected tokens', shortcut: 'Delete' },
    { label: 'Group the selection, or ungroup it', shortcut: 'B' },
    { divider: true },
    { label: 'Start combat or add tokens', shortcut: 'I' },
    { label: 'Remove selected tokens from combat', shortcut: 'Shift + I' },
    { label: 'Next turn', shortcut: 'N' },
    { label: 'Previous turn', shortcut: 'Shift + N' },
    { divider: true },
    { label: 'Scale map', shortcut: hasTouchSupport ? 'Three finger pinch' : 'Shift + Mouse wheel' },
    ...(hasTouchSupport
      ? [{ label: 'Pan map drag', shortcut: 'Three finger drag' }]
      : [
          { label: 'Select tokens', shortcut: 'Shift + Mouse drag' },
          { label: 'Toggle token selection', shortcut: 'Shift + Click' }
        ]),
    { label: 'Pan map direction', shortcut: 'Shift + Arrow keys' },
    { divider: true },
    { label: 'Zoom scene', shortcut: hasTouchSupport ? 'Two finger pinch' : 'Ctrl + Mouse wheel' },
    { label: 'Pan scene', shortcut: hasTouchSupport ? 'Two finger drag' : 'Ctrl + Mouse drag' },
    { divider: true },
    { label: 'Performance stats', shortcut: 'F9' }
  ]);
</script>

<div class="shortcut">
  <Popover>
    {#snippet trigger()}
      <Button as="div" variant="ghost" class="shortcut__button">
        {#snippet start()}
          <Icon Icon={IconKeyboard} size="1.5rem" />
        {/snippet}
        Shortcuts
      </Button>
    {/snippet}
    {#snippet content()}
      <ul class="shortcut__list">
        {#each shortcuts as { label, shortcut, divider }}
          {#if divider}
            <li class="shortcut__listDivider">
              <Hr />
            </li>
          {:else}
            <li class="shortcut__listItem">
              <div>{label}</div>
              <span class="shortcut__key">{shortcut}</span>
            </li>
          {/if}
        {/each}
      </ul>
    {/snippet}
  </Popover>
</div>

<style>
  :global {
    .shortcut__button {
      text-shadow:
        0 0 2px rgba(0, 0, 0, 0.8),
        0 0 8px rgba(0, 0, 0, 0.5);
    }
  }
  .shortcut {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    z-index: 1;
  }
  .shortcut__listItem {
    display: flex;
    justify-content: space-between;
    gap: 2.5rem;
    padding: 0.25rem 0.5rem;
    white-space: nowrap;
    font-size: 0.875rem;
  }
  .shortcut__listDivider {
    padding: 0.25rem 0;
  }
  .shortcut__listItem:hover {
    background: var(--contrastLow);
  }
  .shortcut__key {
    color: var(--fgMuted);
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }

  @container stageWrapper (max-width: 768px) {
    .shortcut {
      display: none;
    }
  }
</style>
