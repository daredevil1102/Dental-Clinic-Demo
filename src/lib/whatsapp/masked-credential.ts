/**
 * The placeholder the settings UI renders in place of a stored credential.
 *
 * Write-only credential fields (access token, App Secret) are never sent to
 * the browser — the form shows this mask instead, and the user must paste a
 * complete replacement value to change one. The client only submits a field
 * when it was actually edited to something other than this string.
 *
 * Shared so the server can reject it too: the client-side guard is a
 * convenience, not a boundary. Persisting the mask would overwrite a working
 * credential with sixteen bullet characters (claude-01 §5.1.1).
 */
export const MASKED_CREDENTIAL = '••••••••••••••••'
