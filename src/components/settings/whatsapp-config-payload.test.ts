import { describe, expect, it } from 'vitest';
import { MASKED_CREDENTIAL } from '@/lib/whatsapp/masked-credential';
import { buildWhatsAppCredentialPayload } from './whatsapp-config-payload';

describe('buildWhatsAppCredentialPayload', () => {
  it('requires an Access Token for a new configuration', () => {
    expect(
      buildWhatsAppCredentialPayload({
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
});
