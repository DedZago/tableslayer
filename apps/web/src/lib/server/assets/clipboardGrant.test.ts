import { describe, expect, it } from 'vitest';
import { signClipboardGrant, verifyClipboardGrant } from './clipboardGrant';

describe('durable same-deployment clipboard artwork grants', () => {
  it('authorizes copied originals without source-token IDs or expiry', () => {
    const grant = signClipboardGrant(['originals/a.png', 'originals/b.png'], 'secret');
    expect(() => verifyClipboardGrant(grant, ['originals/b.png'], 'secret')).not.toThrow();
    expect(signClipboardGrant([], 'secret').deploymentId).toBe(grant.deploymentId);
    expect(grant.mediaGrant).not.toContain('secret');
  });

  it('rejects foreign deployments and artwork not present in the grant', () => {
    const grant = signClipboardGrant(['originals/a.png'], 'secret');
    expect(() => verifyClipboardGrant(grant, ['originals/other.png'], 'secret')).toThrow('unauthorized artwork');
    expect(() => verifyClipboardGrant(grant, ['originals/a.png'], 'other-deployment')).toThrow('another deployment');
  });

  it('rejects altered claims, deployment IDs and malformed signatures', () => {
    const grant = signClipboardGrant(['originals/a.png'], 'secret');
    const [, signature] = grant.mediaGrant.split('.');
    const forged = Buffer.from(
      JSON.stringify({ deploymentId: grant.deploymentId, locations: ['originals/private.png'] })
    ).toString('base64url');
    expect(() =>
      verifyClipboardGrant({ ...grant, mediaGrant: `${forged}.${signature}` }, ['originals/private.png'], 'secret')
    ).toThrow();
    expect(() => verifyClipboardGrant({ ...grant, deploymentId: 'foreign' }, [], 'secret')).toThrow();
    expect(() => verifyClipboardGrant({ ...grant, mediaGrant: 'malformed' }, [], 'secret')).toThrow();
  });
});
