import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";

const FALLBACK_SUBJECT = "🚨 Venderly Error — Debug assistant report";

export async function sendDebugEmail({ aiResponse, sender, recipients, region }) {
  const client = new SESClient({ region });
  const recipientList = recipients
    .split(",")
    .map((recipient) => recipient.trim())
    .filter(Boolean);

  if (recipientList.length === 0) {
    throw new Error("EMAIL_RECIPIENTS must include at least one email address");
  }

  const { subject, htmlBody } = splitSubjectAndBody(aiResponse);

  return client.send(
    new SendEmailCommand({
      Source: sender,
      Destination: {
        ToAddresses: recipientList
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: "UTF-8"
        },
        Body: {
          Html: {
            Data: wrapHtmlEmail(htmlBody),
            Charset: "UTF-8"
          },
          Text: {
            Data: stripHtml(htmlBody),
            Charset: "UTF-8"
          }
        }
      }
    })
  );
}

export function splitSubjectAndBody(aiResponse) {
  const lines = aiResponse.trim().split(/\r?\n/);
  const subjectIndex = lines.findIndex((line) => line.trim().toUpperCase().startsWith("SUBJECT:"));

  if (subjectIndex === -1) {
    return {
      subject: FALLBACK_SUBJECT,
      htmlBody: aiResponse.trim()
    };
  }

  const subject = lines[subjectIndex].replace(/^SUBJECT:\s*/i, "").trim() || FALLBACK_SUBJECT;
  const bodyLines = [
    ...lines.slice(0, subjectIndex),
    ...lines.slice(subjectIndex + 1)
  ];

  return {
    subject,
    htmlBody: bodyLines.join("\n").trim()
  };
}

function wrapHtmlEmail(body) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body style="font-family: Arial, sans-serif; color: #1f2933; line-height: 1.5;">
    ${body}
  </body>
</html>`;
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|h1|h2|h3|li)>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
