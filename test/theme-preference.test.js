import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PREFERENCE,
  STORAGE_KEY,
  getThemePreference,
  resolveThemePreference,
  setThemePreference,
} from "../public/js/shared/theme-preference.js";

function createThemeHarness({ stored = null, systemDark = false } = {}) {
  const values = new Map(stored == null ? [] : [[STORAGE_KEY, stored]]);
  const events = [];
  let colorSchemeMeta = null;
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const windowRef = {
    CustomEvent: FakeCustomEvent,
    dispatchEvent(event) {
      events.push(event);
    },
    localStorage: storage,
    matchMedia() {
      return { matches: systemDark };
    },
  };
  const documentRef = {
    documentElement: { dataset: {}, style: {} },
    head: {
      appendChild(element) {
        colorSchemeMeta = element;
      },
    },
    createElement() {
      return {};
    },
    querySelector(selector) {
      return selector === 'meta[name="color-scheme"]' ? colorSchemeMeta : null;
    },
  };

  return { documentRef, events, storage, values, windowRef };
}

test("theme preference defaults to light and rejects unknown stored values", () => {
  const harness = createThemeHarness({ stored: "neon" });

  assert.equal(DEFAULT_PREFERENCE, "light");
  assert.equal(
    getThemePreference({ windowRef: harness.windowRef, storageRef: harness.storage }),
    "light",
  );
});

test("system preference resolves against the operating-system color scheme", () => {
  const darkHarness = createThemeHarness({ systemDark: true });
  const lightHarness = createThemeHarness({ systemDark: false });

  assert.equal(resolveThemePreference("system", { windowRef: darkHarness.windowRef }), "dark");
  assert.equal(resolveThemePreference("system", { windowRef: lightHarness.windowRef }), "light");
});

test("setting a theme persists it, updates the root and dispatches themechange", () => {
  const harness = createThemeHarness();
  const snapshot = setThemePreference("dark", harness);

  assert.equal(harness.values.get(STORAGE_KEY), "dark");
  assert.equal(harness.documentRef.documentElement.dataset.themePreference, "dark");
  assert.equal(harness.documentRef.documentElement.dataset.theme, "dark");
  assert.equal(harness.documentRef.documentElement.style.colorScheme, "dark");
  assert.deepEqual(snapshot, {
    preference: "dark",
    resolvedTheme: "dark",
    systemTheme: "light",
  });
  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].type, "themechange");
  assert.deepEqual(harness.events[0].detail, snapshot);
});
