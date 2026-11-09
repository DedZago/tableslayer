import * as THREE from 'three';

/**
 * Links a ShaderMaterial's program off the main thread (KHR_parallel_shader_compile) on a probe mesh.
 * three keys programs on whether the output is a render target, so the probe binds a 1x1 target when the
 * layer will render through the composer.
 */
export const compileShaderMaterial = (
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  material: THREE.Material,
  geometry: THREE.BufferGeometry,
  probeTarget: THREE.WebGLRenderTarget,
  rendersToTarget: boolean
) => {
  const previousTarget = renderer.getRenderTarget();
  if (rendersToTarget) renderer.setRenderTarget(probeTarget);
  const compiled = renderer.compileAsync(new THREE.Mesh(geometry, material), camera, scene);
  if (rendersToTarget) renderer.setRenderTarget(previousTarget);
  return compiled.catch(() => {});
};
