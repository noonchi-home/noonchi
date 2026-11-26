import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIENT_ERROR_PATH, clientErrorReport, reportClientError } from "./client-error.ts";

test("a render error becomes a report with the error text, cut stacks, version and time", () => {
  const error = new TypeError("object null is not iterable");
  error.stack = "TypeError: object null is not iterable\n" + "x".repeat(5000);
  const report = clientErrorReport(error, "\n    in ConnectedPlan" + "y".repeat(5000), "1.0.0", 1764000000000);
  assert.deepEqual(Object.keys(report).sort(), ["app_version", "at_ms", "component_stack", "message", "stack"]);
  assert.equal(report.message, "TypeError: object null is not iterable");
  assert.equal(report.stack, error.stack.slice(0, 4000));
  assert.equal(report.component_stack?.length, 4000);
  assert(report.component_stack?.startsWith("\n    in ConnectedPlan"));
  assert.equal(report.app_version, "1.0.0");
  assert.equal(report.at_ms, 1764000000000);
});

test("thrown values that are not errors still give a short message and null stacks", () => {
  assert.deepEqual(clientErrorReport("plain text", undefined, "1.0.0", 1), {
    message: "plain text", stack: null, component_stack: null, app_version: "1.0.0", at_ms: 1,
  });
  assert.equal(clientErrorReport(null, null, "1.0.0", 1).message, "null");
  assert.equal(clientErrorReport(Object.create(null), null, "1.0.0", 1).message, "Error");
  assert.equal(clientErrorReport(new Error("z".repeat(3000)), null, "1.0.0", 1).message.length, 1000);
  const empty = new Error("");
  empty.stack = undefined;
  assert.deepEqual([clientErrorReport(empty, "", "1.0.0", 1).message, clientErrorReport(empty, "", "1.0.0", 1).stack], ["Error", null]);
});

test("the report goes to the connected hub, and any failure is dropped quietly", async () => {
  const report = clientErrorReport(new Error("boom"), null, "1.0.0", 1);
  const sent: [string, object][] = [];
  await reportClientError(() => ({ write: async (path: string, body: object) => { sent.push([path, body]); return {} as never; } }), report);
  assert.deepEqual(sent, [[CLIENT_ERROR_PATH, report]]);
  assert.equal(CLIENT_ERROR_PATH, "/api/mobile/client-error");
  await reportClientError(() => { throw new Error("bad hub address"); }, report);
  await reportClientError(() => ({ write: async () => { throw new Error("offline"); } }), report);
});
