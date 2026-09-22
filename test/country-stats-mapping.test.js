import test from "node:test";
import assert from "node:assert/strict";

import {
  getCountryStats,
  getNodeCountry,
} from "../public/js/shared/route-helpers.js";
import {
  getLocationCoordinates,
  getLocationCountry,
} from "../public/js/shared/location-suggestions.js";

const region = (value) => ({ labels: { region: value } });

test("airport and city labels normalize to their country", () => {
  assert.equal(getLocationCountry("IAD", { scope: "region" }), "美国");
  assert.equal(getLocationCountry("Santa Clara", { scope: "region" }), "美国");
  assert.equal(getNodeCountry(region("IAD")), "美国");
  assert.ok(getLocationCoordinates("IAD", { scope: "region" }));
});

test("unrecognized location labels stay unmappable instead of counting as countries", () => {
  assert.equal(getNodeCountry(region("火星基地")), "火星基地");
  assert.equal(getLocationCoordinates("火星基地", { scope: "region" }), null);
  assert.equal(getNodeCountry(region(undefined)), "未识别");
  assert.equal(getLocationCoordinates("未识别", { scope: "region" }), null);
});

test("country stats merge every label of one country into a single entry", () => {
  const stats = getCountryStats([
    region("新加坡"),
    region("日本"),
    region("美国"),
    region("IAD"),
    region("火星基地"),
    region(undefined),
  ]);

  assert.equal(stats.length, 5);
  assert.deepEqual(
    stats.map((item) => item.country).sort(),
    ["新加坡", "日本", "美国", "火星基地", "未识别"].sort(),
  );

  const unitedStates = stats.find((item) => item.country === "美国");
  assert.equal(unitedStates.total, 2);

  const mappable = stats.filter((item) => getLocationCoordinates(item.country, { scope: "region" }));
  assert.deepEqual(
    mappable.map((item) => item.country).sort(),
    ["新加坡", "日本", "美国"].sort(),
  );
});
