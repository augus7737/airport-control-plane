function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function buildLocationRecord({
  value,
  code,
  english,
  country,
  aliases = [],
}) {
  const normalizedAliases = [...new Set(
    [value, code, english, country, ...aliases]
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  )];

  return {
    value,
    code,
    english,
    country,
    aliases: normalizedAliases,
    searchTokens: normalizedAliases.map((item) => normalizeSearch(item)),
  };
}

const REGION_LOCATION_PRESETS = [
  buildLocationRecord({
    value: "中国大陆",
    code: "CN",
    english: "Mainland China",
    country: "中国大陆",
    aliases: ["中国", "Mainland China", "CN"],
  }),
  buildLocationRecord({
    value: "香港",
    code: "HK",
    english: "Hong Kong",
    country: "中国香港",
    aliases: ["HKG", "HK", "中国香港", "Hong Kong"],
  }),
  buildLocationRecord({
    value: "日本",
    code: "JP",
    english: "Japan",
    country: "日本",
    aliases: ["Japan", "JP", "Tokyo", "TYO", "NRT", "TOK", "Narita", "Osaka", "OSA", "东京", "大阪"],
  }),
  buildLocationRecord({
    value: "新加坡",
    code: "SG",
    english: "Singapore",
    country: "新加坡",
    aliases: ["SIN", "Singapore"],
  }),
  buildLocationRecord({
    value: "马来西亚",
    code: "MY",
    english: "Malaysia",
    country: "马来西亚",
    aliases: ["Malaysia", "MY", "Kuala Lumpur", "KUL", "吉隆坡"],
  }),
  buildLocationRecord({
    value: "越南",
    code: "VN",
    english: "Vietnam",
    country: "越南",
    aliases: ["Vietnam", "VN", "Ho Chi Minh", "SGN", "HCMC", "Hanoi", "HAN", "胡志明", "河内"],
  }),
  buildLocationRecord({
    value: "泰国",
    code: "TH",
    english: "Thailand",
    country: "泰国",
    aliases: ["Thailand", "TH", "Bangkok", "BKK", "曼谷"],
  }),
  buildLocationRecord({
    value: "印度尼西亚",
    code: "ID",
    english: "Indonesia",
    country: "印度尼西亚",
    aliases: ["Indonesia", "ID", "Jakarta", "CGK", "雅加达"],
  }),
  buildLocationRecord({
    value: "菲律宾",
    code: "PH",
    english: "Philippines",
    country: "菲律宾",
    aliases: ["Philippines", "PH", "Manila", "MNL", "马尼拉"],
  }),
  buildLocationRecord({
    value: "韩国",
    code: "KR",
    english: "South Korea",
    country: "韩国",
    aliases: ["South Korea", "KR", "Seoul", "SEL", "ICN", "Incheon", "首尔", "首尔仁川"],
  }),
  buildLocationRecord({
    value: "中国台湾",
    code: "TW",
    english: "Taiwan",
    country: "中国台湾",
    aliases: ["Taiwan", "TW", "TPE", "Taipei", "台湾", "台北"],
  }),
  buildLocationRecord({
    value: "美国",
    code: "US",
    english: "United States",
    country: "美国",
    aliases: [
      "United States",
      "US",
      "Los Angeles",
      "LAX",
      "San Jose",
      "SJC",
      "Seattle",
      "SEA",
      "洛杉矶",
      "圣何塞",
      "西雅图",
    ],
  }),
  buildLocationRecord({
    value: "德国",
    code: "DE",
    english: "Germany",
    country: "德国",
    aliases: ["Germany", "DE", "Frankfurt", "FRA", "Nuremberg", "NBG", "法兰克福", "纽伦堡"],
  }),
  buildLocationRecord({
    value: "芬兰",
    code: "FI",
    english: "Finland",
    country: "芬兰",
    aliases: ["Finland", "FI", "Helsinki", "HEL", "赫尔辛基"],
  }),
  buildLocationRecord({
    value: "英国",
    code: "GB",
    english: "United Kingdom",
    country: "英国",
    aliases: ["United Kingdom", "UK", "GB", "London", "LON", "伦敦"],
  }),
  buildLocationRecord({
    value: "荷兰",
    code: "NL",
    english: "Netherlands",
    country: "荷兰",
    aliases: ["Netherlands", "NL", "Amsterdam", "AMS", "阿姆斯特丹"],
  }),
  buildLocationRecord({
    value: "法国",
    code: "FR",
    english: "France",
    country: "法国",
    aliases: ["France", "FR", "Paris", "PAR", "巴黎"],
  }),
  buildLocationRecord({
    value: "澳大利亚",
    code: "AU",
    english: "Australia",
    country: "澳大利亚",
    aliases: ["Australia", "AU", "Sydney", "SYD", "悉尼"],
  }),
  buildLocationRecord({
    value: "加拿大",
    code: "CA",
    english: "Canada",
    country: "加拿大",
    aliases: ["Canada", "CA", "Toronto", "YYZ", "Vancouver", "YVR", "多伦多", "温哥华"],
  }),
  buildLocationRecord({
    value: "西班牙",
    code: "ES",
    english: "Spain",
    country: "西班牙",
    aliases: ["Spain", "ES", "Madrid", "MAD", "马德里"],
  }),
  buildLocationRecord({
    value: "意大利",
    code: "IT",
    english: "Italy",
    country: "意大利",
    aliases: ["Italy", "IT", "Milan", "MXP", "Rome", "ROM", "米兰", "罗马"],
  }),
  buildLocationRecord({
    value: "波兰",
    code: "PL",
    english: "Poland",
    country: "波兰",
    aliases: ["Poland", "PL", "Warsaw", "WAW", "华沙"],
  }),
  buildLocationRecord({
    value: "瑞典",
    code: "SE",
    english: "Sweden",
    country: "瑞典",
    aliases: ["Sweden", "SE", "Stockholm", "ARN", "斯德哥尔摩"],
  }),
  buildLocationRecord({
    value: "印度",
    code: "IN",
    english: "India",
    country: "印度",
    aliases: ["India", "IN", "Mumbai", "BOM", "Delhi", "DEL", "孟买", "德里"],
  }),
  buildLocationRecord({
    value: "阿联酋",
    code: "AE",
    english: "United Arab Emirates",
    country: "阿联酋",
    aliases: ["UAE", "United Arab Emirates", "AE", "Dubai", "DXB", "迪拜"],
  }),
];

