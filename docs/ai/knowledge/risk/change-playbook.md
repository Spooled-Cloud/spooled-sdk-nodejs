# Playbook

1. Change API → update types + unit/integration tests.
2. Version bump → sync all version surfaces (`RELEASE_VERSION_SYNC.md`).
3. gRPC/proto → coordinate with backend + sibling SDKs.
4. `npm test` + lint/typecheck before release. CI (`.github/workflows/ci.yml`, Node 22 and 24) runs lint, typecheck, typecheck:examples, build and test on push to `main` and on pull requests; `publish.yml` (Node 22) repeats lint, typecheck, build and test on a `vX.Y.Z` tag.
