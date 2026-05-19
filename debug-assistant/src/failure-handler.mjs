import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

export async function publishLambdaFailure({ originalError, failureReason, topicArn, region }) {
  if (!topicArn) {
    throw new Error("BACKUP_SNS_TOPIC_ARN is missing, cannot publish failure alert");
  }

  const client = new SNSClient({ region });
  const message = `Lambda Debug Assistant Failed

Original Error: ${originalError ?? "unknown"}
Lambda Failure Reason: ${failureReason ?? "unknown"}
Timestamp: ${new Date().toISOString()}

Please debug manually. Check CloudWatch logs for venderly-debug-assistant.`;

  console.log("Publishing backup SNS failure alert");

  return client.send(
    new PublishCommand({
      TopicArn: topicArn,
      Subject: "Venderly Debug Assistant Lambda Failed",
      Message: message
    })
  );
}
