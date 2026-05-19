# Venderly NVA Automation — Process Flow & Debug Reference

> This document is the source of truth for how the Venderly New Vendor Account (NVA) automation works end-to-end. It is consumed by an AWS Bedrock-powered debug assistant. Each step lists what happens, the file or service responsible, the specific failure modes to check, and the exact CloudWatch search patterns that confirm whether the step succeeded or failed.
>
> Audience: the assistant should treat the user as non-technical. Translate any error code or stack trace into plain English before asking the user to check anything. When suggesting CloudWatch searches, give the user the literal search string to paste.

---

## System overview

When a prospective Venderly customer submits the NVA form on **venderly.us**, the system automatically:

1. Creates a new GoHighLevel sub-account for them
2. Applies a snapshot (template) based on which customer type they selected
3. Records the new sub-account in DynamoDB so the right CSS group is applied in the agency UI
4. Creates a Stripe Connect Standard account in their name
5. Generates a Stripe onboarding URL
6. Sends that URL back to GHL via an inbound webhook so a contact field is updated
7. Triggers the welcome email through a downstream GHL workflow

A failure at any step publishes an alert to SNS topic `venderly-nva-alerts`, which emails **Ryan** and **Amarnath**.

The full flow takes roughly 20–40 seconds from form submit to the customer receiving their welcome email.

---

## Key resources and identifiers

| Resource | Identifier |
|---|---|
| GitHub repo | `https://github.com/Amar240/venderly-nva-webhook` |
| Active branch | `feature/stripe-email-setup` |
| App Runner service URL | `https://tn4e9g7353.us-east-2.awsapprunner.com` |
| Webhook endpoint | `POST /webhook/nva` |
| AWS region | `us-east-2` |
| CloudWatch log group | `/aws/apprunner/venderly-nva-webhook/application` |
| DynamoDB table | `venderly-subaccounts` |
| SNS topic ARN | `arn:aws:sns:us-east-2:980228515132:venderly-nva-alerts` |
| GHL Company ID | `m7cUhyQx6khG6hg8K2r7` |
| Test sub-account | `$Dev-Demo` (locationId: `bDzcN87S8TJmlcG3HIun`) |

## Required environment variables (set in App Runner)

`GHL_ACCESS_TOKEN`, `GHL_COMPANY_ID`, `GHL_INBOUND_WEBHOOK_URL`, `SNAPSHOT_SMALL_BUSINESS`, `SNAPSHOT_SIDE_HUSTLE`, `SNAPSHOT_SCHOOL`, `SNAPSHOT_NONPROFIT`, `SNAPSHOT_BANK`, `SNAPSHOT_DEFAULT`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_REFRESH_URL`, `STRIPE_RETURN_URL`, `SNS_TOPIC_ARN`.

A missing required env var will cause the App Runner service to fail at startup. If the service won't boot, the first thing to check is `src/server.js` env var validation log lines.

## Customer type → snapshot and CSS group mapping

| `customer_type` form value | Snapshot env var read | CSS group stored in DynamoDB |
|---|---|---|
| `Small Business` | `SNAPSHOT_SMALL_BUSINESS` | `PRO` |
| `Side Hustle` | `SNAPSHOT_SIDE_HUSTLE` | `PRO` |
| `School District` | `SNAPSHOT_SCHOOL` | `SCHOOL` |
| `Nonprofit` | `SNAPSHOT_NONPROFIT` | `PRO` |
| `Bank/Fintech` | `SNAPSHOT_BANK` | `PRO` |
| anything else / missing | `SNAPSHOT_DEFAULT` | `PRO` |

Only `School District` maps to the `SCHOOL` CSS group. Everything else falls into `PRO`.

---

# Step-by-step flow

## Step 1 — Customer submits the NVA form

**What happens:** The customer fills out the NVA form on venderly.us and clicks Submit. GoHighLevel records a new contact in the Venderly agency with the form fields written to contact custom fields.

**Handled by:** GoHighLevel form (no Venderly code is invoked).

**What could fail:**
- The form is unpublished or removed from venderly.us
- Required fields (email, `customer_type`, business name) are missing from the form definition
- venderly.us website is down
- A custom field was renamed in GHL but not updated in the form mapping, so the value is silently dropped

**Where to verify:** This step is not in CloudWatch. Verify inside GHL:
- Open the Venderly agency → **Contacts** → confirm the new contact appears with the customer's email
- Click into the contact and confirm `customer_type`, `business_name`, and `email` are populated
- If the contact doesn't exist at all, the form itself failed — check the embed code on venderly.us and that the form is published

**Common user-reported symptom that maps to this step:** "I filled out the form and nothing happened at all, no email arrived."

---

## Step 2 — GHL Workflow 1 fires the webhook

**What happens:** Workflow **"Sign-Up All Info Rec'd (Automate Sub-Account)"** triggers when the new contact is created. It waits 15 seconds (so GHL has time to finish writing every custom field), then sends a Custom Webhook POST to `https://tn4e9g7353.us-east-2.awsapprunner.com/webhook/nva` carrying the contact data as JSON.

