import test from "node:test";
import assert from "node:assert/strict";

import { getOriginalErrorForFailure, parseSnsEvent } from "../src/parser.mjs";

test("parseSnsEvent returns normalized top-level fields from a JSON SNS Message", () => {
  const event = buildSnsEvent({
    Message: JSON.stringify({
      contactId: " contact-123 ",
      customerName: " Example Dental ",
      workflow: " apply-snapshot "
    })
  });

  const error = parseSnsEvent(event);

  assert.equal(error.contactId, "contact-123");
  assert.equal(error.customerName, "Example Dental");
  assert.equal(error.workflow, "apply-snapshot");
});

test("parseSnsEvent returns parsed message object for a non-JSON SNS Message", () => {
  const originalMessage = "Snapshot application failed for Example Dental";
  const event = buildSnsEvent({ Message: originalMessage });
  let error;

  assert.doesNotThrow(() => {
    error = parseSnsEvent(event);
  });

  assert.deepEqual(error.parsedMessage, { message: originalMessage });
  assert.equal(error.message, originalMessage);
});

test("parseSnsEvent throws when Records[0].Sns is missing", () => {
  assert.throws(
    () => parseSnsEvent({ Records: [{}] }),
    /Invalid SNS event: expected Records\[0\]\.Sns/
  );
});

test("getOriginalErrorForFailure returns the SNS Message when present", () => {
  const event = buildSnsEvent({ Message: "Original SNS failure" });

  assert.equal(getOriginalErrorForFailure(event), "Original SNS failure");
});

test("getOriginalErrorForFailure returns JSON.stringify(event) when no SNS Message is present", () => {
  const event = { Records: [{ Sns: {} }], fallback: true };

  assert.equal(getOriginalErrorForFailure(event), JSON.stringify(event));
});

function buildSnsEvent(overrides = {}) {
  return {
    Records: [
      {
        Sns: {
          Subject: "Venderly automation failed",
          Message: "Default failure",
          Timestamp: "2026-05-01T10:23:45.123Z",
          MessageAttributes: {},
          ...overrides
        }
      }
    ]
  };
}
