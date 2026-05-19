import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

export async function loadKnowledgeFiles({ bucket, files, region }) {
  const client = new S3Client({ region });
  const fileNames = files
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean);

  if (fileNames.length === 0) {
    throw new Error("KNOWLEDGE_FILES must include at least one file");
  }

  const contents = await Promise.all(
    fileNames.map(async (fileName) => {
      console.log(`Loading knowledge file from S3: s3://${bucket}/${fileName}`);

      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: fileName
        })
      );

      const body = await response.Body.transformToString();

      return `# Knowledge file: ${fileName}\n\n${body}`;
    })
  );

  return contents.join("\n\n---\n\n");
}
