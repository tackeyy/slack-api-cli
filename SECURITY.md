# Security Policy

## Supported Versions

We release security patches for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use [GitHub Private Vulnerability Reporting](https://github.com/tackeyy/slack-api-cli/security/advisories/new)
to report a vulnerability privately.

Please include the following information:

- Type of vulnerability (e.g., injection, authentication bypass, XSS, token leakage)
- Full paths of source file(s) related to the vulnerability
- Steps to reproduce
- Proof-of-concept or exploit code (if possible)
- Impact assessment (especially around Slack tokens / workspace data exposure)

## Response Process

1. We will acknowledge the report through GitHub Security Advisories
2. We will assess the impact and coordinate next steps with the reporter
3. We will release a patch and publish a security advisory after the fix is ready

## Disclosure Policy

- We follow a coordinated disclosure policy
- We ask that you give us reasonable time to address the vulnerability before public disclosure
- We will credit you in the security advisory (unless you prefer to remain anonymous)

## Scope

The following are **in scope** for security reports:

- Slack token handling and workspace selection in the API client and CLI
- Command injection or argument parsing flaws in `src/cli/`
- Dependency vulnerabilities affecting the TypeScript API and CLI

The following are **out of scope**:

- Vulnerabilities in third-party services (Slack API, Node.js runtime) — please report to the upstream vendor
- Social engineering attacks
- Issues requiring physical access to a victim's machine
