# Web-Shooter Dispatch — Deployment Guide

## Recommended deployment shape

- Frontend: `frontend/`
- API/backend: `database/`
- PostgreSQL: managed PostgreSQL provider
- Deployment: Vercel (or another Node-compatible host)

## Before deployment

1. Install Node.js 20+.
2. Run `npm install` in the project root and in any package directory that has its own `package.json`.
3. Do not commit `.env` files or `node_modules`.
4. Create production environment variables from `.env.example`.
5. Run the database setup/seed commands documented by the project before the live demo.

## Vercel

Import the repository and use the repository root as the project root if the root `package.json` is the intended build entry.

If Vercel asks for a framework/build configuration, follow the scripts in the root `package.json`. The project should expose its API under `/api/*` through the Vercel entry configuration.

## Environment variables

Configure the database credentials in the hosting provider's Environment Variables section. Never put real credentials in Git.

## Local verification

Run the project's test commands before deployment. At minimum verify:

- matching
- atomic claim / concurrent dispatch
- timeout and reassignment
- confirmation
- resolution

Then verify the production build succeeds before publishing the live URL.