const ENTRY_LOCATION_PRESETS = [
  buildLocationRecord({
    value: "中国大陆",
    code: "CN",
    english: "Mainland China",
    country: "中国大陆",
    aliases: ["中国", "Mainland China"],
  }),
  buildLocationRecord({
    value: "香港",
    code: "HK",
    english: "Hong Kong",
    country: "中国香港",
    aliases: ["HKG", "HK", "中国香港", "Hong Kong"],
  }),
  buildLocationRecord({
    value: "台湾",
    code: "TW",
    english: "Taiwan",
    country: "中国台湾",
    aliases: ["中国台湾", "Taiwan", "TPE"],
  }),
  buildLocationRecord({
    value: "日本",
    code: "JP",
    english: "Japan",
    country: "日本",
    aliases: ["Japan"],
  }),
  buildLocationRecord({
    value: "韩国",
    code: "KR",
    english: "South Korea",
    country: "韩国",
    aliases: ["South Korea"],
  }),
  buildLocationRecord({
    value: "新加坡",
    code: "SG",
    english: "Singapore",
    country: "新加坡",
    aliases: ["Singapore"],
  }),
  buildLocationRecord({
    value: "马来西亚",
    code: "MY",
    english: "Malaysia",
    country: "马来西亚",
    aliases: ["Malaysia", "MY", "KUL", "吉隆坡"],
  }),
  buildLocationRecord({
    value: "越南",
    code: "VN",
    english: "Vietnam",
    country: "越南",
    aliases: ["Vietnam", "VN", "SGN", "HAN", "胡志明", "河内"],
  }),
  buildLocationRecord({
    value: "泰国",
    code: "TH",
    english: "Thailand",
    country: "泰国",
    aliases: ["Thailand", "TH", "BKK", "曼谷"],
  }),
  buildLocationRecord({
    value: "美国西海岸",
    code: "USW",
    english: "US West Coast",
    country: "美国",
    aliases: ["US West Coast", "西海岸"],
  }),
  buildLocationRecord({
    value: "欧洲",
    code: "EU",
    english: "Europe",
    country: "欧洲",
    aliases: ["Europe"],
  }),
];

function presetsForScope(scope = "region") {
  return scope === "entry" ? ENTRY_LOCATION_PRESETS : REGION_LOCATION_PRESETS;
}

function presetMatchScore(preset, query) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) {
    return 1;
  }

  let bestScore = 0;
  for (const token of preset.searchTokens) {
    if (token === normalizedQuery) {
      bestScore = Math.max(bestScore, 120);
    } else if (token.startsWith(normalizedQuery)) {
      bestScore = Math.max(bestScore, 96);
    } else if (token.includes(normalizedQuery)) {
      bestScore = Math.max(bestScore, 72);
    }
  }

  if (normalizeSearch(preset.value).includes(normalizedQuery)) {
    bestScore = Math.max(bestScore, 102);
  }

  return bestScore;
}

