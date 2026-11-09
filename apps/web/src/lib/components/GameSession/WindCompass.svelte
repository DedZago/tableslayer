<script lang="ts">
  let {
    angle,
    onAngleChange
  }: {
    /** Degrees in map space: 0 = toward the map right, 90 = toward the map top */
    angle: number;
    onAngleChange: (angle: number) => void;
  } = $props();

  let dial: HTMLDivElement | undefined = $state();

  const setFromPointer = (event: PointerEvent) => {
    if (!dial) return;
    const bounds = dial.getBoundingClientRect();
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = bounds.top + bounds.height / 2 - event.clientY;
    const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
    onAngleChange(Math.round((degrees + 360) % 360));
  };

  const onPointerDown = (event: PointerEvent) => {
    dial?.setPointerCapture(event.pointerId);
    setFromPointer(event);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (dial?.hasPointerCapture(event.pointerId)) setFromPointer(event);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 15 : 5;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') onAngleChange((Math.round(angle) - step + 360) % 360);
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onAngleChange((Math.round(angle) + step) % 360);
    else return;
    event.preventDefault();
  };
</script>

<div
  bind:this={dial}
  class="windCompass"
  role="slider"
  tabindex="0"
  aria-label="Wind direction"
  aria-valuemin={0}
  aria-valuemax={359}
  aria-valuenow={Math.round(angle)}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onkeydown={onKeyDown}
>
  <span class="windCompass__mark windCompass__mark--top">Top</span>
  <span class="windCompass__mark windCompass__mark--right">Right</span>
  <div class="windCompass__needle" style:transform="rotate({-angle}deg)">
    <span class="windCompass__head"></span>
  </div>
  <span class="windCompass__hub"></span>
</div>

<style>
  .windCompass {
    position: relative;
    width: 4.5rem;
    height: 4.5rem;
    border: var(--borderThin);
    border-radius: 50%;
    background: var(--contrastLowest);
    cursor: pointer;
    touch-action: none;
    flex-shrink: 0;
  }
  .windCompass:focus-visible {
    outline: 2px solid var(--fgPrimary);
    outline-offset: 2px;
  }
  .windCompass__mark {
    position: absolute;
    font-size: 0.5rem;
    text-transform: uppercase;
    color: var(--fgMuted);
    pointer-events: none;
  }
  .windCompass__mark--top {
    top: 0.125rem;
    left: 50%;
    transform: translateX(-50%);
  }
  .windCompass__mark--right {
    right: 0.125rem;
    top: 50%;
    transform: translateY(-50%);
  }
  .windCompass__needle {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .windCompass__needle::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 42%;
    height: 2px;
    background: var(--fgPrimary);
    transform: translateY(-50%);
  }
  .windCompass__head {
    position: absolute;
    top: 50%;
    right: 8%;
    width: 0.5rem;
    height: 0.5rem;
    border-top: 2px solid var(--fgPrimary);
    border-right: 2px solid var(--fgPrimary);
    transform: translateY(-50%) rotate(45deg);
  }
  .windCompass__hub {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
    background: var(--fg);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
</style>
