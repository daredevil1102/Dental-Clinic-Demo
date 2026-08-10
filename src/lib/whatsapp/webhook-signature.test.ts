import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaWebhookSignature } from "./webhook-signature";

const SECRET = process.env.META_APP_SECRET!;

function signedHeader(body: string, secret: string = SECRET): string {
  const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hex}`;
}

describe("verifyMetaWebhookSignature", () => {
  it("accepts a request signed with the correct secret", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    expect(verifyMetaWebhookSignature(body, signedHeader(body), SECRET)).toBe(
      true,
    );
  });

  it("rejects a signature computed with a different secret than the one supplied", () => {
    const body = "{}";
    expect(
      verifyMetaWebhookSignature(body, signedHeader(body, "wrong"), SECRET),
    ).toBe(false);
  });

  it("verifies against the caller-supplied secret, not the environment", () => {
    // The helper no longer reads META_APP_SECRET itself: a payload signed
    // with a per-connection secret verifies when that same secret is passed,
    // even though it differs from the env var.
    const body = JSON.stringify({ entry: [] });
    const connectionSecret = "client-b-app-secret";
    expect(
      verifyMetaWebhookSignature(
        body,
        signedHeader(body, connectionSecret),
        connectionSecret,
      ),
    ).toBe(true);
  });

  it("rejects when the body has been tampered with after signing", () => {
    const original = '{"entry":[]}';
    const header = signedHeader(original);
    const tampered = '{"entry":[{"id":"injected"}]}';
    expect(verifyMetaWebhookSignature(tampered, header, SECRET)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyMetaWebhookSignature("anything", null, SECRET)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    const body = "{}";
    const hex = crypto
      .createHmac("sha256", SECRET)
      .update(body)
      .digest("hex");
    expect(verifyMetaWebhookSignature(body, hex, SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(body, `sha512=${hex}`, SECRET)).toBe(
      false,
    );
  });

  it("rejects a header of the wrong length without throwing", () => {
    // timingSafeEqual would throw on length mismatch — the guard inside
    // the verifier should catch this and return false instead.
    expect(verifyMetaWebhookSignature("{}", "sha256=tooshort", SECRET)).toBe(
      false,
    );
  });

  describe("fail-closed when no secret is supplied", () => {
    it("rejects a correctly-formed signature when the secret is empty", () => {
      const body = "{}";
      // A validly-signed body must still be rejected when no secret reaches
      // the verifier — the fail-closed contract now keys on the argument,
      // not the environment.
      const header = signedHeader(body, SECRET);
      expect(verifyMetaWebhookSignature(body, header, "")).toBe(false);
      expect(verifyMetaWebhookSignature(body, header, null)).toBe(false);
      expect(verifyMetaWebhookSignature(body, header, undefined)).toBe(false);
    });
  });
});