function fallbackLocationMeta(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return {
      value: "",
      code: "--",
      english: "",
      country: "未识别",
      aliases: [],
    };
  }

  const alphaCode = value.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
  return {
    value,
    code: alphaCode || "--",
    english: "",
    country: value,
    aliases: [value],
  };
}

export function findLocationPreset(value, options = {}) {
  const scope = options.scope || "region";
  const normalizedValue = normalizeSearch(value);
  if (!normalizedValue) {
    return null;
  }

  for (const preset of presetsForScope(scope)) {
    if (preset.searchTokens.includes(normalizedValue)) {
      return preset;
    }
  }

  if (normalizedValue.includes("香港") || normalizedValue.includes("hong kong")) {
    return presetsForScope(scope).find((preset) => preset.value === "香港") || null;
  }

  if (normalizedValue.includes("中国大陆") || normalizedValue === "中国" || normalizedValue.includes("mainland")) {
    return presetsForScope(scope).find((preset) => preset.value === "中国大陆") || null;
  }

  if (normalizedValue.includes("台湾")) {
    return presetsForScope(scope).find((preset) => preset.value === (scope === "entry" ? "台湾" : "中国台湾")) || null;
  }

  if (normalizedValue.includes("日本")) {
    return presetsForScope(scope).find((preset) => preset.value === "日本") || null;
  }

  if (normalizedValue.includes("新加坡")) {
    return presetsForScope(scope).find((preset) => preset.value === "新加坡") || null;
  }

  if (normalizedValue.includes("韩国")) {
    return presetsForScope(scope).find((preset) => preset.value === "韩国") || null;
  }

  if (normalizedValue.includes("马来") || normalizedValue.includes("malaysia")) {
    return presetsForScope(scope).find((preset) => preset.value === "马来西亚") || null;
  }

  if (normalizedValue.includes("越南") || normalizedValue.includes("vietnam")) {
    return presetsForScope(scope).find((preset) => preset.value === "越南") || null;
  }

  if (normalizedValue.includes("泰国") || normalizedValue.includes("thailand")) {
    return presetsForScope(scope).find((preset) => preset.value === "泰国") || null;
  }

  return null;
}

export function normalizeLocationValue(value, options = {}) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return null;
  }

  const preset = findLocationPreset(rawValue, options);
  return preset?.value || rawValue;
}

export function getLocationMeta(value, options = {}) {
  const preset = findLocationPreset(value, options);
  if (preset) {
    return preset;
  }
  return fallbackLocationMeta(value);
}

export function formatLocationDisplay(value, options = {}) {
  const fallback = options.fallback ?? "-";
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return fallback;
  }

  const meta = getLocationMeta(rawValue, options);
  const style = options.style || "compact";

  if (style === "name") {
    return meta.value || rawValue;
  }

  if (style === "full") {
    if (meta.english && meta.code && meta.value !== rawValue) {
      return `${meta.value} / ${meta.english} · ${meta.code}`;
    }
    if (meta.english && meta.code) {
      return `${meta.value} / ${meta.english} · ${meta.code}`;
    }
    if (meta.code && meta.code !== rawValue && meta.code !== "--") {
      return `${meta.value} · ${meta.code}`;
    }
    return meta.value || rawValue;
  }

  if (meta.code && meta.code !== rawValue && meta.code !== "--") {
    return `${meta.value} · ${meta.code}`;
  }

  return meta.value || rawValue;
}

export function getLocationCountry(value, options = {}) {
  return getLocationMeta(value, options).country;
}

export function getLocationCode(value, options = {}) {
  return getLocationMeta(value, options).code;
}

