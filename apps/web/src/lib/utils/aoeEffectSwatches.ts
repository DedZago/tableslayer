import { AoeEffect } from '@tableslayer/stage';

// Picker order: the first entry is the plain (no effect) fill
export const AOE_EFFECT_ORDER: AoeEffect[] = [
  AoeEffect.None,
  AoeEffect.Fire,
  AoeEffect.Lightning,
  AoeEffect.Frost,
  AoeEffect.PoisonGas,
  AoeEffect.Thorns,
  AoeEffect.Mud,
  AoeEffect.Darkness,
  AoeEffect.FogCloud,
  AoeEffect.Web,
  AoeEffect.Grease,
  AoeEffect.Radiant,
  AoeEffect.Necrotic,
  AoeEffect.Force,
  AoeEffect.Water,
  AoeEffect.SleetStorm,
  AoeEffect.InsectSwarm,
  AoeEffect.Acid
];

// Static CSS previews for the effect picker. Live WebGL previews would each cost a GL context.
export const AOE_EFFECT_SWATCHES: Record<AoeEffect, string> = {
  [AoeEffect.None]: 'linear-gradient(135deg, #5c6370, #9aa3b0)',
  [AoeEffect.Fire]: 'linear-gradient(135deg, #5a0d00, #ff7a1a 60%, #fff3a0)',
  [AoeEffect.Lightning]: 'linear-gradient(135deg, #0b1d4d, #3a7bff 60%, #e6f1ff)',
  [AoeEffect.Frost]: 'linear-gradient(135deg, #bfe9ff, #7fd3f0 60%, #f2fbff)',
  [AoeEffect.PoisonGas]: 'linear-gradient(135deg, #1d3b10, #6bc62c 60%, #c9f58a)',
  [AoeEffect.Thorns]: 'linear-gradient(135deg, #1f2a12, #4f7a2a 60%, #8b5a2b)',
  [AoeEffect.Mud]: 'linear-gradient(135deg, #3b2a17, #7a5530 60%, #b08a58)',
  [AoeEffect.Darkness]: 'linear-gradient(135deg, #000000, #1b0b2a 60%, #3d1f5c)',
  [AoeEffect.FogCloud]: 'linear-gradient(135deg, #8d939c, #d7dbe0 60%, #f4f6f8)',
  [AoeEffect.Web]: 'repeating-linear-gradient(45deg, #e8e8e8 0 2px, #7a7a7a 2px 4px)',
  [AoeEffect.Grease]: 'linear-gradient(135deg, #1a1a1a, #5b3d7a 45%, #2f7a6a 70%, #c49b2a)',
  [AoeEffect.Radiant]: 'radial-gradient(circle, #fff6c2, #ffc845 60%, #b87a10)',
  [AoeEffect.Necrotic]: 'linear-gradient(135deg, #0c140a, #3e6b2e 60%, #a6d66a)',
  [AoeEffect.Force]: 'linear-gradient(135deg, #3a1f6b, #8f6fe0 60%, #d9ccff)',
  [AoeEffect.Water]: 'linear-gradient(135deg, #0a4a57, #1ea3a8 60%, #9fe8e6)',
  [AoeEffect.SleetStorm]: 'linear-gradient(135deg, #6f7a85, #c6d3dd 60%, #ffffff)',
  [AoeEffect.InsectSwarm]: 'linear-gradient(135deg, #2a1d10, #6b4a22 60%, #9b7a45)',
  [AoeEffect.Acid]: 'linear-gradient(135deg, #3d4a00, #b6dc1e 60%, #f2ff7a)'
};
