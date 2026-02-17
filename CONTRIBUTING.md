# Contributing to Agent Oven

Thanks for your interest in contributing!

## Philosophy

**Small, focused PRs only.** Each PR should do one thing well — one bug fix, one feature, or one refactor.

## What Makes a Good PR

- **Single purpose**: Don't mix features with refactoring
- **Clear title**: Describes what changed, not how
- **Tests included**: For any new functionality or bug fixes (when test infra exists)

## What to Avoid

- PRs that mix features with refactoring
- PRs that touch unrelated files
- Large "cleanup" PRs that change many things at once

If your change is larger, break it into sequential PRs.

## Getting Started

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/Agent-Oven.git
cd Agent-Oven

# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev

# Make your changes on a branch
git checkout -b fix/short-description
```

## Before Submitting

1. Run `npm run build` to verify TypeScript compiles cleanly
2. Run `npm run typecheck` to check types without emitting
3. Keep commits atomic and well-described

## Code Style

- TypeScript with strict mode
- ES modules throughout (`.js` extensions in imports, even for `.ts` files)
- React 18 + Ink 5 for TUI components
- Use existing patterns in the codebase
- No unnecessary abstractions

## Questions?

Open an issue for discussion before starting large changes.
