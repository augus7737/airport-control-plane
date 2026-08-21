const STORAGE_KEY = "airport-control-plane.themePreference";
const DEFAULT_PREFERENCE = "light";
const SYSTEM_PREFERENCE = "system";
const THEME_PREFERENCES = ["light", "dark", SYSTEM_PREFERENCE];
const THEME_LABELS = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};
const THEME_ICONS = {
  light: "☀",
  dark: "☾",
  system: "◐",
};

const subscribers = new Set();

let mediaQueryList = null;
let mediaListenerBound = false;
let storageListenerBound = false;

function getGlobalWindow() {
  return typeof window === "undefined" ? null : window;
}

function getGlobalDocument() {
  return typeof document === "undefined" ? null : document;
}

function normalizeThemePreference(preference) {
  return THEME_PREFERENCES.includes(preference) ? preference : DEFAULT_PREFERENCE;
}

function getStorageValue(storageRef) {
  if (!storageRef) {
    return null;
  }

  try {
    return storageRef.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn("theme preference storage read failed", error);
    return null;
  }
}

function setStorageValue(storageRef, preference) {
  if (!storageRef) {
    return;
  }

  try {
    storageRef.setItem(STORAGE_KEY, preference);
  } catch (error) {
    console.warn("theme preference storage write failed", error);
  }
}

function resolveStorage(windowRef, storageRef) {
  if (storageRef) {
    return storageRef;
  }

  try {
    return windowRef?.localStorage || null;
  } catch (error) {
    console.warn("theme preference storage unavailable", error);
    return null;
  }
}

function getSystemTheme(windowRef = getGlobalWindow()) {
  if (!windowRef?.matchMedia) {
    return "light";
  }

  return windowRef.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getMediaQueryList(windowRef = getGlobalWindow()) {
  if (!windowRef?.matchMedia) {
    return null;
  }

  if (!mediaQueryList) {
    mediaQueryList = windowRef.matchMedia("(prefers-color-scheme: dark)");
  }

  return mediaQueryList;
}

function getThemePreference({ windowRef = getGlobalWindow(), storageRef = null } = {}) {
  const storage = resolveStorage(windowRef, storageRef);
  return normalizeThemePreference(getStorageValue(storage));
}

function resolveThemePreference(
  preference = getThemePreference(),
  { windowRef = getGlobalWindow() } = {},
) {
  const normalized = normalizeThemePreference(preference);
  return normalized === SYSTEM_PREFERENCE ? getSystemTheme(windowRef) : normalized;
}

function updateColorSchemeMeta(documentRef, resolvedTheme) {
  if (!documentRef?.head) {
    return;
  }

  let meta = documentRef.querySelector('meta[name="color-scheme"]');
  if (!meta) {
    meta = documentRef.createElement("meta");
    meta.name = "color-scheme";
    documentRef.head.appendChild(meta);
  }

  meta.content = resolvedTheme === "dark" ? "dark light" : "light dark";
}

function notifyThemePreferenceChange(snapshot) {
  subscribers.forEach((subscriber) => {
    try {
      subscriber(snapshot);
    } catch (error) {
      console.error("theme preference subscriber failed", error);
    }
  });
}

function dispatchThemeChange(snapshot, windowRef = getGlobalWindow()) {
  if (!windowRef?.dispatchEvent || typeof windowRef.CustomEvent !== "function") {
    return;
  }

  windowRef.dispatchEvent(
    new windowRef.CustomEvent("themechange", {
      detail: snapshot,
    }),
  );
}

function applyThemePreference(
  preference = getThemePreference(),
  { documentRef = getGlobalDocument(), windowRef = getGlobalWindow(), notify = true } = {},
) {
  const normalized = normalizeThemePreference(preference);
  const resolvedTheme = resolveThemePreference(normalized, { windowRef });
  const root = documentRef?.documentElement;

  if (root) {
    root.dataset.themePreference = normalized;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
  }

  updateColorSchemeMeta(documentRef, resolvedTheme);

  const snapshot = {
    preference: normalized,
    resolvedTheme,
    systemTheme: getSystemTheme(windowRef),
  };

  if (notify) {
    notifyThemePreferenceChange(snapshot);
    dispatchThemeChange(snapshot, windowRef);
  }

  return snapshot;
}

function setThemePreference(
  preference,
  { documentRef = getGlobalDocument(), windowRef = getGlobalWindow(), storageRef = null } = {},
) {
  const normalized = normalizeThemePreference(preference);
  const storage = resolveStorage(windowRef, storageRef);
  setStorageValue(storage, normalized);
  return applyThemePreference(normalized, { documentRef, windowRef });
}

function subscribeThemePreference(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

function ensureSystemThemeListener({
  documentRef = getGlobalDocument(),
  windowRef = getGlobalWindow(),
  storageRef = null,
} = {}) {
  const queryList = getMediaQueryList(windowRef);
  if (!queryList || mediaListenerBound) {
    return;
  }

  mediaListenerBound = true;
  const handleChange = () => {
    const preference = getThemePreference({ windowRef, storageRef });
    if (preference === SYSTEM_PREFERENCE) {
      applyThemePreference(preference, { documentRef, windowRef });
    }
  };

  if (queryList.addEventListener) {
    queryList.addEventListener("change", handleChange);
  } else if (queryList.addListener) {
    queryList.addListener(handleChange);
  }
}

function ensureStorageListener({
  documentRef = getGlobalDocument(),
  windowRef = getGlobalWindow(),
  storageRef = null,
} = {}) {
  if (!windowRef || storageListenerBound) {
    return;
  }

  storageListenerBound = true;
  windowRef.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }

    const preference = normalizeThemePreference(event.newValue);
    applyThemePreference(preference, { documentRef, windowRef });
  });
}

