import { parseSnsEvent, getOriginalErrorForFailure } from "./src/parser.mjs";
import { loadKnowledgeFiles } from "./src/knowledge.mjs";
import { buildDebugPrompt } from "./src/prompt-builder.mjs";
import { generateDebugEmail } from "./src/bedrock.mjs";
import { sendDebugEmail } from "./src/email-sender.mjs";
import { publishLambdaFailure } from "./src/failure-handler.mjs";

const REQUIRED_ENV_VARS = [
  "AWS_REGION",
  "KNOWLEDGE_BUCKET",
  "KNOWLEDGE_FILES",
  "BEDROCK_MODEL_ID",
  "SES_SENDER",
  "EMAIL_RECIPIENTS",
  "BACKUP_SNS_TOPIC_ARN"
];

export const handler = async (event) => {
  let parsedError;

  try {
    validateEnvironment();

    console.log("Received SNS event", JSON.stringify(event));

    parsedError = parseSnsEvent(event);
    console.log("Parsed error alert", JSON.stringify({
      subject: parsedError.subject,
      timestamp: parsedError.timestamp,
      contactId: parsedError.contactId,
      customerName: parsedError.customerName
    }));

    const knowledge = await loadKnowledgeFiles({
      bucket: process.env.KNOWLEDGE_BUCKET,
      files: process.env.KNOWLEDGE_FILES,
      region: process.env.AWS_REGION
    });

    const prompt = buildDebugPrompt({
      error: parsedError,
      knowledge
    });

    const aiResponse = await generateDebugEmail({
      prompt,
      modelId: process.env.BEDROCK_MODEL_ID,
      region: process.env.AWS_REGION
    });

    const emailResult = await sendDebugEmail({
      aiResponse,
      sender: process.env.SES_SENDER,
      recipients: process.env.EMAIL_RECIPIENTS,
      region: process.env.AWS_REGION
    });

    console.log("Debug email sent", JSON.stringify({
      messageId: emailResult.MessageId,
      recipients: process.env.EMAIL_RECIPIENTS
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Debug email sent successfully",
        sesMessageId: emailResult.MessageId
      })
    };
  } catch (error) {
    console.error("Venderly debug assistant failed", {
      message: error.message,
      stack: error.stack,
      event
    });

    try {
      await publishLambdaFailure({
        originalError: parsedError?.originalMessage ?? getOriginalErrorForFailure(event),
        failureReason: error.message,
        topicArn: process.env.BACKUP_SNS_TOPIC_ARN,
        region: process.env.AWS_REGION
      });
    } catch (backupError) {
      console.error("Failed to publish backup SNS alert", {
        message: backupError.message,
        stack: backupError.stack
      });
    }

    throw error;
  }
};

function validateEnvironment() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
