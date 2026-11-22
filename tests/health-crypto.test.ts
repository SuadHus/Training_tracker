import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { hasHealthKey, healthSecretMatches, openHealthValue, sealHealthValue } from "../src/lib/health-crypto";

test("seals health tokens and rejects opening them in another context or after tampering", () => {
  const original = process.env.HEALTH_TOKEN_KEY;
  process.env.HEALTH_TOKEN_KEY = randomBytes(32).toString("base64");
  try {
    assert.equal(hasHealthKey(), true);
    const value = { refreshToken: "my-token" };
    const blob = sealHealthValue(value, "health-token:withings");
    assert.ok(!blob.includes(value.refreshToken));
    assert.notEqual(blob, sealHealthValue(value, "health-token:withings"));
    assert.deepEqual(openHealthValue(blob, "health-token:withings"), value);
    assert.throws(() => openHealthValue(blob, "health-token:google-health"));
    const tampered = Buffer.from(blob, "base64url");
    tampered[13] ^= 1;
    assert.throws(() => openHealthValue(tampered.toString("base64url"), "health-token:withings"));
    assert.equal(healthSecretMatches("valid", "valid"), true);
    assert.equal(healthSecretMatches("valid", "invalid"), false);
  } finally {
    if (original === undefined) delete process.env.HEALTH_TOKEN_KEY;
    else process.env.HEALTH_TOKEN_KEY = original;
  }
});
