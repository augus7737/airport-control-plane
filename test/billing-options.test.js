import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBillingCycle } from "../src/domain/costs/normalize.js";
import {
  validateAssetUpdate,
  validateProviderCreate,
} from "../src/http/validators.js";

test("billing cycle aliases are accepted anywhere cost fields are validated", () => {
  assert.equal(normalizeBillingCycle("monthly"), "月付");
  assert.deepEqual(validateAssetUpdate({ billing_cycle: "monthly" }), []);
  assert.deepEqual(
    validateProviderCreate({
      name: "Provider",
      default_currency: "CNY",
    }),
    [],
  );
});
