# Omega YSWS

Omega is an official [Hack Club](https://hackclub.com/) You Ship, We Ship program for young mobile developers. Build an Android, iOS, or cross-platform app and earn Ω tokens for rewards such as phones, developer licenses, and tools.

## How it works

1. Pitch your app idea and get it approved.
2. Build for at least **20 hours**[can be changed when official launch], tracked with [Hackatime](https://hackatime.hackclub.com/).
3. Submit a public repository, README, demo, and AI-use disclosure.
4. Pass review and earn Ω tokens based on approved hours and project quality.
5. Spend your tokens in the Omega shop.

You can build for Android, iOS, or both. Participants may submit up to two projects, and the same work cannot be submitted to another YSWS.

## Website features

- Hack Club sign-in and Hackatime integration
- Pitch and project submissions with review feedback
- Repository, README, demo, and media checks
- Project badges and status tracking
- Ω token rewards and shop
- Mobile development guides

## Tech stack

- Svelte 5, TypeScript, and Vite
- Fastify API server
- Airtable database
- Hack Club OIDC and Hackatime OAuth
- GitHub API and Slack integrations

## Local development

```shell README.md
npm install
npm run server:watch
npm run dev
```

Copy `.env.example` to `.env` and configure the required credentials first. The website runs at `http://localhost:5173`, with the API on port `3000`.

Run checks with `npm run check` and create a production build with `npm run build`.

## Community

Join the [Hack Club Slack](https://hackclub.com/slack) and visit `#omega` for help and project updates.