**Handled by:** GoHighLevel Workflow 1.

**What could fail:**
- Workflow is in **Draft** status instead of **Published**
- Wait step was changed to 0 seconds, so the payload arrives before GHL writes all fields
- The Custom Webhook URL was edited and now points to the wrong host
- Workflow filter excludes this contact (e.g., a tag the contact doesn't have)
- App Runner service is down or returning 5xx — POST fails

**Where to verify:**
- **GHL:** Automation → Workflows → "Sign-Up All Info Rec'd (Automate Sub-Account)" → **History** tab → find the contact's run. The Custom Webhook step should show a green check and a 200 status. A red X with 4xx/5xx means the POST reached App Runner but App Runner returned an error.
- **CloudWatch:** log group `/aws/apprunner/venderly-nva-webhook/application`, paste this search string in the Logs Insights or filter bar:

  ```
  "POST /webhook/nva"
  ```

  An entry should appear within ~16 seconds of the contact being created. If there is **no** entry, the request never reached App Runner — the problem is on GHL's side or in the URL.

**Common user-reported symptom:** "It used to work but now nothing happens after I submit the form." → almost always Workflow 1 was unpublished, or the App Runner URL changed after a redeploy.

---

## Step 3 — App Runner receives the webhook and validates the payload

**What happens:** Express receives the POST at `/webhook/nva`, parses the JSON body, and validates that required fields exist (`contactId`, `email`, `customer_type`, `business_name`).

**Handled by:** `src/server.js` (boots Express), `src/app.js` (wires routes), `src/routes/webhook-nva.js` (handler).

**What could fail:**
- Request body is empty or malformed (Workflow misconfigured to send query params instead of JSON)
- A required field is missing or empty
- Body too large (extremely unlikely for this payload)
- App Runner instance is restarting due to a previous crash

**Where to verify:** CloudWatch log group `/aws/apprunner/venderly-nva-webhook/application`. Search for the contact's email or contactId:

```
"contactId" "<contact id from GHL>"
```

You should see two log lines in sequence:
- `Received NVA webhook` with the parsed payload
- Either `Validation passed` or `Validation failed: missing field <name>`

If you see `Validation failed`, the field name in the log tells you exactly what GHL did not send. Cross-check with Step 1 to confirm the field exists on the contact.

**Common user-reported symptom:** "The customer says they got the form back with no error, but I never got the welcome email." → check for a 400 response in this step, then Step 1.

---

## Step 4 — Server creates the GHL sub-account

**What happens:** The handler calls `ghlService.createLocation(payload)` which POSTs to `https://services.leadconnectorhq.com/locations/` using the agency Private Integration Token. The response includes the new `locationId`.

**Handled by:** `src/services/ghl-service.js` → `createLocation()`. Authentication uses `GHL_ACCESS_TOKEN`. Payload assembly is in `src/utils/location-builder.js` (maps form data to the GHL location schema, sets timezone via `src/utils/timezone.js`).

**What could fail:**
- `GHL_ACCESS_TOKEN` expired or rotated and not updated in App Runner env vars (returns **401 Unauthorized**)
- Token lacks the `locations.write` scope (returns **403 Forbidden**)
- GHL API rate limit exceeded (returns **429 Too Many Requests**)
- Required field missing in the constructed payload — usually means a form field was empty (returns **422 Unprocessable Entity** with field name)
- Postal code → timezone mapping returned `undefined` because the postal code is non-US or unrecognized (`src/utils/timezone.js`)
- GHL platform incident (rare; 5xx)

**Where to verify:** CloudWatch search:

```
"createLocation" "<contactId>"
```

You will see one of:
- `createLocation success: locationId=<id>` — step succeeded
- `createLocation failed: status=<code> body=<response>` — step failed; the status code and response body explain why

**If 401:** the access token is dead. Generate a fresh Private Integration Token in GHL → Agency Settings → Private Integrations → "Account Auto-Generator" → update `GHL_ACCESS_TOKEN` in App Runner → redeploy.

**If 403:** the token exists but is missing scopes. The "Account Auto-Generator" PIT must have `locations.write`, `snapshots.write`, and `users.write`.

**If 422:** read the field name in the response body — this points back to a form field issue in Step 1.

---

## Step 5 — Server applies the snapshot to the new sub-account

**What happens:** Based on `customer_type`, the handler picks the matching snapshot ID from env vars (see mapping table above) and calls `ghlService.applySnapshot(locationId, snapshotId)`, which PUTs to `https://services.leadconnectorhq.com/locations/{locationId}` with the snapshot reference.

**Handled by:** `src/services/ghl-service.js` → `applySnapshot()`. Snapshot selection logic is in `src/utils/location-builder.js`.

**What could fail:**
- The snapshot env var for this customer type is unset → `undefined` is sent → **400 Bad Request** from GHL
- The snapshot ID is wrong (typo, or snapshot was deleted in GHL) → **404 Not Found**
- Token lacks `snapshots.write` scope → **403 Forbidden**
- The snapshot itself is corrupted or has a broken automation reference (rare; **500** from GHL)
- Customer type contains an unexpected value → fallback to `SNAPSHOT_DEFAULT`. If `SNAPSHOT_DEFAULT` is also unset, snapshot is skipped silently and the sub-account exists but is empty

**Where to verify:** CloudWatch search:

```
"applySnapshot" "<locationId>"
```

Look for:
- `applySnapshot success: snapshotId=<id>` — step succeeded
- `applySnapshot failed: status=<code>` — step failed
- `Unknown customer_type "<value>", falling back to default snapshot` — the form value did not match any known type

**If the sub-account exists but is empty inside GHL,** this step likely failed silently. Check the env vars are populated.

---

## Step 6 — Server saves the sub-account record to DynamoDB

**What happens:** The handler writes a row to the `venderly-subaccounts` table containing `{locationId, customerType, cssGroup, contactId, email, createdAt}`. The `cssGroup` is `SCHOOL` for School District customers and `PRO` for everyone else (see mapping table above). This row is read by the dynamic CSS endpoint that GHL's Custom CSS imports.

**Handled by:** `src/routes/webhook-nva.js` (the DynamoDB write is inline; the AWS SDK call uses default credentials provided by App Runner's IAM role).

**What could fail:**
- App Runner's IAM role lacks `dynamodb:PutItem` on the `venderly-subaccounts` table → **AccessDeniedException**
- Table does not exist or is in a different region → **ResourceNotFoundException**
- Schema mismatch (e.g., partition key renamed) → **ValidationException**
- DynamoDB throttling (very unlikely on on-demand pricing)

**Where to verify:** CloudWatch search:

```
"DynamoDB" "<locationId>"
```

Look for:
- `Saved to DynamoDB: locationId=<id> cssGroup=<PRO|SCHOOL>` — success
- `DynamoDB write failed: <error>` — failure with the AWS error name

**To confirm the row landed:** in the AWS Console → DynamoDB → Tables → `venderly-subaccounts` → Explore items → search by the `locationId`. The CSS endpoint reads from this table, so a missing row means the customer's sub-account chrome will use default styling instead of `PRO` or `SCHOOL` rules.

---

## Step 7 — Server creates the Stripe Connect Standard account

**What happens:** The handler calls `stripeService.createConnectAccount({email, businessName, country})` which calls Stripe's `accounts.create({ type: 'standard', email, ... })`. Stripe returns a connected account ID like `acct_1Xxxxxxxxxxxxx`.

**Handled by:** `src/services/stripe-service.js` → `createConnectAccount()`. Authenticated with `STRIPE_SECRET_KEY`.

**What could fail:**
- `STRIPE_SECRET_KEY` missing or invalid → **401** from Stripe
- The customer's email is malformed → **400** from Stripe with `email_invalid`
- Stripe rejects the country code (e.g., country not supported for Connect) → **400**
- Stripe API outage (extremely rare; **5xx**)
- Account creation succeeded but a network timeout meant we did not record the ID — re-running the webhook will create a duplicate Stripe account

**Where to verify:** CloudWatch search:

```
"Stripe account" "<email>"
```

Look for:
- `Created Stripe account: id=acct_<...>` — success
- `Stripe account creation failed: <error code> <message>` — failure

**To cross-check in Stripe:** log in to the Venderly platform Stripe dashboard → Connected accounts → search by email or by the `acct_` ID. If the account exists in Stripe but the App Runner log says it failed, the network/timeout case happened.

---

## Step 8 — Server generates the Stripe onboarding URL

**What happens:** The handler calls `stripeService.createAccountLink(accountId)` which calls Stripe's `accountLinks.create({ account, refresh_url: STRIPE_REFRESH_URL, return_url: STRIPE_RETURN_URL, type: 'account_onboarding' })`. Stripe returns a one-time URL the customer uses to complete onboarding.

**Handled by:** `src/services/stripe-service.js` → `createAccountLink()`.

**What could fail:**
- `STRIPE_REFRESH_URL` or `STRIPE_RETURN_URL` not set or not valid HTTPS URLs → **400**
- The account was created but Stripe hasn't fully provisioned it yet (race condition, very rare)
- Stripe API outage → **5xx**

**Where to verify:** CloudWatch search:

```
"account link" "<acct_ id from previous step>"
```

Look for:
- `Generated onboarding URL: https://connect.stripe.com/setup/...` — success
- `Account link creation failed: <error>` — failure

**Note:** the URL itself expires after a few minutes if not used. If the customer reports clicking an expired link, see Step 11 — the welcome email contains the URL, so a delayed email = expired URL is possible.

---

## Step 9 — Server sends the Stripe URL back to GHL via inbound webhook

**What happens:** The handler calls `ghlService.sendStripeUrlToGhl(contactId, stripeUrl)` which POSTs `{ contactId, stripe_url }` as JSON to the URL stored in `GHL_INBOUND_WEBHOOK_URL`. This URL was generated by GHL Workflow 2's Inbound Webhook trigger and is the only way to update the contact's `stripe_url` custom field without `contacts.write` scope on the PIT.

**Handled by:** `src/services/ghl-service.js` → `sendStripeUrlToGhl()`.

**What could fail:**
- `GHL_INBOUND_WEBHOOK_URL` is not set in App Runner env vars → request fails with `undefined` URL
- The URL is set but Workflow 2 was deleted or its trigger was reset → **404** from GHL
- Workflow 2 is in Draft status → **GHL accepts the POST but the workflow does not run** (silent failure visible only in the workflow history)
- The payload field names don't match what Workflow 2 expects (e.g., `contact_id` vs `contactId`) → workflow runs but the action fails to find/update the contact

**Where to verify:**

CloudWatch search:

```
"inbound webhook" "<contactId>"
```

Look for:
- `Sent stripe_url to GHL inbound webhook: contactId=<id>` — POST succeeded
- `GHL inbound webhook failed (<status>)` — POST failed

**Then verify in GHL:** Automation → Workflow 2 ("Stripe URL Automation Edit") → History → find the run with this contactId. Confirm:
1. The trigger fired (timestamp matches)
2. The "Update contact Stripe URL" action shows green
3. The contact's `stripe_url` custom field is now populated with the Stripe URL

**If the App Runner log shows success but the field is still empty,** Workflow 2 is broken or unpublished — open it and confirm it's Published with both the Inbound Webhook trigger and the update action wired correctly.

---

## Step 10 — GHL Workflow 3 sends the welcome email

**What happens:** Workflow **"Updating New Contact with Stripe URL"** (Workflow 3) is configured with the trigger `Contact Field Changed: stripe_url`. When Workflow 2 updates that field in Step 9, this workflow fires and sends the templated welcome email to the customer's email address. The email contains the Stripe onboarding URL.

**Handled by:** GoHighLevel Workflow 3. No Venderly code involved.

**What could fail:**
- Workflow 3 is in Draft → email never sends
- Trigger filter is wrong (e.g., expects field to change to a specific value)
- Email template references a custom field that no longer exists → email body comes out malformed or blank
- The customer's email address bounces (typo, or domain rejects)
- GHL email-sending quota exceeded (rare for a single tenant)
- Email lands in the customer's spam folder

**Where to verify:** This step is not in CloudWatch. Verify in GHL:
- Automation → Workflow 3 → History → find the run with this contact. Confirm the email step shows green.
- Open the contact → Conversations tab → look for the outbound email. If it shows "Delivered" the customer received it (modulo spam).
- Marketing → Email Statistics → search by recipient to see opens, clicks, bounces.

**Common user-reported symptom:** "The customer never got the welcome email." → first ask them to check spam, then check Workflow 3 history, then check Step 9.

---

## Step 11 — SNS publishes an alert on any failure

**What happens:** Any thrown error in the handler is caught and `snsService.publishAlert({step, error, contactId, email})` is called. SNS fans the message out to the email subscriptions on the `venderly-nva-alerts` topic — currently Ryan and Amarnath.

**Handled by:** `src/services/sns-service.js`.

**What could fail:**
- App Runner's IAM role lacks `sns:Publish` on the topic ARN → silent — the alert never sends and the original error is logged but no human is notified
- `SNS_TOPIC_ARN` env var wrong or unset
- Subscription was unsubscribed (recipient clicked the SNS unsubscribe footer)
- SNS regional outage (rare)

**Where to verify:** CloudWatch search:

```
"SNS"
```

Look for:
- `Published SNS alert: messageId=<id> step=<step name>` — alert was sent to AWS
- `SNS publish failed: <error>` — alert was not sent (and Ryan/Amarnath have no idea something broke)

**To confirm subscriptions are healthy:** AWS Console → SNS → Topics → `venderly-nva-alerts` → Subscriptions tab → confirm both `ryan@...` and `amarnath@udel.edu` show status `Confirmed`. If status is `PendingConfirmation`, the recipient never clicked the confirmation email when the topic was set up.

---

# Quick reference: CloudWatch search patterns by symptom

When the user describes a symptom in plain English, the assistant should map it to the right search:

| User-reported symptom | First search to try | Step to investigate |
|---|---|---|
| "Customer filled the form and nothing happened" | `"POST /webhook/nva"` (look for the contact's timestamp) | Steps 1–2 |
| "Sub-account was created but it's empty" | `"applySnapshot"` | Step 5 |
| "Customer was charged but I don't see them in GHL" | This shouldn't happen — check `"createLocation"` first | Step 4 |
| "Customer never got the welcome email" | `"inbound webhook"` then check Workflow 3 | Steps 9–10 |
| "Stripe link in email is expired" | `"account link"` and email send timestamp | Step 8, Step 10 timing |
| "I got an SNS alert that says X failed" | The alert message includes the step name; search for that step | The named step |
| "I'm not seeing any logs at all" | Check App Runner service status in console | App Runner deployment |

---

# Quick reference: error codes by source

| Code | From | What it usually means |
|---|---|---|
| 401 | GHL or Stripe | Token is wrong, expired, or missing |
| 403 | GHL | Token is missing a required scope |
| 404 | GHL | Snapshot ID or location ID does not exist |
| 422 | GHL | Required field missing in the payload |
| 429 | GHL or Stripe | Rate limit hit — usually transient, retry |
| 5xx | GHL or Stripe | Upstream platform incident — check status pages |
| `AccessDeniedException` | DynamoDB or SNS | App Runner IAM role lacks the permission |
| `ResourceNotFoundException` | DynamoDB | Table doesn't exist or wrong region |

---

# How the assistant should handle a debug session

1. **Ask the user what they're seeing**, in their own words. Don't ask for log output yet.
2. **Map their symptom** to a step using the symptom table above.
3. **Give the user a single, copy-pasteable CloudWatch search string** to paste into the Logs Insights filter bar. Tell them which log group to use.
4. **Interpret what they paste back** — translate any error code into plain English using the error code table. Avoid jargon.
5. **If the failing step is in GHL (Steps 1, 2, 10)**, walk the user through clicking into the workflow History tab — do not assume they know how to navigate GHL.
6. **Suggest exactly one fix at a time.** If the fix involves changing an env var in App Runner, walk through the AWS Console path step by step.
7. **Confirm the fix worked** by asking the user to re-run with a test contact in `$Dev-Demo` (locationId `bDzcN87S8TJmlcG3HIun`) and re-checking the same CloudWatch search.
8. **If you cannot identify the failing step within two exchanges**, escalate by suggesting the user message Amarnath with: the contact's email, the approximate time of the failure, and any error message they saw.

---

# Appendix: file map

| File | Purpose |
|---|---|
| `src/server.js` | Boots Express, validates required env vars, listens on port 3000 |
| `src/app.js` | Wires routes |
| `src/routes/webhook-nva.js` | Main handler — orchestrates all steps |
| `src/services/ghl-service.js` | `createLocation`, `applySnapshot`, `sendStripeUrlToGhl` |
| `src/services/stripe-service.js` | `createConnectAccount`, `createAccountLink` |
| `src/services/sns-service.js` | `publishAlert` |
| `src/config/env.js` | Centralised env var access |
| `src/utils/location-builder.js` | Maps form data to GHL payload, picks snapshot ID |
| `src/utils/timezone.js` | Postal code → IANA timezone |

---

*Last updated: 2026-05-01.