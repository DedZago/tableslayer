<script lang="ts">
  import chroma from 'chroma-js';
  import * as THREE from 'three';
  import { T, useTask, useThrelte } from '@threlte/core';
  import { getContext, onDestroy, untrack } from 'svelte';
  import { atmoDelta, hash32, type AtmosphereEvent } from '../../helpers/atmosphereEvents';
  import { mapClippingPlaneStore } from '../../helpers/clippingPlaneStore.svelte';
  import lightningBoltFragment from '../../shaders/atmosphere/lightningBolt.frag?raw';
  import lightningBoltVertex from '../../shaders/atmosphere/lightningBolt.vert?raw';
  import lightningMeteorFragment from '../../shaders/atmosphere/lightningMeteor.frag?raw';
  import lightningMeteorVertex from '../../shaders/atmosphere/lightningMeteor.vert?raw';
  import lightningPuffFragment from '../../shaders/atmosphere/lightningPuff.frag?raw';
  import lightningPuffVertex from '../../shaders/atmosphere/lightningPuff.vert?raw';
  import noiseChunk from '../../shaders/atmosphere/noise.glsl?raw';
  import lightningRingFragment from '../../shaders/atmosphere/lightningRing.frag?raw';
  import lightningRingVertex from '../../shaders/atmosphere/lightningRing.vert?raw';
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';
  import type { CameraShake } from '../SpellCastLayer/types';
  import { programLinked, writeClippingPlanes } from './air/airMaterials';
  import {
    FALLBACK_BOLT_FLOATS,
    appendBoltRibbon,
    createRibbonBuffers,
    writeFallbackBolt,
    type RibbonCursor
  } from './air/lightningRibbon';
  import type { AtmosphereBolt } from './atmosphereController.svelte';
  import type { AtmosphereSubLayerProps } from './types';

  /**
   * Lightning at SceneLayerOrder.Lightning (38.6) on SceneLayer.Main so bloom catches the HDR cores. One ribbon
   * mesh draws every active bolt from preallocated buffers (rebuilt only when a bolt arrives or its polyline
   * returns) and one instanced quad draws the impact rings; the life envelope is computed in the shader from
   * the shared atmosphere clock, so it stays in step with the flash. Optional camera shake on strikes. Also draws
   * the other discrete events: surge bolts (worker polylines like lightning, coloured by the event hue), meteors with their impact ring, and
   * tremor dust puffs with a rumble shake.
   */
  const props: AtmosphereSubLayerProps = $props();
  const controller = untrack(() => props.controller);
  const composed = $derived(props.composed);
  const mapSize = $derived(props.mapSize);
  const screenScale = $derived(props.screenScale);

  const { renderer, camera, scene } = useThrelte();
  const stage = getContext<{ mainPassUsesComposer: boolean }>('stage');
  const cameraShake = getContext<CameraShake | undefined>('cameraShake');

  const CORE_HALF_WIDTH_PX = 1.05;
  const GLOW_SCALE = 7;
  const MAX_RINGS = 8;
  const RING_RADIUS_MAP_HEIGHT = 0.11;
  const FALLBACK_AFTER_SEC = 0.1;
  const SHAKE_SEC = 0.25;
  const TREMOR_SHAKE_SEC = 0.8;
  const MAX_METEORS = 6;
  const MAX_PUFF_BURSTS = 3;
  const PUFFS_PER_BURST = 12;
  const METEOR_LINGER_SEC = 0.4;
  const METEOR_RUN = 1.1;
  const PUFF_LIFE_SEC = 2.2;
  const METEOR_WIDTH_PX = 16;
  const METEOR_COLOR: [number, number, number] = [1, 0.62, 0.25];
  const DUST_COLOR = [0.5, 0.4, 0.28];
  const NUM_CLIPPING_PLANES = 4;
  const NEUTRAL_COLOR: [number, number, number] = [0.78, 0.86, 1];

  const buffers = createRibbonBuffers();
  const cursor: RibbonCursor = { vertices: 0, indices: 0 };
  const fallbackScratch = new Float32Array(FALLBACK_BOLT_FLOATS);
  const builtIds: number[] = [];
  const builtHasVertices: boolean[] = [];
  let builtMapKey = '';
  let builtCount = -1;

  const attributes = {
    position: new THREE.BufferAttribute(buffers.position, 3),
    aPerp: new THREE.BufferAttribute(buffers.perp, 2),
    aVert: new THREE.BufferAttribute(buffers.vert, 3),
    aBolt: new THREE.BufferAttribute(buffers.bolt, 3),
    aColor: new THREE.BufferAttribute(buffers.color, 3)
  };
  const indexAttribute = new THREE.BufferAttribute(buffers.index, 1);
  const boltGeometry = new THREE.BufferGeometry();
  Object.entries(attributes).forEach(([name, attribute]) => {
    attribute.setUsage(THREE.DynamicDrawUsage);
    boltGeometry.setAttribute(name, attribute);
  });
  indexAttribute.setUsage(THREE.DynamicDrawUsage);
  boltGeometry.setIndex(indexAttribute);
  boltGeometry.setDrawRange(0, 0);

  const ringBase = new THREE.PlaneGeometry(1, 1);
  const ringGeometry = new THREE.InstancedBufferGeometry();
  ringGeometry.index = ringBase.index;
  ringGeometry.setAttribute('position', ringBase.getAttribute('position'));
  const ringStrike = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 3), 3);
  const ringColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 3), 3);
  const ringIntensity = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS), 1);
  [ringStrike, ringColor, ringIntensity].forEach((attribute) => attribute.setUsage(THREE.DynamicDrawUsage));
  ringGeometry.setAttribute('aStrike', ringStrike);
  ringGeometry.setAttribute('aColor', ringColor);
  ringGeometry.setAttribute('aIntensity', ringIntensity);
  ringGeometry.instanceCount = 0;

  const createClipping = () => Array.from({ length: NUM_CLIPPING_PLANES }, () => new THREE.Vector4());

  const boltMaterial = new THREE.ShaderMaterial({
    defines: { NUM_CLIPPING_PLANES },
    uniforms: {
      uAtmoTime: controller.uniforms.uAtmoTime,
      uCoreHalfWidth: { value: 1 },
      uGlowScale: { value: GLOW_SCALE },
      uMapHeight: { value: 1 },
      uGain: { value: 1 },
      uHdr: { value: 1 },
      uClippingPlanes: new THREE.Uniform(createClipping())
    },
    vertexShader: lightningBoltVertex,
    fragmentShader: lightningBoltFragment,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor
  });
  const ringMaterial = new THREE.ShaderMaterial({
    defines: { NUM_CLIPPING_PLANES },
    uniforms: {
      uAtmoTime: controller.uniforms.uAtmoTime,
      uRadius: { value: 1 },
      uGain: { value: 1 },
      uHdr: { value: 1 },
      uClippingPlanes: new THREE.Uniform(createClipping())
    },
    vertexShader: lightningRingVertex,
    fragmentShader: lightningRingFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor
  });
  const meteorBase = new THREE.PlaneGeometry(1, 1);
  const meteorGeometry = new THREE.InstancedBufferGeometry();
  meteorGeometry.index = meteorBase.index;
  meteorGeometry.setAttribute('position', meteorBase.getAttribute('position'));
  const meteorStrike = new THREE.InstancedBufferAttribute(new Float32Array(MAX_METEORS * 3), 3);
  const meteorParams = new THREE.InstancedBufferAttribute(new Float32Array(MAX_METEORS * 3), 3);
  const meteorColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_METEORS * 3), 3);
  const meteorAttributes = [meteorStrike, meteorParams, meteorColor];
  meteorGeometry.setAttribute('aStrike', meteorStrike);
  meteorGeometry.setAttribute('aMeteor', meteorParams);
  meteorGeometry.setAttribute('aColor', meteorColor);
  meteorGeometry.instanceCount = 0;

  const puffBase = new THREE.PlaneGeometry(1, 1);
  const puffGeometry = new THREE.InstancedBufferGeometry();
  puffGeometry.index = puffBase.index;
  puffGeometry.setAttribute('position', puffBase.getAttribute('position'));
  const puffCapacity = MAX_PUFF_BURSTS * PUFFS_PER_BURST;
  const puffStrike = new THREE.InstancedBufferAttribute(new Float32Array(puffCapacity * 3), 3);
  const puffSeed = new THREE.InstancedBufferAttribute(new Float32Array(puffCapacity), 1);
  const puffAttributes = [puffStrike, puffSeed];
  puffGeometry.setAttribute('aStrike', puffStrike);
  puffGeometry.setAttribute('aSeed', puffSeed);
  puffGeometry.instanceCount = 0;
  [...meteorAttributes, ...puffAttributes].forEach((attribute) => attribute.setUsage(THREE.DynamicDrawUsage));

  const meteorMaterial = new THREE.ShaderMaterial({
    defines: { NUM_CLIPPING_PLANES },
    uniforms: {
      uAtmoTime: controller.uniforms.uAtmoTime,
      uMapHeight: { value: 1 },
      uWidth: { value: 10 },
      uGain: { value: 1 },
      uHdr: { value: 1 },
      uClippingPlanes: new THREE.Uniform(createClipping())
    },
    vertexShader: lightningMeteorVertex,
    fragmentShader: lightningMeteorFragment,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor
  });
  const puffMaterial = new THREE.ShaderMaterial({
    defines: { NUM_CLIPPING_PLANES, ATMO_OCTAVES: 2 },
    uniforms: {
      uAtmoTime: controller.uniforms.uAtmoTime,
      uMapHeight: { value: 1 },
      uDustColor: { value: new THREE.Vector3(...DUST_COLOR) },
      uAmbientTint: controller.uniforms.uAmbientTint,
      uAmbientExposure: controller.uniforms.uAmbientExposure,
      uDarkness: controller.uniforms.uDarkness,
      uClippingPlanes: new THREE.Uniform(createClipping())
    },
    vertexShader: lightningPuffVertex,
    fragmentShader: `${noiseChunk}\n${lightningPuffFragment}`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor
  });
  boltMaterial.visible = false;
  ringMaterial.visible = false;
  meteorMaterial.visible = false;
  puffMaterial.visible = false;

  interface MeteorShot {
    x: number;
    y: number;
    time: number;
    angle: number;
    travel: number;
    intensity: number;
    impact: boolean;
  }
  interface DustBurst {
    x: number;
    y: number;
    time: number;
    seed: number;
  }
  const meteors: MeteorShot[] = [];
  const dustBursts: DustBurst[] = [];
  const allBolts: AtmosphereBolt[] = [];
  let eventsDirty = false;
  let shakeSeconds = SHAKE_SEC;
  let shakeFrequency = 1;

  let boltMesh = $state.raw<THREE.Mesh>();
  let ringMesh = $state.raw<THREE.Mesh>();
  let meteorMesh = $state.raw<THREE.Mesh>();
  let puffMesh = $state.raw<THREE.Mesh>();
  let probeTarget: THREE.WebGLRenderTarget | null = null;
  let compileRun = 0;
  let linked = false;
  let shakeStart = 0;
  let shakeAmplitude = 0;
  let shaking = false;

  const mapWidth = $derived(mapSize.width);
  const mapHeight = $derived(mapSize.height);
  const hdr = $derived(composed.safety.hdrBolts);
  const gain = $derived(Math.min(1, Math.max(0.3, composed.safety.flashScale / 0.6)));
  const shakeAllowed = $derived(composed.safety.shake);
  const rendersToTarget = $derived(stage.mainPassUsesComposer);

  $effect(() => {
    const scale = Math.max(screenScale, 1e-4);
    boltMaterial.uniforms.uCoreHalfWidth.value = CORE_HALF_WIDTH_PX / scale;
    ringMaterial.uniforms.uRadius.value = RING_RADIUS_MAP_HEIGHT * mapHeight;
    boltMaterial.uniforms.uMapHeight.value = mapHeight;
    meteorMaterial.uniforms.uMapHeight.value = mapHeight;
    meteorMaterial.uniforms.uWidth.value = METEOR_WIDTH_PX / scale;
    puffMaterial.uniforms.uMapHeight.value = mapHeight;
  });

  $effect(() => {
    boltMaterial.uniforms.uGain.value = gain;
    ringMaterial.uniforms.uGain.value = gain;
    meteorMaterial.uniforms.uGain.value = Math.max(0.5, gain);
    meteorMaterial.uniforms.uHdr.value = hdr ? 2.2 : 1;
    boltMaterial.uniforms.uHdr.value = hdr ? 3 : 1;
    ringMaterial.uniforms.uHdr.value = hdr ? 2.4 : 1;
  });

  $effect(() => {
    writeClippingPlanes(boltMaterial, mapClippingPlaneStore.value);
    writeClippingPlanes(ringMaterial, mapClippingPlaneStore.value);
    writeClippingPlanes(meteorMaterial, mapClippingPlaneStore.value);
    writeClippingPlanes(puffMaterial, mapClippingPlaneStore.value);
  });

  $effect(() => {
    const toTarget = rendersToTarget;
    const run = ++compileRun;
    untrack(() => {
      probeTarget ??= new THREE.WebGLRenderTarget(1, 1);
      const previous = renderer.getRenderTarget();
      if (toTarget) renderer.setRenderTarget(probeTarget);
      const pairs: [THREE.BufferGeometry, THREE.ShaderMaterial][] = [
        [boltGeometry, boltMaterial],
        [ringGeometry, ringMaterial],
        [meteorGeometry, meteorMaterial],
        [puffGeometry, puffMaterial]
      ];
      const probes = pairs.map(([geometry, material]) => new THREE.Mesh(geometry, material));
      const compiled = probes.map((probe) => renderer.compileAsync(probe, camera.current, scene));
      renderer.setRenderTarget(previous);
      Promise.all(compiled)
        .then(() => pairs.map(([, material]) => programLinked(renderer, material)))
        .catch((error) => {
          console.error('[atmosphere] compiling lightning failed', error);
          return [false, false, false, false];
        })
        .then((results) => {
          if (run !== compileRun) return;
          if (results.some((result) => result === false))
            console.error('[atmosphere] a lightning shader failed to link; its effect stays hidden');
          linked = results.every((result) => result !== false);
          [boltMaterial, ringMaterial, meteorMaterial, puffMaterial].forEach((material) => (material.visible = linked));
        });
    });
  });

  $effect(() => {
    if (!shakeAllowed || !cameraShake) return;
    const startShake = (amplitude: number, seconds: number, frequency: number) => {
      shakeStart = performance.now();
      shakeAmplitude = amplitude;
      shakeSeconds = seconds;
      shakeFrequency = frequency;
      shaking = true;
    };
    const unsubscribe = controller.onBolt((bolts) =>
      startShake(2 + 2 * (bolts[0]?.event.intensity ?? 0.5), SHAKE_SEC, 1)
    );
    const unsubscribeEvents = controller.onEvent((event) => {
      if (event.kind === 'surge') startShake(2 + 2 * event.intensity, SHAKE_SEC, 1);
      if (event.kind === 'tremor') startShake(2 + 2 * event.intensity, TREMOR_SHAKE_SEC, 1.6);
    });
    return () => {
      unsubscribe();
      unsubscribeEvents();
      shaking = false;
      if (cameraShake) {
        cameraShake.x = 0;
        cameraShake.y = 0;
      }
    };
  });

  const takeEvent = (event: AtmosphereEvent) => {
    const x = (event.u - 0.5) * mapWidth;
    const y = (event.v - 0.5) * mapHeight;
    if (event.kind === 'meteor') {
      const h = hash32(event.boltSeed ^ 0x3c6ef372);
      const angle = ((205 + (h / 4294967296) * 50) * Math.PI) / 180;
      const endU = event.u + (Math.cos(angle) * METEOR_RUN * mapHeight) / (2 * mapWidth);
      const endV = event.v + (Math.sin(angle) * METEOR_RUN) / 2;
      const lands = endU > 0.06 && endU < 0.94 && endV > 0.06 && endV < 0.94;
      meteors.push({
        x,
        y,
        time: event.time,
        angle,
        travel: 0.8 + 0.3 * (hash32(h) / 4294967296),
        intensity: event.intensity,
        impact: lands && h % 3 === 0
      });
      if (meteors.length > MAX_METEORS) meteors.shift();
    } else if (event.kind === 'tremor') {
      dustBursts.push({ x, y, time: event.time, seed: (event.boltSeed % 997) + 1 });
      if (dustBursts.length > MAX_PUFF_BURSTS) dustBursts.shift();
    } else return;
    eventsDirty = true;
  };

  $effect(() => controller.onEvent(takeEvent));

  const expireEvents = (atmoTime: number) => {
    const before = meteors.length + dustBursts.length;
    for (let i = meteors.length - 1; i >= 0; i--)
      if (atmoDelta(atmoTime, meteors[i].time) > meteors[i].travel + METEOR_LINGER_SEC + (meteors[i].impact ? 0.45 : 0))
        meteors.splice(i, 1);
    for (let i = dustBursts.length - 1; i >= 0; i--)
      if (atmoDelta(atmoTime, dustBursts[i].time) > PUFF_LIFE_SEC) dustBursts.splice(i, 1);
    if (meteors.length + dustBursts.length !== before) eventsDirty = true;
  };

  const writeEventBuffers = () => {
    meteors.forEach((meteor, index) => {
      meteorStrike.array.set([meteor.x, meteor.y, meteor.time], index * 3);
      meteorParams.array.set([meteor.angle, meteor.travel, meteor.intensity], index * 3);
      meteorColor.array.set(METEOR_COLOR, index * 3);
    });
    meteorGeometry.instanceCount = meteors.length;
    let puffs = 0;
    dustBursts.forEach((burst) => {
      for (let i = 0; i < PUFFS_PER_BURST; i++, puffs++) {
        puffStrike.array.set([burst.x, burst.y, burst.time], puffs * 3);
        puffSeed.array[puffs] = burst.seed + i * 0.37;
      }
    });
    puffGeometry.instanceCount = puffs;
    [...meteorAttributes, ...puffAttributes].forEach((attribute) => {
      attribute.clearUpdateRanges();
      attribute.needsUpdate = true;
    });
  };

  const boltColor = (bolt: AtmosphereBolt): [number, number, number] =>
    bolt.event.hue >= 0
      ? (chroma.hsl(bolt.event.hue, 0.9, 0.72).gl().slice(0, 3) as [number, number, number])
      : NEUTRAL_COLOR;

  const canDraw = (bolt: AtmosphereBolt, ageSec: number) =>
    bolt.vertices !== null || controller.backend === 'analytic' || ageSec >= FALLBACK_AFTER_SEC;

  const boltVertices = (bolt: AtmosphereBolt, ageSec: number) => {
    if (bolt.vertices) return bolt.vertices;
    if (!canDraw(bolt, ageSec)) return null;
    return writeFallbackBolt(fallbackScratch, bolt.seed, bolt.x0, bolt.y0, bolt.x1, bolt.y1);
  };

  const rebuild = (bolts: readonly AtmosphereBolt[], atmoTime: number) => {
    cursor.vertices = 0;
    cursor.indices = 0;
    let rings = 0;
    for (const bolt of bolts) {
      const vertices = boltVertices(bolt, atmoDelta(atmoTime, bolt.startedAt));
      const color = boltColor(bolt);
      if (vertices) {
        appendBoltRibbon(
          buffers,
          cursor,
          { vertices, startedAt: bolt.startedAt, seed: bolt.seed, intensity: bolt.event.intensity, color },
          mapWidth,
          mapHeight
        );
      }
      if (rings < MAX_RINGS) {
        ringStrike.array[rings * 3] = (bolt.x1 - 0.5) * mapWidth;
        ringStrike.array[rings * 3 + 1] = (bolt.y1 - 0.5) * mapHeight;
        ringStrike.array[rings * 3 + 2] = bolt.startedAt;
        ringColor.array.set(color, rings * 3);
        ringIntensity.array[rings] = bolt.event.intensity;
        rings++;
      }
    }
    for (const meteor of meteors) {
      if (!meteor.impact || rings >= MAX_RINGS) continue;
      ringStrike.array[rings * 3] = meteor.x + (Math.cos(meteor.angle) * METEOR_RUN * mapHeight) / 2;
      ringStrike.array[rings * 3 + 1] = meteor.y + (Math.sin(meteor.angle) * METEOR_RUN * mapHeight) / 2;
      ringStrike.array[rings * 3 + 2] = (meteor.time + meteor.travel) % 3600;
      ringColor.array.set(METEOR_COLOR, rings * 3);
      ringIntensity.array[rings] = meteor.intensity;
      rings++;
    }
    writeEventBuffers();
    for (const attribute of Object.values(attributes)) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, cursor.vertices * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    indexAttribute.clearUpdateRanges();
    indexAttribute.addUpdateRange(0, cursor.indices);
    indexAttribute.needsUpdate = true;
    boltGeometry.setDrawRange(0, cursor.indices);
    [ringStrike, ringColor, ringIntensity].forEach((attribute) => {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, rings * attribute.itemSize);
      attribute.needsUpdate = true;
    });
    ringGeometry.instanceCount = rings;
  };

  const needsRebuild = (bolts: readonly AtmosphereBolt[], atmoTime: number, mapKey: string) => {
    if (bolts.length !== builtCount || mapKey !== builtMapKey) return true;
    for (let i = 0; i < bolts.length; i++) {
      const hasVertices = canDraw(bolts[i], atmoDelta(atmoTime, bolts[i].startedAt));
      if (bolts[i].id !== builtIds[i] || hasVertices !== builtHasVertices[i]) return true;
    }
    return false;
  };

  useTask(() => {
    const atmoTime = controller.uniforms.uAtmoTime.value;
    expireEvents(atmoTime);
    allBolts.length = 0;
    allBolts.push(...controller.activeBolts);
    const bolts = allBolts;
    const mapKey = `${mapWidth}x${mapHeight}`;
    if (eventsDirty || needsRebuild(bolts, atmoTime, mapKey)) {
      eventsDirty = false;
      rebuild(bolts, atmoTime);
      builtCount = bolts.length;
      builtMapKey = mapKey;
      for (let i = 0; i < bolts.length; i++) {
        builtIds[i] = bolts[i].id;
        builtHasVertices[i] = canDraw(bolts[i], atmoDelta(atmoTime, bolts[i].startedAt));
      }
    }
    const visible = cursor.indices > 0;
    if (boltMesh) boltMesh.visible = visible;
    if (ringMesh) ringMesh.visible = ringGeometry.instanceCount > 0;
    if (meteorMesh) meteorMesh.visible = meteorGeometry.instanceCount > 0;
    if (puffMesh) puffMesh.visible = puffGeometry.instanceCount > 0;

    if (shaking && cameraShake) {
      const elapsed = (performance.now() - shakeStart) / 1000;
      if (elapsed >= shakeSeconds) {
        shaking = false;
        cameraShake.x = 0;
        cameraShake.y = 0;
      } else {
        const decay = (1 - elapsed / shakeSeconds) ** 2;
        cameraShake.x = Math.cos(elapsed * 130 * shakeFrequency) * shakeAmplitude * decay;
        cameraShake.y = Math.sin(elapsed * 170 * shakeFrequency + 1.3) * shakeAmplitude * decay;
      }
    }
  });

  onDestroy(() => {
    compileRun++;
    if (cameraShake) {
      cameraShake.x = 0;
      cameraShake.y = 0;
    }
    boltGeometry.dispose();
    ringGeometry.dispose();
    ringBase.dispose();
    boltMaterial.dispose();
    ringMaterial.dispose();
    meteorGeometry.dispose();
    puffGeometry.dispose();
    meteorBase.dispose();
    puffBase.dispose();
    meteorMaterial.dispose();
    puffMaterial.dispose();
    probeTarget?.dispose();
  });
