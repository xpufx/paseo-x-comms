import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyFeaturePrefsUpdate,
  resolveFeatureFlags,
  resolveInjectionEnabled,
  resolvePresenceEnabled,
} from "./settings.ts";

describe("feature flags", () => {
  it("defaults both flags on when keys are absent", () => {
    assert.equal(resolvePresenceEnabled({}), true);
    assert.equal(resolveInjectionEnabled({}), true);
    assert.deepEqual(resolveFeatureFlags({}), { presenceEnabled: true, injectionEnabled: true });
  });

  it("honors explicit true and false", () => {
    assert.equal(resolvePresenceEnabled({ presenceEnabled: false }), false);
    assert.equal(resolveInjectionEnabled({ injectionEnabled: false }), false);
    assert.equal(resolvePresenceEnabled({ presenceEnabled: true }), true);
    assert.equal(resolveInjectionEnabled({ injectionEnabled: true }), true);
  });

  it("round-trips a toggle update without touching the other flag", () => {
    const stored = { presenceEnabled: true };
    const next = applyFeaturePrefsUpdate(stored, { injectionEnabled: false });
    assert.deepEqual(next, { presenceEnabled: true, injectionEnabled: false });
    assert.deepEqual(resolveFeatureFlags(next), { presenceEnabled: true, injectionEnabled: false });
    const back = applyFeaturePrefsUpdate(next, { injectionEnabled: true });
    assert.deepEqual(resolveFeatureFlags(back), { presenceEnabled: true, injectionEnabled: true });
  });

  it("keeps stored values when the update omits them", () => {
    const stored = { presenceEnabled: false, injectionEnabled: false };
    assert.deepEqual(applyFeaturePrefsUpdate(stored, {}), stored);
  });
});
