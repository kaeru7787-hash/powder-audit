import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { load, save, storageKey } from "../src/storage";
import { newSession } from "../src/domain";
import { readFileSync } from "node:fs";
let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    },
  });
});
test("初回保存と再読込", () => {
  const initial = load();
  assert.equal(initial.revision, 0);
  save(initial, 0);
  assert.equal(load().revision, 1);
});
test("旧テスト処方を監査画面から外して履歴に保持し、保存後も重複しない", () => {
  const prescription = JSON.parse(
    readFileSync(
      new URL("./fixtures/demo-prescription.json", import.meta.url),
      "utf8",
    ),
  );
  const old = newSession(prescription, true);
  data.set(
    storageKey,
    JSON.stringify({ revision: 3, current: old, archived: [], master: [] }),
  );
  const migrated = load();
  assert.equal(migrated.current, null);
  assert.equal(migrated.archived[0].id, old.id);
  assert.ok(migrated.archived[0].endedAt);
  save(migrated, 3);
  assert.equal(load().archived.length, 1);
});
test("古い画面からの更新は拒否", () => {
  const initial = load();
  save(initial, 0);
  assert.throws(() => save(initial, 0), { code: "CONCURRENT_CHANGE" });
});
test("保存容量不足は成功扱いにしない", () => {
  const initial = load();
  localStorage.setItem = () => {
    throw new Error("quota");
  };
  assert.throws(() => save(initial, 0), { code: "STORAGE_FAILED" });
  assert.equal(initial.revision, 0);
});
test("壊れた保存データを黙って消さない", () => {
  data.set(storageKey, "broken");
  assert.throws(() => load(), { code: "STORAGE_CORRUPT" });
  assert.equal(data.get(storageKey), "broken");
});
