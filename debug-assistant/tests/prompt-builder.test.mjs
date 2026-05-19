import test from "node:test";
import assert from "node:assert/strict";

import { buildDebugPrompt } from "../src/prompt-builder.mjs";

test("buildDebugPrompt contains all required section headers", () => {
  const prompt = buildDebugPrompt({
    error: buildError(),
    knowledge: "CloudWatch query: search for contactId"
  });

  for (const header of [
    "WHAT BROKE",
    "WHY IT HAPPENED",
    "WHAT TO DO",
    "HOW TO VERIFY IT WORKED",
    "IF THIS DOESN'T WORK",
    "TECHNICAL DETAILS"
  ]) {
    assert.match(prompt, new RegExp(header.replace(/[()]/g, "\\$&")));
  }
});

test("buildDebugPrompt contains the knowledge string verbatim", () => {
  const knowledge = "CloudWatch query: fields @timestamp, @message | filter @message like /contact-123/";

  const prompt = buildDebugPrompt({
    error: buildError(),
    knowledge
  });

  assert.ok(prompt.includes(knowledge));
});

test("buildDebugPrompt uses unknown for undefined embedded error fields", () => {
  const prompt = buildDebugPrompt({
    error: {
      subject: "Venderly automation failed",
      message: "Something failed",
      originalMessage: "Something failed",
      timestamp: "2026-05-01T10:23:45.123Z",
      parsedMessage: {},
      messageAttributes: {}
    },
    knowledge: "Knowledge"
  });

  assert.ok(prompt.includes('"contactId": "unknown"'));
  assert.ok(prompt.includes('"customerName": "unknown"'));
  assert.ok(prompt.includes('"locationId": "unknown"'));
  assert.ok(prompt.includes('"workflow": "unknown"'));
});

function buildError() {
  return {
    subject: "Venderly automation failed",
    message: "Snapshot failed",
    originalMessage: "Snapshot failed",
    timestamp: "2026-05-01T10:23:45.123Z",
    contactId: "contact-123",
    customerName: "Example Dental",
    locationId: "location-456",
    workflow: "apply-snapshot",
    parsedMessage: {},
    messageAttributes: {}
  };
}
