export function parseSnsEvent(event) {
  const sns = event?.Records?.[0]?.Sns;

  if (!sns) {
    throw new Error("Invalid SNS event: expected Records[0].Sns");
  }

  if (typeof sns.Message !== "string" || sns.Message.length === 0) {
    throw new Error("Invalid SNS event: Sns.Message must be a non-empty string");
  }

  const originalMessage = sns.Message;
  const parsedMessage = parseMessage(originalMessage);
  const messageAttributes = normalizeMessageAttributes(sns.MessageAttributes);

  const error = {
    originalMessage,
    parsedMessage,
    message: getFirstStringValue(parsedMessage, [
      "message",
      "error",
      "errorMessage",
      "details",
      "reason"
    ]) ?? originalMessage,
    subject: sns.Subject ?? getFirstStringValue(parsedMessage, ["subject", "title"]) ?? "Venderly automation error",
    timestamp: getFirstStringValue(parsedMessage, ["timestamp", "time", "createdAt"]) ?? sns.Timestamp ?? new Date().toISOString(),
    messageAttributes,
    contactId: getFirstStringValue(parsedMessage, ["contactId", "contact_id", "ghlContactId"]),
    customerName: getFirstStringValue(parsedMessage, ["customerName", "customer", "name", "businessName", "companyName"]),
    locationId: getFirstStringValue(parsedMessage, ["locationId", "location_id", "subaccountId", "subAccountId"]),
    workflow: getFirstStringValue(parsedMessage, ["workflow", "step", "stage", "operation"])
  };

  return error;
}

export function getOriginalErrorForFailure(event) {
  const message = event?.Records?.[0]?.Sns?.Message;

  if (typeof message === "string" && message.length > 0) {
    return message;
  }

  try {
    return JSON.stringify(event);
  } catch {
    return "Could not read original SNS event";
  }
}

function parseMessage(message) {
  try {
    const parsed = JSON.parse(message);
    return parsed && typeof parsed === "object" ? parsed : { message: String(parsed) };
  } catch {
    return { message };
  }
}

function normalizeMessageAttributes(attributes = {}) {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      value?.StringValue ?? value?.BinaryValue ?? value?.Value ?? value
    ])
  );
}

function getFirstStringValue(source, keys) {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }

  return undefined;
}
