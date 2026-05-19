import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

export async function generateDebugEmail({ prompt, modelId, region }) {
  const client = new BedrockRuntimeClient({ region });

  console.log(`Calling Bedrock model: ${modelId}`);

  const response = await client.send(
    new ConverseCommand({
      modelId,
      messages: [
        {
          role: "user",
          content: [
            {
              text: prompt
            }
          ]
        }
      ],
      inferenceConfig: {
        maxTokens: 1600,
        temperature: 0.2,
        topP: 0.9
      }
    })
  );

  const text = response.output?.message?.content
    ?.map((part) => part.text)
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Bedrock returned an empty response");
  }

  return text;
}
