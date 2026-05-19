import test from "node:test";
import assert from "node:assert/strict";

import { splitSubjectAndBody } from "../src/email-sender.mjs";

const FALLBACK_SUBJECT = "🚨 Venderly Error — Debug assistant report";

test("splitSubjectAndBody extracts a case-insensitive SUBJECT line and removes it from the body", () => {
  const aiResponse = [
    "<h2>WHAT BROKE</h2>",
    "subject: 🚨 Venderly Error — Snapshot failed",
    "<p>The snapshot did not apply.</p>"
  ].join("\n");

  const result = splitSubjectAndBody(aiResponse);

  assert.equal(result.subject, "🚨 Venderly Error — Snapshot failed");
  assert.equal(result.htmlBody, "<h2>WHAT BROKE</h2>\n<p>The snapshot did not apply.</p>");
});

test("splitSubjectAndBody falls back to FALLBACK_SUBJECT when no SUBJECT line exists and preserves the full body", () => {
  const aiResponse = "<h2>WHAT BROKE</h2>\n<p>The snapshot did not apply.</p>";

  const result = splitSubjectAndBody(aiResponse);

  assert.equal(result.subject, FALLBACK_SUBJECT);
  assert.equal(result.htmlBody, aiResponse);
});
