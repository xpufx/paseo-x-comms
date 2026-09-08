/**
 * Daemon-wide feature flags for the mesh layers. Pure resolution logic lives
 * here so it is unit-testable without touching the prefs file; persistence
 * stays in server/handlers.ts via the PluginStorage-backed ui prefs.
 *
 * Defaults: presence on, injection on. Absent keys mean enabled.
 */

export interface FeaturePrefs {
  presenceEnabled?: boolean;
  injectionEnabled?: boolean;
}

export function resolvePresenceEnabled(prefs: FeaturePrefs): boolean {
  return prefs.presenceEnabled !== false;
}

export function resolveInjectionEnabled(prefs: FeaturePrefs): boolean {
  return prefs.injectionEnabled !== false;
}

export interface FeatureFlags {
  presenceEnabled: boolean;
  injectionEnabled: boolean;
}

export function resolveFeatureFlags(prefs: FeaturePrefs): FeatureFlags {
  return {
    presenceEnabled: resolvePresenceEnabled(prefs),
    injectionEnabled: resolveInjectionEnabled(prefs),
  };
}

/**
 * Merge a partial prefs update over stored prefs (toggle round-trip).
 * Undefined fields keep their stored value.
 */
export function applyFeaturePrefsUpdate(
  stored: FeaturePrefs,
  input: FeaturePrefs,
): FeaturePrefs {
  return {
    ...stored,
    presenceEnabled: input.presenceEnabled ?? stored.presenceEnabled,
    injectionEnabled: input.injectionEnabled ?? stored.injectionEnabled,
  };
}