function updateTrigger(trigger, icon, snapshot) {
  if (!trigger) {
    return;
  }

  const preferenceLabel = THEME_LABELS[snapshot.preference] || THEME_LABELS[DEFAULT_PREFERENCE];
  const resolvedLabel = THEME_LABELS[snapshot.resolvedTheme] || preferenceLabel;
  const label =
    snapshot.preference === SYSTEM_PREFERENCE
      ? `主题：${preferenceLabel}，当前${resolvedLabel}`
      : `主题：${preferenceLabel}`;

  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("title", label);

  if (icon) {
    icon.textContent = THEME_ICONS[snapshot.preference] || THEME_ICONS[DEFAULT_PREFERENCE];
  }
}

function syncThemePreferenceControls(documentRef, snapshot = null) {
  const resolvedSnapshot =
    snapshot ||
    applyThemePreference(getThemePreference(), {
      documentRef,
      notify: false,
    });
  const trigger = documentRef?.getElementById("theme-preference-trigger");
  const icon = documentRef?.getElementById("theme-preference-icon");
  const menu = documentRef?.getElementById("theme-preference-menu");

  updateTrigger(trigger, icon, resolvedSnapshot);

  if (menu) {
    menu.dataset.themePreference = resolvedSnapshot.preference;
  }

  documentRef?.querySelectorAll("[data-theme-preference-option]").forEach((control) => {
    const preference = normalizeThemePreference(control.dataset.themePreferenceOption);
    const selected = preference === resolvedSnapshot.preference;
    const label = THEME_LABELS[preference] || preference;

    control.setAttribute("aria-checked", selected ? "true" : "false");
    control.setAttribute("title", `切换到${label}主题`);
    control.textContent = `${selected ? "✓ " : ""}${label}`;
  });
}

function setupThemePreferenceControls({
  documentRef = getGlobalDocument(),
  windowRef = getGlobalWindow(),
  storageRef = null,
} = {}) {
  const storage = resolveStorage(windowRef, storageRef);
  const snapshot = applyThemePreference(getThemePreference({ windowRef, storageRef: storage }), {
    documentRef,
    notify: false,
    windowRef,
  });

  ensureSystemThemeListener({ documentRef, windowRef, storageRef: storage });
  ensureStorageListener({ documentRef, windowRef, storageRef: storage });
  syncThemePreferenceControls(documentRef, snapshot);

  const unsubscribe = subscribeThemePreference((nextSnapshot) => {
    syncThemePreferenceControls(documentRef, nextSnapshot);
  });
  const menu = documentRef?.getElementById("theme-preference-menu");

  if (!menu || menu.dataset.bound === "true") {
    return unsubscribe;
  }

  menu.dataset.bound = "true";
  menu.addEventListener("toggle", () => {
    const trigger = documentRef.getElementById("theme-preference-trigger");
    trigger?.setAttribute("aria-expanded", menu.open ? "true" : "false");
  });

  menu.addEventListener("click", (event) => {
    const control = event.target.closest("[data-theme-preference-option]");
    if (!control) {
      return;
    }

    setThemePreference(control.dataset.themePreferenceOption, {
      documentRef,
      windowRef,
      storageRef: storage,
    });
    menu.open = false;
    documentRef.getElementById("theme-preference-trigger")?.focus();
  });

  documentRef.addEventListener("click", (event) => {
    if (!menu.open || menu.contains(event.target)) {
      return;
    }
    menu.open = false;
  });

  documentRef.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !menu.open) {
      return;
    }
    menu.open = false;
    documentRef.getElementById("theme-preference-trigger")?.focus();
  });

  return unsubscribe;
}

export {
  DEFAULT_PREFERENCE,
  STORAGE_KEY,
  THEME_LABELS,
  THEME_PREFERENCES,
  applyThemePreference,
  getThemePreference,
  resolveThemePreference,
  setThemePreference,
  setupThemePreferenceControls,
  subscribeThemePreference,
};
