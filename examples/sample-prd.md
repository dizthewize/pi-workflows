# OAuth 2.0 Authentication Module

## Overview
Add Google and GitHub OAuth 2.0 authentication to the existing user system.

## Context
Current auth uses email/password only. We need OAuth for the new landing page that requires social login.

## Acceptance Criteria
- Users can sign in with Google OAuth
- Users can sign in with GitHub OAuth
- JWT token issued after successful OAuth callback
- Existing email/password auth continues to work
- OAuth profiles linked to existing accounts via email match

## Technical Notes
- Use `passport-google-oauth20` and `passport-github2`
- Store tokens encrypted at rest
- Callback URLs: `/auth/google/callback`, `/auth/github/callback`
