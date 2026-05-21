# OAuth 2.0 Authentication Module

## TASK-01: Create OAuth types and interfaces
Priority: P1
Files: src/auth/oauth-types.ts (create)
Depends on: none
Acceptance: Exports OAuthProvider, OAuthProfile, OAuthToken interfaces

## TASK-02: Implement Google OAuth strategy
Priority: P1
Files: src/auth/strategies/google.ts (create), src/auth/oauth-types.ts (modify)
Depends on: TASK-01
Acceptance: googleStrategy configured with clientId/clientSecret; verify callback returns profile

## TASK-03: Implement GitHub OAuth strategy
Priority: P1
Files: src/auth/strategies/github.ts (create), src/auth/oauth-types.ts (modify)
Depends on: TASK-01
Acceptance: githubStrategy configured; verify callback returns profile with email

## TASK-04: Create OAuth callback handler
Priority: P1
Files: src/routes/auth/callback.ts (create), src/auth/strategies/google.ts (modify), src/auth/strategies/github.ts (modify)
Depends on: TASK-02, TASK-03
Acceptance: POST /auth/google/callback and /auth/github/callback return 200 with JWT

## TASK-05: Link OAuth profiles to existing accounts
Priority: P2
Files: src/services/user-linker.ts (create), src/routes/auth/callback.ts (modify)
Depends on: TASK-04
Acceptance: If OAuth email matches existing user, link profiles; otherwise create new user

## TASK-06: Add integration tests
Priority: P2
Files: test/oauth.integration.test.ts (create)
Depends on: TASK-05
Acceptance: Mock OAuth flow passes; token valid after login
