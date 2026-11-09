import * as THREE from 'three';
import { patchMapMaterial, type GroundUniforms } from './groundPatch';

const PROBE_RELEASE_MS = 1500;

interface GroundProgramOptions {
  renderer: THREE.WebGLRenderer;
  getScene: () => THREE.Scene;
  getCamera: () => THREE.Camera;
  /** The map's MeshBasicMaterial; the visible program is never replaced until the new one is linked */
  material: THREE.MeshBasicMaterial;
  uniforms: GroundUniforms;
}

/**
 * Switches the map material between ground programs without a blank frame or a stalled compile.
 * The next program is linked off-thread on a probe material patched with the same signature (three shares
 * programs by cache key), and only then does the real material adopt it. The probe stays alive a moment
 * after the swap so the shared program survives until the real material has acquired it.
 */
export const createGroundProgramSwitcher = ({
  renderer,
  getScene,
  getCamera,
  material,
  uniforms
}: GroundProgramOptions) => {
  const geometry = new THREE.PlaneGeometry();
  const compileTarget = new THREE.WebGLRenderTarget(1, 1);
  const pendingProbes = new Map<ReturnType<typeof setTimeout>, THREE.Material>();
  let generation = 0;
  let appliedKey: string | null = null;
  let disposed = false;

  patchMapMaterial(material, '', uniforms);

  const adopt = (signature: string) => {
    patchMapMaterial(material, signature, uniforms);
    material.needsUpdate = true;
  };

  const compileProbe = (probe: THREE.MeshBasicMaterial, rendersToTarget: boolean) => {
    const previousTarget = renderer.getRenderTarget();
    if (rendersToTarget) renderer.setRenderTarget(compileTarget);
    const compiled = renderer.compileAsync(new THREE.Mesh(geometry, probe), getCamera(), getScene());
    if (rendersToTarget) renderer.setRenderTarget(previousTarget);
    return compiled;
  };

  const retire = (probe: THREE.Material) => {
    const timer = setTimeout(() => {
      pendingProbes.delete(timer);
      probe.dispose();
    }, PROBE_RELEASE_MS);
    pendingProbes.set(timer, probe);
  };

  const request = (signature: string, rendersToTarget: boolean) => {
    const key = `${signature}#${rendersToTarget}`;
    if (disposed || key === appliedKey) return;
    const current = ++generation;
    if (!signature) {
      appliedKey = key;
      adopt(signature);
      return;
    }
    // Without a map the program would lack USE_MAP and link a second time once the map loads
    if (!material.map) return;
    const probe = new THREE.MeshBasicMaterial({ map: material.map });
    patchMapMaterial(probe, signature, uniforms);
    compileProbe(probe, rendersToTarget)
      .catch(() => {})
      .finally(() => {
        if (disposed || current !== generation) {
          probe.dispose();
          return;
        }
        appliedKey = key;
        adopt(signature);
        retire(probe);
      });
  };

  const dispose = () => {
    disposed = true;
    pendingProbes.forEach((probe, timer) => {
      clearTimeout(timer);
      probe.dispose();
    });
    pendingProbes.clear();
    geometry.dispose();
    compileTarget.dispose();
  };

  return { request, dispose };
};
