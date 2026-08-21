(function bootstrapThemePreference() {
  var storageKey = "airport-control-plane.themePreference";
  var fallbackPreference = "light";
  var preferences = {
    light: true,
    dark: true,
    system: true,
  };

  function normalizePreference(value) {
    return preferences[value] ? value : fallbackPreference;
  }

  function getStoredPreference() {
    try {
      return window.localStorage.getItem(storageKey);
    } catch (error) {
      return null;
    }
  }

  function getSystemTheme() {
    if (!window.matchMedia) {
      return "light";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  var preference = normalizePreference(getStoredPreference());
  var resolvedTheme = preference === "system" ? getSystemTheme() : preference;
  var root = document.documentElement;

  root.dataset.themePreference = preference;
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;

  var meta = document.querySelector('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "color-scheme";
    document.head.appendChild(meta);
  }
  meta.content = resolvedTheme === "dark" ? "dark light" : "light dark";
})();
