# Contributing to slamy

Thank you for your interest in contributing to slamy! This document provides guidelines and
instructions for contributing to the project.

## 🙏 Welcome!

slamy is a **Node.js / TypeScript** project that ships a Slack API client library and standalone
CLI. A separate Go CLI implementation lives under `go-src/` and is released independently via
`goreleaser`. Contributions to either side are welcome — bug fixes, features, tests, or
documentation.

## 📖 Table of Contents

- [Ways to Contribute](#ways-to-contribute)
- [Before You Start](#before-you-start)
- [Project Scope: Official Slack CLI vs slamy](#project-scope-official-slack-cli-vs-slamy)
- [Development Setup](#development-setup)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Submitting Changes](#submitting-changes)
- [Code Review Process](#code-review-process)
- [Community Guidelines](#community-guidelines)
- [Getting Help](#getting-help)

## 🚀 Ways to Contribute

- 🐛 **Reporting bugs** — open a [Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml)
- 💡 **Suggesting features** — open a [Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml)
- 📝 **Improving documentation** — README, CONTRIBUTING, TESTING, code comments
- 🔧 **Bug fixes** — pick up an issue labeled `bug` or `good first issue`
- ✨ **New features** — discuss in an issue first to avoid wasted work
- ✅ **Tests** — increase coverage for `src/cli/` and `src/lib/`

## 🎯 Before You Start

1. **Check existing issues / PRs** to avoid duplication
2. For non-trivial features, **open an issue first** to discuss the design
3. Read our **[Testing Guide](docs/TESTING.md)** to understand how we test
4. Make sure you agree with our **[Code of Conduct](CODE_OF_CONDUCT.md)**
5. For security-sensitive issues, follow **[SECURITY.md](SECURITY.md)** instead of opening a public issue

## Project Scope: Official Slack CLI vs slamy

Before proposing a feature, check the project's responsibility boundary in
[ADR 001](docs/adr/001-official-slack-cli-boundary.md).

Use the official [`slack` CLI](https://docs.slack.dev/tools/slack-cli/) for Slack app development,
including app create/link/install/uninstall, manifests, local run, deployment, activity, logs,
documentation, and ad hoc calls to arbitrary Web API methods. The official CLI also owns explicit
`--team` selection for its own commands where supported.

A slamy feature proposal must satisfy every item in this checklist:

- [ ] The official CLI does not already provide the complete task-oriented workflow; the proposal
  is not a generic wrapper around an official command or arbitrary Web API method.
- [ ] The feature adds reusable high-level behavior for humans or agents, such as unified default,
  explicit, or permalink-derived workspace resolution, automatic pagination, Slack ID name
  resolution, stable machine-readable output, or safe message handling.
- [ ] The implementation uses documented public Slack APIs without invoking the official CLI as a
  subprocess or reading its CLI-owned credential store.
- [ ] The behavior and failure modes have a stable, testable CLI or TypeScript contract.

If any item is unchecked, use or improve the official CLI, or revise the proposal before adding it
to slamy. Record the boundary review in the feature issue or pull request.

## 💻 Development Setup

### Prerequisites

- **Node.js 25+** and **npm 10+**
- **Git**
- A Slack workspace with a Slack app + token if you want to run end-to-end API / CLI smoke tests

### Setup steps

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/slamy.git
cd slamy

# 2. Install dependencies (also runs `npm run build` via the `prepare` script)
npm install

# 3. Run tests to verify the setup
npm test

# 4. Type-check
npm run typecheck

# 5. Build (emits dist/)
npm run build

# 6. Try the CLI locally
node dist/cli/index.js --help
```

### Optional: Go binary

The Go implementation under `go-src/` is independent. To work on it:

```bash
cd go-src
go mod download
go test ./...
golangci-lint run
```

## 📐 Coding Standards

### TypeScript style

- Use **strict mode** (already configured in `tsconfig.json`)
- Prefer `const` over `let`; never use `var`
- Use descriptive names (`channelId` not `id`)
- Avoid `any` — use `unknown` and narrow when needed
- Add explicit return types on exported functions
- Module system is **NodeNext**, so relative imports must include the `.js` extension
  (e.g., `import { foo } from "./bar.js";`)

### Code organization

- Library code lives in `src/lib/`, CLI entry points in `src/cli/`
- Keep functions small and focused (single responsibility)
- Match patterns in nearby files; don't introduce one-off abstractions

### Commit message convention

Format: `<type>(<scope>): <subject>`

**Types:**

- `feat:` — new feature
- `fix:` — bug fix
- `test:` — test additions / changes
- `docs:` — documentation only
- `refactor:` — code change with no functional difference
- `perf:` — performance improvement
- `chore:` — dependencies, tooling, build config

**Examples:**

```text
feat(reactions): add reactions get command
fix(cli): default timestamp output to local TZ
docs(readme): document API client installation
chore(deps): bump @slack/web-api to 7.10.0
```

## 🧪 Testing Requirements

**All code contributions MUST include tests.** See **[docs/TESTING.md](docs/TESTING.md)** for the
full testing guide.

### Test types we use

1. **Unit tests** — pure functions (`src/lib/__tests__/`)
2. **Validation tests** — CLI argument / input validation (`src/__tests__/cli-validation.test.ts`)
3. **Output tests** — text / JSON / TSV CLI output formatting (`src/__tests__/cli-output.test.ts`)
4. **Error handling tests** — error classes, exit codes (`src/__tests__/cli-errors.test.ts`)
5. **Client tests** — Slack API client wrappers (mocked `@slack/web-api`)

### Running tests

```bash
# Run all tests once
npm test

# Watch mode (during development)
npm run test:watch

# Run a single file
npx vitest run src/lib/__tests__/split.test.ts

# Run with coverage (uses thresholds in vitest.config.ts)
npx vitest run --coverage
```

### Coverage expectations

- **New features**: aim for 100% coverage of new code
- **Bug fixes**: add a regression test that reproduces the bug before the fix
- **Project-wide threshold**: 80% lines / functions / branches / statements
  (configured in `vitest.config.ts`)

## 📝 Submitting Changes

### 1. Create a branch

```bash
git checkout -b feat/your-feature-name
# or
git checkout -b fix/short-bug-description
```

### 2. Make your changes

- Write code + tests
- Update documentation if behavior changes

### 3. Verify quality locally

```bash
npm run typecheck   # must pass
npm test            # must pass
npm run lint:md     # markdown lint (if you touched .md)
npm run build       # must succeed
```

### 4. Commit and push

```bash
# Stage specific files (avoid `git add .` to prevent committing .env / secrets)
git add src/path/to/changed-file.ts docs/...
git commit -m "feat(scope): short description"
git push origin <your-branch>
```

### 5. Open a Pull Request

- Fill out the PR template fully
- Link related issues with `Closes #123`
- Include testing evidence (command output, screenshots)

### PR checklist

- ✅ `npm test` passes locally
- ✅ `npm run typecheck` passes
- ✅ `npm run build` succeeds
- ✅ Code follows existing patterns
- ✅ Commit messages follow the convention
- ✅ Tests added for new behavior / regression
- ✅ Docs updated (README / CONTRIBUTING / TESTING) if applicable

## 👀 Code Review Process

### For contributors

- Be responsive to feedback and questions
- Ask for clarification when feedback is unclear
- Push updates to the same branch; the PR auto-updates
- Be patient — initial review may take 2–3 business days

### Review criteria

Reviewers will check:

- ✅ **Functionality** — does it work as intended?
- ✅ **Tests** — are they meaningful and passing?
- ✅ **Code quality** — readable and maintainable?
- ✅ **Documentation** — clear and up to date?
- ✅ **Performance** — any obvious regressions?
- ✅ **Security** — any token / permission / injection concerns?

## 🤝 Community Guidelines

- Be respectful and welcoming
- Follow our [Code of Conduct](CODE_OF_CONDUCT.md)
- Provide constructive feedback
- Assume good intent

## 📬 Getting Help

- 💬 **Questions** — open a [Question issue](.github/ISSUE_TEMPLATE/question.yml)
- 🐛 **Bug reports** — [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.yml)
- 💡 **Feature requests** — [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.yml)
- 🔐 **Security issues** — see [SECURITY.md](SECURITY.md) (do **not** use public issues)

## 🙌 Recognition

All contributors are recognized on the [GitHub Contributors page](https://github.com/tackeyy/slack-api-cli/graphs/contributors) and in release notes for significant contributions.

---

Thank you for contributing to slamy! 🎉
