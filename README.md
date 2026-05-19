# Venderly Provisioning & Finance Automation

This monorepo holds two production services that together automate Venderly's onboarding pipeline: `nva-webhook` provisions GoHighLevel sub-accounts and links Stripe subscriptions when a customer signs up; `debug-assistant` is an AI-assisted Lambda that emails the team a plain-English root-cause analysis when an upstream workflow fails.

## Projects

| Subfolder | Role | Runtime | Deployment target | Status |
| --- | --- | --- | --- | --- |
| `nva-webhook/` | NVA provisioning webhook (GHL + Stripe) | Node 20 / Express | AWS App Runner | v1.0.0 |
| `debug-assistant/` | AI failure-email responder (Bedrock Nova Micro RAG) | Node 20 / Lambda (ESM) | AWS Lambda | v1.0.0 |

## Repository layout

```text
.
├── .github/
│   └── workflows/
│       ├── debug-assistant-ci.yml
│       └── nva-webhook-ci.yml
├── .gitignore
├── CHANGELOG.md
├── LICENSE
├── README.md
├── debug-assistant/
│   ├── .gitignore
│   ├── README.md
│   ├── docs/
│   ├── index.mjs
│   ├── package-lock.json
│   ├── package.json
│   ├── src/
│   ├── test-event.json
│   └── tests/
├── docs/
│   ├── Makefile
│   ├── README.MD
│   ├── make.bat
│   ├── requirements.txt
│   └── source/
└── nva-webhook/
    ├── .dockerignore
    ├── .env.example
    ├── .gitignore
    ├── CHANGELOG.md
    ├── Dockerfile
    ├── LICENSE
    ├── README.md
    ├── apprunner.yaml
    ├── docs/
    ├── index.js
    ├── package-lock.json
    ├── package.json
    ├── scripts/
    ├── src/
    └── tests/
```

## Local development

For the provisioning webhook:

```sh
cd nva-webhook && npm ci && npm run check
cd nva-webhook && npm test
```

`nva-webhook` includes 9 unit tests.

For the debug assistant Lambda:

```sh
cd debug-assistant && npm ci && npm run check
```

`debug-assistant` invocations are exercised via `node --check` for now.

## Deployment

See each subproject README for AWS-specific deployment instructions:

- [`nva-webhook/README.md`](nva-webhook/README.md)
- [`debug-assistant/README.md`](debug-assistant/README.md)

Production deploys are gated by the per-project GitHub Actions workflows in `.github/workflows/`.

## Releases

See [`CHANGELOG.md`](CHANGELOG.md) for Keep-a-Changelog formatted release notes. Release `v1.0.0` is also tracked with git tags.

## License

MIT, see [`LICENSE`](LICENSE).
