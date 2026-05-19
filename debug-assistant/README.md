# Venderly Debug Assistant Lambda

This Lambda receives Venderly SNS error alerts, reads debugging knowledge from S3, asks AWS Bedrock Nova Micro to explain the issue, and emails Ryan and Amarnath through SES.

## Files

- `index.mjs` - Lambda handler
- `src/parser.mjs` - parses SNS alerts
- `src/knowledge.mjs` - loads Markdown knowledge files from S3
- `src/prompt-builder.mjs` - builds the Bedrock prompt
- `src/bedrock.mjs` - calls Bedrock Nova Micro
- `src/email-sender.mjs` - sends the SES email
- `src/failure-handler.mjs` - publishes backup SNS alerts
- `test-event.json` - Lambda console test event

## Install Dependencies

```bash
npm install
```

## Environment Variables

Set these on the Lambda function:

```bash
AWS_REGION=us-east-2
KNOWLEDGE_BUCKET=venderly-debug-knowledge
KNOWLEDGE_FILES=process-flow.md
BEDROCK_MODEL_ID=amazon.nova-micro-v1:0
SES_SENDER=amarnath@udel.edu
EMAIL_RECIPIENTS=ryan@venderly.us,amarnath@udel.edu
BACKUP_SNS_TOPIC_ARN=arn:aws:sns:us-east-2:980228515132:venderly-lambda-failures
```

## IAM Permissions

The Lambda execution role needs:

- `s3:GetObject` for `arn:aws:s3:::venderly-debug-knowledge/*`
- `bedrock:InvokeModel`
- `bedrock:Converse`
- `ses:SendEmail`
- `sns:Publish` for `arn:aws:sns:us-east-2:980228515132:venderly-lambda-failures`

## Zip the Lambda

Run this after `npm install`:

```bash
zip -r function.zip index.mjs src node_modules package.json
```

## Upload

### AWS Console

1. Open the Lambda function in AWS.
2. Choose **Upload from**.
3. Select `.zip file`.
4. Upload `function.zip`.
5. Set the runtime to **Node.js 20.x**.
6. Set the handler to `index.handler`.

### AWS CLI

```bash
aws lambda update-function-code \
  --function-name venderly-debug-assistant \
  --zip-file fileb://function.zip \
  --region us-east-2
```

## Configure the SNS Trigger

Subscribe the Lambda to:

```text
arn:aws:sns:us-east-2:980228515132:venderly-nva-alerts
```

AWS usually adds the Lambda invoke permission when you create the trigger in the console. If you configure it manually, allow SNS to invoke the Lambda.

## Test in Lambda Console

1. Open the Lambda function.
2. Go to the **Test** tab.
3. Create a new test event.
4. Paste the contents of `test-event.json`.
5. Run the test.

Expected result:

- The Lambda reads `process-flow.md` from S3.
- Bedrock returns an HTML-friendly email.
- SES sends the email to `ryan@venderly.us` and `amarnath@udel.edu`.
- CloudWatch logs show `Debug email sent`.

## Failure Behavior

If parsing, S3, Bedrock, or SES fails, the Lambda logs the full failure to CloudWatch and publishes a backup alert to:

```text
arn:aws:sns:us-east-2:980228515132:venderly-lambda-failures
```

The backup alert includes the original SNS error, the Lambda failure reason, a timestamp, and a manual-debug instruction.

## Local Syntax Check

```bash
npm run check
```
