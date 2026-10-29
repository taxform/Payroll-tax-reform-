# PayrollTaxReform.com

Independent payroll tax and tax reform information site, hosted on Netlify at https://payrolltaxreform.com.

## Layout

- `public/` — the static site (HTML pages, `app.js`, `style.css`). This is the only folder published.
- `public/__forms.html` — hidden copies of the JavaScript-rendered forms so Netlify Forms registers them at deploy time.
- `netlify/functions/refresh-irs-updates.mts` — scheduled function (11:00 UTC daily) that reads the official
  IRS "News releases for current month" page and stores new releases.
- `netlify/functions/official-updates.mts` — `GET /api/official-updates`, used by the Latest Updates page.
  It also refreshes the data itself if the last check is more than 26 hours old.
- `db/schema.ts` — Netlify Database (Postgres) schema; migrations live in `netlify/database/migrations/`
  and are applied automatically on deploy.

## Forms

- `tax-alerts` — email list signup shown in the sidebar on most pages.
- `advertiser-inquiry` — advertising inquiry form on the Advertise page.

Submissions appear in the Netlify dashboard under **Forms**. Add email or Slack notifications there under
**Forms → Form notifications**.

## Changing the database schema

Edit `db/schema.ts`, then run `npx drizzle-kit generate --name <what_changed>` and commit the generated migration.

## Notes

Headlines link to IRS.gov and are not interpreted tax advice. The IRS page layout can change; if the scheduled
check starts failing, the function logs show the error and the site keeps showing the releases it already has.

## Disabled build plugins

Five build plugins were installed on this site in the Netlify dashboard without being configured
(Algolia Crawler, Cloudinary, Cypress, Accessibility/a11y, and strapi-plugin-netlify-deployments), which made builds fail.
`build-plugins/` holds do-nothing stand-ins with the same package names, listed in `package.json`, so builds skip them.
Lighthouse still runs. Once those plugins are uninstalled in the dashboard, delete `build-plugins/` and the matching
`devDependencies` entries.
