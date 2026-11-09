import lightChunk from '../../../shaders/atmosphere/groundLight.glsl?raw';

export const darknessVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Writes the token lighting; with dst * src blending it multiplies everything drawn so far
export const darknessFragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  ${lightChunk}

  void main() {
    gl_FragColor = vec4(atmoLitToken(vUv, atmoFlashAmount(vUv)), 1.0);
    #include <colorspace_fragment>
  }
`;