</script>

<T.Mesh
  bind:ref={boltMesh}
  geometry={boltGeometry}
  renderOrder={SceneLayerOrder.Lightning}
  layers={[SceneLayer.Main]}
  frustumCulled={false}
  visible={false}
>
  <T.ShaderMaterial is={boltMaterial} attach="material" />
</T.Mesh>

<T.Mesh
  bind:ref={ringMesh}
  geometry={ringGeometry}
  renderOrder={SceneLayerOrder.Lightning + 0.01}
  layers={[SceneLayer.Main]}
  frustumCulled={false}
  visible={false}
>
  <T.ShaderMaterial is={ringMaterial} attach="material" />
</T.Mesh>

<T.Mesh
  bind:ref={meteorMesh}
  geometry={meteorGeometry}
  renderOrder={SceneLayerOrder.Lightning + 0.02}
  layers={[SceneLayer.Main]}
  frustumCulled={false}
  visible={false}
>
  <T.ShaderMaterial is={meteorMaterial} attach="material" />
</T.Mesh>

<T.Mesh
  bind:ref={puffMesh}
  geometry={puffGeometry}
  renderOrder={SceneLayerOrder.Lightning + 0.03}
  layers={[SceneLayer.Main]}
  frustumCulled={false}
  visible={false}
>
  <T.ShaderMaterial is={puffMaterial} attach="material" />
</T.Mesh>
