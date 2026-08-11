import { MASKED_CREDENTIAL } from '@/lib/whatsapp/masked-credential';

type CredentialInput = {
  hasExistingConfig: boolean;
  accessToken: string;
  tokenEdited: boolean;
  appSecret: string;
  appSecretEdited: boolean;
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
      };
    }
  | { ok: false; error: CredentialError };

export function buildWhatsAppCredentialPayload({
  hasExistingConfig,
  accessToken,
  tokenEdited,
  appSecret,
  appSecretEdited,
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

  const payload: { access_token: string; app_secret?: string } = {
    access_token: submittedAccessToken,
  };

  if (submittedAppSecret) payload.app_secret = submittedAppSecret;

  return { ok: true, payload };
}
