// package-lock.json 시험: 모든 패키지가 레지스트리 주소와 integrity로 고정되고, 저장소 뿌리가 의존성으로 들어가지 않는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const lock = require("./package-lock.json");
const pkg = require("./package.json");

test("lock: 모든 패키지에 resolved(npm 레지스트리)와 integrity가 있다", () => {
  const entries = Object.entries(lock.packages).filter(([key]) => key !== "");
  assert.ok(entries.length > 0);
  for (const [key, entry] of entries) {
    assert.match(entry.resolved || "", /^https:\/\/registry\.npmjs\.org\//, key);
    assert.match(entry.integrity || "", /^sha512-/, key);
  }
});

test("lock: 저장소 뿌리(twin-home)가 의존성으로 들어가지 않는다", () => {
  assert.equal(pkg.dependencies, undefined);
  for (const [key, entry] of Object.entries(lock.packages)) {
    assert.equal(entry.link, undefined, key);
    assert.ok(!key.startsWith(".."), key);
    assert.notEqual(entry.name, "twin-home", key);
  }
  assert.equal(lock.packages[""].devDependencies.electron, pkg.devDependencies.electron);
});
