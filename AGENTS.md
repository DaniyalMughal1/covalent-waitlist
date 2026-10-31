# Covalent waitlist

## Commands
- Install: `npm ci` (Node 24.x)
- Check: `npm run check`
- Tests: `npm test`
- Local build: `npm run build`
- Hosting build: `VERCEL=1 npm run build`

## Deploy Configuration (configured by /setup-deploy)
- Platform: Vercel
- Project: `daniyalmughal1s-projects/covalent-waitlist`
- Production URL: https://covalent-waitlist.vercel.app/
- Deploy workflow: automatic GitHub deployment on push to `main`
- Deploy status command: `vercel inspect https://covalent-waitlist.vercel.app`
- Project type: Astro web app with one server function at `/api/waitlist`
- Post-deploy health check: GET `/` returns 200 and the Covalent landing page; GET `/api/waitlist` returns 405 with `Allow: POST`.

### Custom deploy hooks
- Before push: `npm run check`, `npm test`, `VERCEL=1 npm run build`.
- Vercel selects its adapter via `VERCEL=1`; local builds retain the standalone Node adapter.
- Do not set the output directory to `dist`; use the adapter's `.vercel/output` manifest.
- The signup provider is unconfigured. Keep test-provider switches off in production; a valid submission must not claim success until a real provider accepts it.
- Keep environment files and `.vercel/` out of Git. The tracked `.env.example` is a blank template.
- Preserve the current hero/footer layout. Middle demo and FAQ code remain parked.
