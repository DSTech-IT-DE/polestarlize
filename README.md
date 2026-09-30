# polestarlize

Upload the Journey Log exports of your Polestar and see where you have been, how efficiently you drive, how you
charge and how your battery is doing.

**Use it:** <https://dstech-it-de.github.io/polestarlize/> — or [run it yourself](#self-hosting-with-docker).

> Deutsch: polestarlize wertet die Exporte der Journey-Log-App deines Polestar aus – Fahrprofil, Orte,
> Batteriegesundheit, Ladeverhalten und Kosten. Die Oberfläche gibt es auf Deutsch und Englisch.

## What it does

| Page | What you get |
| --- | --- |
| Overview | Distance, energy, consumption, driving time, month by month |
| Trips | Searchable, sortable log of every trip, per-category totals (private/business), CSV export |
| Map & places | Map of your trips and endpoints, frequent places and routes, home/work detection, towns and countries |
| Battery | Estimated usable capacity and state of health over time, how the battery is used (SOC windows, cycles) |
| Charging | Charging sessions derived from SOC changes between trips, charging places, standby drain |
| Driving profile | When you drive (weekday × hour, calendar), trip lengths, efficiency by distance, speed and season, records |
| Costs | Energy cost with your own prices, comparison with a petrol car, CO₂ |

The Journey Log export contains start/end time, addresses and coordinates, distance, energy used, odometer and the
state of charge (SOC) at start and end of every trip. Everything shown is derived from those columns; estimates are
labelled as such and the method is explained next to them.

### Incremental imports

The app mails you the same data as `.csv` and `.xlsx`; either works. Import a new export whenever you like: trips
are identified by start time and odometer, so overlapping exports never create duplicates. Trips you edited in the
app (category, comment) are updated, and trips you merged in the app replace the single trips they cover.

### Your data and your ID

There are no accounts. On your first visit you get a random ID (UUID), stored in a first-party cookie.

- **GitHub Pages version:** all data stays in your browser (IndexedDB). Move it to another device with the backup
  file (Settings → Download backup).
- **Self-hosted with Docker:** the built-in sync server stores your trips under a hash of your ID. Enter the ID on
  another device to get your data there. Treat the ID like a password.

No analytics, no ads, no third-party requests — except map tiles from [OpenFreeMap](https://openfreemap.org),
which are only loaded after you allow it on the map page.

## Self-hosting with Docker

```sh
docker run -d --name polestarlize -p 8080:8080 -v polestarlize-data:/data ghcr.io/dstech-it-de/polestarlize:latest
```

or with Compose:

```sh
docker compose up -d
```

Then open <http://localhost:8080>. Put a reverse proxy with TLS in front of it if it is reachable from the internet.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` | Where the SQLite database lives |
| `SYNC_ENABLED` | `true` | Set to `false` to serve only the static app (browser storage, like GitHub Pages) |
| `CORS_ORIGINS` | – | Comma-separated origins allowed to use this sync server, e.g. `https://dstech-it-de.github.io` |
| `TRUST_PROXY` | – | Set to `1` behind a reverse proxy so rate limiting uses `X-Forwarded-For` |

With `CORS_ORIGINS` set, the GitHub Pages version can use your server: Settings → Your ID → sync server URL.

## Development

Requirements: Node.js 24 LTS (22.13+ works).

```sh
npm install
npm run dev          # web app on http://localhost:5173
npm run dev:server   # sync server on http://localhost:8080 (the web dev server proxies /api to it)
npm test             # unit tests (web + server)
npm run typecheck
npm run build
```

Layout:

```
web/     React + TypeScript single-page app (Vite)
  src/import/      Journey Log parser (CSV and XLSX) and the incremental merge
  src/analytics/   Pure functions behind every page, with tests
  src/pages/       One folder per page
  src/locales/     UI texts, one folder per language
server/  Optional sync server (Hono, node:sqlite) that also serves the built app
```

### Adding a language

Copy `web/src/locales/en` to `web/src/locales/<code>`, translate the JSON files and add the language to
`LANGUAGES` in `web/src/i18n/index.ts`. Code and comments stay in English.

### Releases

The version shown in the UI comes from the root `package.json`. Pushing a tag `v<version>` builds and publishes
the Docker image `ghcr.io/dstech-it-de/polestarlize:<version>`; `main` is published as `edge` and deployed to
GitHub Pages.

## License

[GPL-3.0-or-later](LICENSE). Not affiliated with or endorsed by Polestar. "Polestar" is a trademark of its owner.
