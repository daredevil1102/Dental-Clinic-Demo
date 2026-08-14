import { MASKED_CREDENTIAL } from '@/lib/whatsapp/masked-credential';

type CredentialInput = {
  hasExistingConfig: boolean;
  accessToken: string;
  tokenEdited: boolean;
  appSecret: string;
  appSecretEdited: boolean;
  verifyToken: string;
  verifyTokenEdited: boolean;
};

type CredentialError =
  | 'access_token_initial_required'
  | 'access_token_reentry_required'
  | 'app_secret_required';

type CredentialResult =
  | {
      ok: true;
      payload: {
        access_token: string;
        app_secret?: string;
        verify_token?: string;
      };
    }
  | { ok: false; error: CredentialError };

/**
 * Decides which credentials leave the browser on a save.
 *
 * One rule governs all three fields: a value is submitted only when the user
 * actually replaced it, and the mask is never submitted. Omission means "keep
 * what is stored" — the server treats an absent key as unchanged.
 *
 * They differ only in what omission is allowed to mean:
 *
 *   access_token  Never optional. The server re-verifies with Meta on every
 *                 save, so it must be re-entered even for an unrelated edit.
 *   app_secret    Required on create (§5.1.1). Omitted on update preserves the
 *                 stored ciphertext, and preserves a grandfathered NULL.
 *   verify_token  Optional everywhere — a connection may legitimately have
 *                 none. Omission preserves whatever is stored.
 *
 * `verify_token` used to be sent unconditionally as `value || null` while the
 * field rendered blank for an existing connection, so *any* save erased a
 * working token. Meta only reads that token when re-verifying a callback URL,
 * so the damage stayed invisible until the next re-verification failed. There
 * is deliberately no way to clear a stored token from here — that needs an
 * explicit control, not a blank box.
 */
export function buildWhatsAppCredentialPayload({
  hasExistingConfig,
  accessToken,
  tokenEdited,
  appSecret,
  appSecretEdited,
  verifyToken,
  verifyTokenEdited,
}: CredentialInput): CredentialResult {
  const submittedAccessToken =
    tokenEdited && accessToken !== MASKED_CREDENTIAL ? accessToken.trim() : '';

  if (!submittedAccessToken) {
    return {
      ok: false,
      error: hasExistingConfig
        ? 'access_token_reentry_required'
        : 'access_token_initial_required',
    };
  }

  const submittedAppSecret =
    appSecretEdited && appSecret !== MASKED_CREDENTIAL ? appSecret.trim() : '';

  if (!hasExistingConfig && !submittedAppSecret) {
    return { ok: false, error: 'app_secret_required' };
  }

  const submittedVerifyToken =
    verifyTokenEdited && verifyToken !== MASKED_CREDENTIAL
      ? verifyToken.trim()
      : '';

  const payload: {
    access_token: string;
    app_secret?: string;
    verify_token?: string;
  } = {
    access_token: submittedAccessToken,
  };

  if (submittedAppSecret) payload.app_secret = submittedAppSecret;
  if (submittedVerifyToken) payload.verify_token = submittedVerifyToken;

  return { ok: true, payload };
}
