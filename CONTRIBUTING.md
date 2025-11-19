# Contributing to FlowMesh

Thank you for your interest in contributing to FlowMesh! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Bugs

Before creating a bug report, please check existing issues to avoid duplicates.

When creating a bug report, include:
- Clear and descriptive title
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- FlowMesh version
- TypeScript version
- Node.js version
- Code samples (if applicable)

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies**: `npm install`
3. **Make your changes**
4. **Add tests** for your changes
5. **Run tests**: `npm test`
6. **Run test coverage**: `npm run test:cov`
7. **Build the project**: `npm run build`
8. **Commit your changes** with clear commit messages
9. **Push to your fork** and submit a pull request

## Development Setup

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- TypeScript 5 or higher

### Installation

```bash
# Clone your fork
git clone https://github.com/RobinCK/flowmesh.git
cd flowmesh

# Install dependencies
npm install

# Build the project
npm run build
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:cov

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run E2E tests only
npm run test:e2e

# Run tests in watch mode
npm run test:watch
```

### Project Structure

```
src/
├── core/               # Core workflow engine components
│   ├── workflow-engine.ts
│   ├── workflow-executor.ts
│   ├── state-executor.ts
│   ├── state-registry.ts
│   └── concurrency-manager.ts
├── decorators/         # Decorator implementations
│   ├── workflow.decorator.ts
│   ├── state.decorator.ts
│   ├── transition.decorator.ts
│   └── lifecycle.decorator.ts
├── adapters/          # Built-in adapters
│   ├── in-memory-persistence.adapter.ts
│   └── in-memory-lock.adapter.ts
├── nestjs/            # NestJS integration
│   └── flowmesh.module.ts
└── types/             # TypeScript type definitions

tests/
├── unit/              # Unit tests
├── integration/       # Integration tests
├── e2e/              # End-to-end tests
└── helpers/          # Test helpers and utilities
```

## Coding Standards

### TypeScript Style Guide

- Use TypeScript for all code
- Enable strict mode in tsconfig.json
- Use explicit types for function parameters and return values
- Use interfaces for object shapes
- Use enums for state values
- Use generics for type-safe workflows

### Naming Conventions

- **Classes**: PascalCase (e.g., `WorkflowEngine`, `StateExecutor`)
- **Interfaces**: PascalCase with `I` prefix (e.g., `IState`, `IPersistenceAdapter`)
- **Functions/Methods**: camelCase (e.g., `execute`, `registerWorkflow`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `TRANSITION_METADATA_KEY`)
- **Files**: kebab-case (e.g., `workflow-engine.ts`, `state.decorator.ts`)

### Code Organization

- One class per file
- Export from index.ts files
- Keep functions small and focused
- Use dependency injection
- Follow SOLID principles

### Documentation

- Add usage examples for complex features
- Update README.md when adding features

### Testing Requirements

All contributions must include tests:

- **Unit tests** for individual components
- **Integration tests** for component interactions
- **E2E tests** for complete workflows (if applicable)
- Maintain minimum 80% branch coverage
- Follow existing test patterns

### Test Patterns

```typescript
describe('Component', () => {
  beforeEach(() => {
    StateRegistry.clear(); // Always clear registry
  });

  it('should do something', () => {
    // Arrange
    const component = new Component();

    // Act
    const result = component.method();

    // Assert
    expect(result).toBe(expected);
  });
});
```

## Pull Request Process

1. Update README.md with details of changes (if applicable)
3. Ensure all tests pass and coverage meets requirements
4. Request review from maintainers
5. Address review feedback
6. Maintainers will merge once approved

### Breaking Changes

Breaking changes require:
- Clear justification
- Migration guide
- Major version bump
- Discussion with maintainers

## License

By contributing to FlowMesh, you agree that your contributions will be licensed under the MIT License.

