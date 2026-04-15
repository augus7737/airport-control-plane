function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const REGION_SUGGESTION_PRESETS = [
  { label: "中国大陆 / Mainland China", aliases: ["中国大陆", "中国", "Mainland China", "CN"] },
  { label: "香港 / Hong Kong", aliases: ["HKG", "HK", "香港", "中国香港", "Hong Kong"] },
  { label: "东京 / Tokyo", aliases: ["TYO", "NRT", "TOK", "东京", "Tokyo", "Narita"] },
  { label: "大阪 / Osaka", aliases: ["OSA", "大阪", "Osaka"] },
  { label: "新加坡 / Singapore", aliases: ["SIN", "新加坡", "Singapore"] },
  { label: "首尔 / Seoul", aliases: ["SEL", "ICN", "首尔", "首尔仁川", "Seoul", "Incheon"] },
  { label: "台北 / Taipei", aliases: ["TPE", "台北", "中国台湾", "Taipei", "Taiwan"] },
  { label: "洛杉矶 / Los Angeles", aliases: ["LAX", "洛杉矶", "Los Angeles"] },
  { label: "圣何塞 / San Jose", aliases: ["SJC", "圣何塞", "San Jose"] },
  { label: "西雅图 / Seattle", aliases: ["SEA", "西雅图", "Seattle"] },
  { label: "法兰克福 / Frankfurt", aliases: ["FRA", "法兰克福", "Frankfurt"] },
  { label: "纽伦堡 / Nuremberg", aliases: ["NBG", "纽伦堡", "Nuremberg"] },
  { label: "赫尔辛基 / Helsinki", aliases: ["HEL", "赫尔辛基", "Helsinki"] },
  { label: "伦敦 / London", aliases: ["LON", "伦敦", "London"] },
  { label: "阿姆斯特丹 / Amsterdam", aliases: ["AMS", "阿姆斯特丹", "Amsterdam"] },
  { label: "巴黎 / Paris", aliases: ["PAR", "巴黎", "Paris"] },
  { label: "悉尼 / Sydney", aliases: ["SYD", "悉尼", "Sydney"] },
  { label: "美国 / United States", aliases: ["美国", "United States", "US"] },
  { label: "德国 / Germany", aliases: ["德国", "Germany", "DE"] },
  { label: "日本 / Japan", aliases: ["日本", "Japan", "JP"] },
  { label: "韩国 / South Korea", aliases: ["韩国", "South Korea", "KR"] },
];

const ENTRY_REGION_SUGGESTION_PRESETS = [
  { label: "中国大陆 / Mainland China", aliases: ["中国大陆", "中国", "Mainland China"] },
  { label: "香港 / Hong Kong", aliases: ["香港", "中国香港", "Hong Kong", "HKG"] },
  { label: "台湾 / Taiwan", aliases: ["台湾", "中国台湾", "Taiwan", "TPE"] },
  { label: "日本 / Japan", aliases: ["日本", "Japan", "JP"] },
  { label: "韩国 / South Korea", aliases: ["韩国", "South Korea", "KR"] },
  { label: "新加坡 / Singapore", aliases: ["新加坡", "Singapore", "SG"] },
  { label: "美国西海岸 / US West Coast", aliases: ["美国西海岸", "US West Coast", "西海岸"] },
  { label: "欧洲 / Europe", aliases: ["欧洲", "Europe", "EU"] },
];

function renderSuggestionDatalist(listId, presets) {
  const items = [];
  const seen = new Set();

  for (const preset of presets) {
    for (const alias of preset.aliases) {
      const normalized = String(alias || "").trim().toLowerCase();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      items.push(
        `<option value="${escapeAttr(alias)}" label="${escapeAttr(preset.label)}"></option>`,
      );
    }
  }

  return `<datalist id="${escapeAttr(listId)}">${items.join("")}</datalist>`;
}

export function createLocationSuggestionsModule() {
  function renderRegionDatalist(listId) {
    return renderSuggestionDatalist(listId, REGION_SUGGESTION_PRESETS);
  }

  function renderEntryRegionDatalist(listId) {
    return renderSuggestionDatalist(listId, ENTRY_REGION_SUGGESTION_PRESETS);
  }

  return {
    renderEntryRegionDatalist,
    renderRegionDatalist,
  };
}
