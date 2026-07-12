# Integration Tests

These tests run against a real Spooled Cloud backend.

## Setup

1. Start the Spooled backend locally or use a test environment
2. Set environment variables:

```bash
export SPOOLED_API_URL=http://localhost:3000
export SPOOLED_API_KEY=sp_test_your_api_key
```

## Running Tests

```bash
npm run test:integration
```

## Notes

- Tests will create and clean up their own data
- Ensure the test API key has sufficient permissions
- The integration suite is intended for local or isolated test environments; use `npm run verify:production` for the production-safe verification flow
