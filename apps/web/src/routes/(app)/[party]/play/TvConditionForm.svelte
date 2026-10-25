<script lang="ts">
  import { Button, Input } from '@tableslayer/ui';
  import { CUSTOM_CONDITION_COLORS } from '$lib/utils/markerConditionPicker';

  let {
    position,
    onAdd,
    onCancel
  }: {
    position: { x: number; y: number };
    onAdd: (label: string, color: string) => void;
    onCancel: () => void;
  } = $props();

  const MAX_LABEL = 24;
  let label = $state('');
  let color = $state(CUSTOM_CONDITION_COLORS[0]);

  // Faces the nearest screen edge, like the radial menu it was opened from
  const rotation = $derived.by(() => {
    const distances = [window.innerHeight - position.y, window.innerWidth - position.x, position.y, position.x];
    return [0, -90, -180, -270][distances.indexOf(Math.min(...distances))];
  });
  const clamped = $derived({
    x: Math.max(200, Math.min(window.innerWidth - 200, position.x)),
    y: Math.max(200, Math.min(window.innerHeight - 200, position.y))
  });

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (label.trim()) onAdd(label, color);
  };
</script>

<div class="tvConditionForm">
  <button class="tvConditionForm__backdrop" type="button" aria-label="Cancel" onclick={onCancel}></button>
  <form
    class="tvConditionForm__panel"
    style:left="{clamped.x}px"
    style:top="{clamped.y}px"
    style:transform="translate(-50%, -50%) rotate({rotation}deg)"
    onsubmit={submit}
  >
    <span class="tvConditionForm__title">New condition</span>
    <Input maxlength={MAX_LABEL} placeholder="Name, e.g. Hexed" aria-label="Condition name" bind:value={label} />
    <div class="tvConditionForm__colors" role="radiogroup" aria-label="Condition color">
      {#each CUSTOM_CONDITION_COLORS as swatch (swatch)}
        <button
          type="button"
          role="radio"
          aria-checked={color === swatch}
          aria-label={swatch}
          class={['tvConditionForm__swatch', color === swatch && 'tvConditionForm__swatch--selected']}
          style:background-color={swatch}
          onclick={() => (color = swatch)}
        ></button>
      {/each}
    </div>
    <div class="tvConditionForm__actions">
      <Button type="button" variant="ghost" onclick={onCancel}>Cancel</Button>
      <Button type="submit" isDisabled={!label.trim()}>Add</Button>
    </div>
  </form>
</div>

<style>
  .tvConditionForm {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }

  .tvConditionForm__backdrop {
    position: absolute;
    inset: 0;
    padding: 0;
    background: color-mix(in srgb, var(--bg) 25%, transparent);
    border: none;
  }

  .tvConditionForm__panel {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 20rem;
    padding: 1rem;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--fgMuted);
    border-radius: 0.75rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .tvConditionForm__title {
    font-size: 1rem;
    font-weight: 700;
  }

  .tvConditionForm__colors {
    display: flex;
    justify-content: space-between;
  }

  .tvConditionForm__swatch {
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 2px solid var(--bg);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--fgMuted);
    cursor: pointer;
  }

  .tvConditionForm__swatch--selected {
    box-shadow: 0 0 0 3px var(--fg);
  }

  .tvConditionForm__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
