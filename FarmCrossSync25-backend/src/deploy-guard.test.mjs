// Deploy-time guard (ticket 77 dev-route isolation + ticket 89 deployment
// configuration). The guard must fail closed: any config it cannot prove safe
// aborts the deploy. These tests pin the detection logic.
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEV_ONLY_VARS,
  REQUIRED_SECRETS,
  stripJsonComments,
  findDeployedDevVars,
  findPlaceholderDatabaseIds,
  findPlaceholderUrls,
} from "../scripts/deploy-guard.mjs";

test("deploy guard (tickets 77 and 89)", async (t) => {
  await t.test("stripJsonComments keeps URLs and string contents intact", () => {
    const text = `{
      // a line comment
      /* a block
         comment */
      "vars": { "API_BASE_URL": "https://api.example.com/v1" } // trailing
    }`;
    const parsed = JSON.parse(stripJsonComments(text));
    assert.equal(parsed.vars.API_BASE_URL, "https://api.example.com/v1");
  });

  await t.test("findDeployedDevVars reports dev vars at top level and per env", () => {
    const config = JSON.stringify({
      vars: { ENABLE_R2_TEST: "true", SOMETHING_ELSE: "1" },
      env: { staging: { vars: { FARM_CROSSSYNC_LOCAL_DEV: "true" } } },
    });
    assert.deepEqual(
      findDeployedDevVars(config).sort(),
      ["ENABLE_R2_TEST", "FARM_CROSSSYNC_LOCAL_DEV"].sort(),
    );
  });

  await t.test("findDeployedDevVars accepts a config with no dev vars", () => {
    assert.deepEqual(findDeployedDevVars('{"vars":{"A":"1"}}'), []);
  });

  await t.test("every dev-only var name is detected", () => {
    for (const name of DEV_ONLY_VARS) {
      const found = findDeployedDevVars(JSON.stringify({ vars: { [name]: "x" } }));
      assert.deepEqual(found, [name], `${name} must be detected`);
    }
  });

  await t.test("findPlaceholderDatabaseIds flags scaffold and missing ids", () => {
    const config = {
      d1_databases: [{ binding: "DB", database_id: "00000000-0000-0000-0000-000000000000" }],
    };
    assert.equal(findPlaceholderDatabaseIds(config).length, 1);

    assert.equal(
      findPlaceholderDatabaseIds({ d1_databases: [{ database_id: "" }] }).length,
      1,
      "empty id is a placeholder",
    );
    assert.equal(
      findPlaceholderDatabaseIds({ d1_databases: [{}] }).length,
      1,
      "missing id is a placeholder",
    );
  });

  await t.test("findPlaceholderDatabaseIds accepts a real id", () => {
    const config = {
      d1_databases: [
        { binding: "DB", database_id: "9f2c1b7a-3d4e-4a5b-8c9d-0e1f2a3b4c5d" },
      ],
    };
    assert.deepEqual(findPlaceholderDatabaseIds(config), []);
  });

  await t.test("findPlaceholderDatabaseIds looks inside env blocks", () => {
    const config = {
      d1_databases: [{ database_id: "9f2c1b7a-3d4e-4a5b-8c9d-0e1f2a3b4c5d" }],
      env: {
        production: {
          d1_databases: [{ database_id: "changeme" }],
        },
      },
    };
    assert.equal(findPlaceholderDatabaseIds(config).length, 1);
  });

  await t.test("findPlaceholderUrls flags placeholder endpoints only", () => {
    assert.equal(
      findPlaceholderUrls({ vars: { API_BASE_URL: "https://api.example.com" } }).length,
      1,
    );
    assert.equal(
      findPlaceholderUrls({ vars: { API_BASE_URL: "https://api.farmcrosssync.com" } }).length,
      0,
    );
    assert.equal(
      findPlaceholderUrls({ vars: { API_BASE_URL: "http://localhost:8787" } }).length,
      1,
      "a localhost endpoint is not deployable",
    );
  });

  await t.test("findPlaceholderUrls ignores non-endpoint vars", () => {
    assert.deepEqual(
      findPlaceholderUrls({ vars: { ENABLE_R2_TEST: "https://api.example.com" } }),
      [],
      "only URL-like var names are inspected",
    );
  });

  await t.test("required secrets and dev vars are disjoint", () => {
    for (const name of REQUIRED_SECRETS) {
      assert.ok(!DEV_ONLY_VARS.includes(name));
    }
  });
});