export function getLocationSuggestions(query, options = {}) {
  const scope = options.scope || "region";
  const limit = Number.isInteger(options.limit) ? options.limit : 8;
  const presets = presetsForScope(scope)
    .map((preset) => ({ preset, score: presetMatchScore(preset, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.preset.value.localeCompare(right.preset.value, "zh-Hans-CN"))
    .slice(0, limit)
    .map(({ preset }) => preset);

  return presets;
}

export function getLocationPresetOptions(scope = "region") {
  return [...presetsForScope(scope)];
}

function closeSuggestionPanel(field) {
  const panel = field?.querySelector(".location-suggestion-panel");
  if (!panel) {
    return;
  }
  panel.hidden = true;
  panel.innerHTML = "";
  field.classList.remove("location-suggestion-open");
}

function ensureSuggestionPanel(field, documentRef) {
  let panel = field.querySelector(".location-suggestion-panel");
  if (panel) {
    return panel;
  }

  panel = documentRef.createElement("div");
  panel.className = "location-suggestion-panel";
  panel.hidden = true;
  field.append(panel);
  return panel;
}

function renderSuggestionPanel({
  field,
  input,
  panel,
  suggestions,
  activeIndex,
  scope,
  onSelect,
}) {
  if (!suggestions.length) {
    closeSuggestionPanel(field);
    return;
  }

  panel.hidden = false;
  field.classList.add("location-suggestion-open");
  panel.innerHTML = suggestions
    .map((preset, index) => {
      const activeClass = index === activeIndex ? " is-active" : "";
      const secondary = scope === "entry" ? preset.english : `${preset.english}${preset.country ? ` · ${preset.country}` : ""}`;
      return `
        <button
          class="location-suggestion-item${activeClass}"
          type="button"
          data-location-value="${escapeHtml(preset.value)}"
          data-location-index="${index}"
        >
          <span class="location-suggestion-main">${escapeHtml(formatLocationDisplay(preset.value, { scope, style: "compact" }))}</span>
          <span class="location-suggestion-sub">${escapeHtml(secondary)}</span>
        </button>
      `;
    })
    .join("");

  panel.querySelectorAll("[data-location-value]").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const nextValue = button.getAttribute("data-location-value");
      const matched = suggestions.find((preset) => preset.value === nextValue);
      if (matched) {
        onSelect(matched);
        input.focus();
      }
    });
  });
}

function bindAutocompleteInput(input, options = {}) {
  const documentRef = options.documentRef || document;
  const scope = input.dataset.locationScope || "region";
  if (input.dataset.locationAutocompleteBound === "1") {
    return;
  }

  input.dataset.locationAutocompleteBound = "1";
  input.setAttribute("autocomplete", "off");
  input.removeAttribute("list");

  const field = input.closest(".field");
  if (!field) {
    return;
  }

  field.classList.add("location-autocomplete-field");
  const panel = ensureSuggestionPanel(field, documentRef);
  const state = {
    activeIndex: 0,
    suggestions: [],
  };

  function canonicalizeCurrentValue() {
    const normalizedValue = normalizeLocationValue(input.value, { scope });
    if (normalizedValue) {
      input.value = normalizedValue;
    } else if (!String(input.value || "").trim()) {
      input.value = "";
    }
  }

  function selectPreset(preset) {
    input.value = preset.value;
    state.activeIndex = 0;
    closeSuggestionPanel(field);
  }

  function refreshSuggestions() {
    state.suggestions = getLocationSuggestions(input.value, { scope });
    state.activeIndex = Math.min(state.activeIndex, Math.max(state.suggestions.length - 1, 0));
    renderSuggestionPanel({
      field,
      input,
      panel,
      suggestions: state.suggestions,
      activeIndex: state.activeIndex,
      scope,
      onSelect: selectPreset,
    });
  }

  input.addEventListener("focus", () => {
    refreshSuggestions();
  });

  input.addEventListener("input", () => {
    state.activeIndex = 0;
    refreshSuggestions();
  });

  input.addEventListener("keydown", (event) => {
    if (!state.suggestions.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.activeIndex = (state.activeIndex + 1) % state.suggestions.length;
      renderSuggestionPanel({
        field,
        input,
        panel,
        suggestions: state.suggestions,
        activeIndex: state.activeIndex,
        scope,
        onSelect: selectPreset,
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.activeIndex =
        (state.activeIndex - 1 + state.suggestions.length) % state.suggestions.length;
      renderSuggestionPanel({
        field,
        input,
        panel,
        suggestions: state.suggestions,
        activeIndex: state.activeIndex,
        scope,
        onSelect: selectPreset,
      });
      return;
    }

    if (event.key === "Enter" && state.suggestions.length > 0) {
      event.preventDefault();
      selectPreset(state.suggestions[state.activeIndex] || state.suggestions[0]);
      return;
    }

    if (event.key === "Escape") {
      closeSuggestionPanel(field);
    }
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      canonicalizeCurrentValue();
      closeSuggestionPanel(field);
    }, 120);
  });
}

export function createLocationSuggestionsModule(dependencies = {}) {
  const { documentRef = document } = dependencies;

  function bindLocationAutocomplete(root = documentRef) {
    root.querySelectorAll("[data-location-scope]").forEach((input) => {
      bindAutocompleteInput(input, { documentRef });
    });
  }

  return {
    bindLocationAutocomplete,
    findLocationPreset,
    formatLocationDisplay,
    getLocationCode,
    getLocationCountry,
    getLocationMeta,
    getLocationSuggestions,
    normalizeLocationValue,
  };
}
