import { describe, expect, it } from 'vitest';
import { MASKED_CREDENTIAL } from '@/lib/whatsapp/masked-credential';
import { buildWhatsAppCredentialPayload } from './whatsapp-config-payload';

/**
 * Untouched-field defaults. Every case overrides only what it is about, so a
 * test that says nothing about the verify token is asserting the behaviour of
 * a form the user never touched there — which is the case that used to wipe it.
 */
const untouched = {
  verifyToken: MASKED_CREDENTIAL,
  verifyTokenEdited: false,
};

describe('buildWhatsAppCredentialPayload', () => {
  it('requires an Access Token for a new configuration', () => {
    expect(
      buildWhatsAppCredentialPayload({
        ...untouched,
        hasExistingConfig: false,
        accessToken: '',
        tokenEdited: false,
        appSecret: 'new-app-secret',
        appSecretEdited: true,
      })
    ).toEqual({ ok: false, error: 'access_token_initial_required' });
  });

  it('requires both credentials for a new configuration', () => {
    expect(
      buildWhatsAppCredentialPayload({
        ...untouched,
        hasExistingConfig: false,
        accessToken: 'new-access-token',
        tokenEdited: true,
        appSecret: '',
        appSecretEdited: false,
      })
    ).toEqual({ ok: false, error: 'app_secret_required' });
  });

  it('asks for the Access Token when an existing configuration has neither credential re-entered', () => {
    expect(
      buildWhatsAppCredentialPayload({
        ...untouched,
        hasExistingConfig: true,
        accessToken: MASKED_CREDENTIAL,
        tokenEdited: false,
        appSecret: MASKED_CREDENTIAL,
        appSecretEdited: false,
      })
    ).toEqual({ ok: false, error: 'access_token_reentry_required' });
  });

  it('asks for the Access Token when only the App Secret was re-entered', () => {
    expect(
      buildWhatsAppCredentialPayload({
        ...untouched,
        hasExistingConfig: true,
        accessToken: MASKED_CREDENTIAL,
        tokenEdited: false,
        appSecret: 'replacement-secret',
        appSecretEdited: true,
      })
    ).toEqual({ ok: false, error: 'access_token_reentry_required' });
  });

  it('submits an Access Token without overwriting the stored App Secret', () => {
    expect(
      buildWhatsAppCredentialPayload({
        ...untouched,
        hasExistingConfig: true,
        accessToken: 'replacement-access-token',
        tokenEdited: true,
        appSecret: MASKED_CREDENTIAL,
        appSecretEdited: false,
      })
    ).toEqual({
      ok: true,
      payload: { access_token: 'replacement-access-token' },
    });
  });

  it('submits both credentials when both were re-entered', () => {
    expect(
      buildWhatsAppCredentialPayload({
        ...untouched,
        hasExistingConfig: true,
        accessToken: ' replacement-access-token ',
        tokenEdited: true,
        appSecret: ' replacement-secret ',
        appSecretEdited: true,
      })
    ).toEqual({
      ok: true,
      payload: {
        access_token: 'replacement-access-token',
        app_secret: 'replacement-secret',
      },
    });
  });

  it('never submits the masked Access Token placeholder', () => {
    expect(
      buildWhatsAppCredentialPayload({
        ...untouched,
        hasExistingConfig: true,
        accessToken: MASKED_CREDENTIAL,
        tokenEdited: true,
        appSecret: '',
        appSecretEdited: false,
      })
    ).toEqual({ ok: false, error: 'access_token_reentry_required' });
  });

  it('never submits the masked App Secret placeholder', () => {
    expect(
      buildWhatsAppCredentialPayload({
        ...untouched,
        hasExistingConfig: true,
        accessToken: 'replacement-access-token',
        tokenEdited: true,
        appSecret: MASKED_CREDENTIAL,
        appSecretEdited: true,
      })
    ).toEqual({
      ok: true,
      payload: { access_token: 'replacement-access-token' },
    });
  });

  // --- Verify Token -------------------------------------------------------
  // The regression these lock in: a save that touches nothing else must not
  // erase a stored verify token. Omission is the mechanism — an absent key
  // means "unchanged" server-side.

  it('omits the Verify Token when the field was never touched', () => {
    const result = buildWhatsAppCredentialPayload({
      hasExistingConfig: true,
      accessToken: 'replacement-access-token',
      tokenEdited: true,
      appSecret: MASKED_CREDENTIAL,
      appSecretEdited: false,
      verifyToken: MASKED_CREDENTIAL,
      verifyTokenEdited: false,
    });
    expect(result).toEqual({
      ok: true,
      payload: { access_token: 'replacement-access-token' },
    });
    // Explicit: the key is absent, not present-and-null.
    expect(result.ok && 'verify_token' in result.payload).toBe(false);
  });

  it('never submits the masked Verify Token placeholder', () => {
    const result = buildWhatsAppCredentialPayload({
      hasExistingConfig: true,
      accessToken: 'replacement-access-token',
      tokenEdited: true,
      appSecret: MASKED_CREDENTIAL,
      appSecretEdited: false,
      verifyToken: MASKED_CREDENTIAL,
      verifyTokenEdited: true,
    });
    expect(result.ok && 'verify_token' in result.payload).toBe(false);
  });

  it('omits the Verify Token when the field was cleared but left empty', () => {
    const result = buildWhatsAppCredentialPayload({
      hasExistingConfig: true,
      accessToken: 'replacement-access-token',
      tokenEdited: true,
      appSecret: MASKED_CREDENTIAL,
      appSecretEdited: false,
      verifyToken: '   ',
      verifyTokenEdited: true,
    });
    // Blanking the box is not a way to delete a stored token — that would
    // need an explicit control, and silently deleting is the original bug.
    expect(result.ok && 'verify_token' in result.payload).toBe(false);
  });

  it('submits a re-entered Verify Token, trimmed', () => {
    expect(
      buildWhatsAppCredentialPayload({
        hasExistingConfig: true,
        accessToken: 'replacement-access-token',
        tokenEdited: true,
        appSecret: MASKED_CREDENTIAL,
        appSecretEdited: false,
        verifyToken: '  rotated-verify-token  ',
        verifyTokenEdited: true,
      })
    ).toEqual({
      ok: true,
      payload: {
        access_token: 'replacement-access-token',
        verify_token: 'rotated-verify-token',
      },
    });
  });

  it('submits a Verify Token entered on a brand-new connection', () => {
    expect(
      buildWhatsAppCredentialPayload({
        hasExistingConfig: false,
        accessToken: 'new-access-token',
        tokenEdited: true,
        appSecret: 'new-app-secret',
        appSecretEdited: true,
        verifyToken: 'brand-new-verify-token',
        verifyTokenEdited: true,
      })
    ).toEqual({
      ok: true,
      payload: {
        access_token: 'new-access-token',
        app_secret: 'new-app-secret',
        verify_token: 'brand-new-verify-token',
      },
    });
  });

  it('allows a brand-new connection with no Verify Token at all', () => {
    const result = buildWhatsAppCredentialPayload({
      hasExistingConfig: false,
      accessToken: 'new-access-token',
      tokenEdited: true,
      appSecret: 'new-app-secret',
      appSecretEdited: true,
      verifyToken: '',
      verifyTokenEdited: false,
    });
    // A verify token is optional in the domain, unlike the App Secret.
    expect(result).toEqual({
      ok: true,
      payload: {
        access_token: 'new-access-token',
        app_secret: 'new-app-secret',
      },
    });
  });
});
