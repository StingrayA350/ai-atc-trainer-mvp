# AI ATC Trainer

An interactive Seletar Airport departure trainer built with React, vinext, and
Vite. The Vercel deployment uses Nitro functions, Neon Postgres for durable
sessions, and OpenAI for speech transcription, interpretation, and controller
audio.

## Requirements

- Node.js 24
- pnpm 11.19.0
- A Neon Postgres database
- An OpenAI API key for voice features

## Local setup

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Local secrets belong in ignored `.env` or `.env.local` files:

```dotenv
DATABASE_URL=postgresql://...
OPENAI_API_KEY=...
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
OPENAI_INTERPRETER_MODEL=gpt-5.6-luna
OPENAI_TTS_MODEL=gpt-4o-mini-tts
```

Without `OPENAI_API_KEY`, the trainer falls back to local demo parsing. A
database connection is required for session APIs.

## Database

The schema lives in `db/schema.ts`. Generate and apply migrations with:

```bash
pnpm db:generate
pnpm db:migrate
```

## Vercel deployment

The repository is configured for the Nitro Vercel preset. The deployment build
produces Vercel Build Output API files under `.vercel/output`.

```bash
vercel link
vercel pull
vercel build
vercel deploy
vercel deploy --prod
```

Configure `DATABASE_URL` and `OPENAI_API_KEY` for Development, Preview, and
Production before deploying. Keep API keys in local ignored files and Vercel
environment variables; never commit them.

## Verification

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm test:render
```
