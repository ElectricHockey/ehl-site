# ⚡ EHL Site — Electric Hockey League

A full-stack hockey league management website built with Node.js/Express and PostgreSQL (Supabase), deployed on Vercel.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- A [Supabase](https://supabase.com/) project (free tier works)
- A [Vercel](https://vercel.com/) account (free tier works)

## Connecting Supabase (database)

1. Go to [supabase.com](https://supabase.com/) and create a new project (or open your existing one).
2. Once the project is ready, go to **Project Settings → Database**.
3. Under **Connection string → URI**, copy the connection string. It looks like:
   ```
   postgresql://postgres.[ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
   Replace `[YOUR-PASSWORD]` with the database password you set when creating the project.
4. Go to **Project Settings → API** and copy the **Project URL** and **service_role key** (secret).

You now have the three values needed:

| Value | Env var | Where to find it |
|-------|---------|-----------------|
| Connection string (URI) | `DATABASE_URL` | Project Settings → Database → Connection string → URI |
| Project URL | `SUPABASE_URL` | Project Settings → API → Project URL |
| Service-role key | `SUPABASE_SERVICE_KEY` | Project Settings → API → service_role (secret) |

## Deploying to Vercel

1. Go to [vercel.com](https://vercel.com/) and import this GitHub repository.
2. In the Vercel project settings, go to **Settings → Environment Variables** and add:

   | Name | Value |
   |------|-------|
   | `DATABASE_URL` | Your Supabase connection string from above |
   | `SUPABASE_URL` | Your Supabase project URL (e.g. `https://abc123.supabase.co`) |
   | `SUPABASE_SERVICE_KEY` | Your Supabase service_role key |
   | `OWNER_DISCORD_ID` | Your Discord user ID (for admin access) |
   | `IP_HMAC_SECRET` | Any random string (used to hash IPs) |

3. Redeploy. The app will automatically create all tables on first request and seed your teams.

> **Tip — Supabase Integration:** Vercel has a built-in Supabase integration that auto-fills `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_KEY`. In your Vercel project go to **Settings → Integrations → Browse Marketplace → Supabase** and connect your project. This is the easiest way.

## Local development

```bash
# 1. Copy the example env and fill in your Supabase values
cp .env.example .env
# edit .env with your DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

Then open **http://localhost:3000**. Tables are created automatically on startup.

## Adding your teams to the code (seed data)

Instead of re-entering your teams through the Admin panel every time you reset the database, you can define them once in **`db.js`**.

Open `db.js` and find the `SEED_TEAMS` array near the bottom:

```js
const SEED_TEAMS = [
  // Add your teams here:
  { name: 'Chicago Wolves',   conference: 'West', division: 'Central',  league_type: 'sixes', color1: '#cc0000', color2: '#000000' },
  { name: 'New York Rangers', conference: 'East', division: 'Atlantic', league_type: 'sixes', color1: '#0038a8', color2: '#ce1126' },
  // ...more teams
];
```

| Field | Required | Values / Notes |
|-------|----------|---------------|
| `name` | ✅ | Team display name |
| `conference` | — | e.g. `'East'`, `'West'` — leave `''` if unused |
| `division` | — | e.g. `'Atlantic'`, `'Pacific'` — leave `''` if unused |
| `league_type` | — | `'sixes'` (6v6), `'threes'` (3v3), or `''` |
| `color1` | — | Primary colour as a CSS hex string, e.g. `'#cc0000'` |
| `color2` | — | Secondary colour, e.g. `'#ffffff'` |

Teams are upserted on every startup using `INSERT … ON CONFLICT`, so adding entries here won't create duplicates.

> **Logos and EA Club IDs** — These can't be set in the seed (logos are file uploads, EA IDs are looked up per club). Set them in the **Admin panel** after the server starts.

## Importing historical stats from mystatsonline.com

Use the included scraper to pull past seasons (schedule, scores, and player stats) out of mystatsonline.com and import them via the Admin → Import tab.

### Basic usage

```bash
node scripts/scrape-mystatsonline.js <IDLeague>
# e.g.
node scripts/scrape-mystatsonline.js 73879
```

This writes `import-data.json` in the current directory.  Specify a different output file as a second argument:

```bash
node scripts/scrape-mystatsonline.js 73879 my-data.json
```

### If the scraper says "No seasons found"

The scraper tries several strategies to auto-detect the available seasons from the league home page.  If every strategy fails you can bypass auto-detection by supplying the season ID directly with `--season` (or `-s`):

```bash
node scripts/scrape-mystatsonline.js 73879 --season <IDSeason>
# e.g.
node scripts/scrape-mystatsonline.js 73879 --season 12345
```

To find the `IDSeason` value: open the league home page in your browser (`https://www.mystatsonline.com/hockey/visitor/league/home/home_hockey.aspx?IDLeague=73879`), navigate to a season, and copy the number after `IDSeason=` in the URL.

You can scrape one season at a time and re-run with different `--season` values to build up the full `import-data.json`.

### After scraping

1. Open the generated JSON and set `"league_type"` on each season to `"threes"` or `"sixes"`.
2. Log in to **Admin → Import** and upload the file.

---

## Setting up live EA match history

Each EHL team can be linked to an EA Sports NHL Pro Clubs club by assigning its **EA Club ID**:

1. Find the club's ID in the EA Pro Clubs URL. For example, club `1055` is visible in:  
   `https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=common-gen5&clubIds=1055`
2. In the **Admin Panel** (`/admin.html`), click **Edit** next to the team's EA Club ID column and enter the number.
3. Once two or more league teams have EA Club IDs set, click any team name on the **Standings** page to see recent matches between them — including per-player stats (goals, assists, shots, hits, +/−, TOI, etc.).
4. Open the **Schedule** page (`/schedule.html`) to see all league games. Click **Pick EA Match** on any game to load that home team's recent EA matches. Select the matching one to link it to the game and auto-fill the score.

## Pages

| Page | URL | Description |
|------|-----|-------------|
| Home | `/` | Navigation hub |
| Schedule | `/schedule.html` | All league games; click **Pick EA Match** to fetch EA matches for that game and assign one |
| Standings | `/standings.html` | League standings; click a team name to view its EA match history |
| Team detail | `/team.html?id=X` | Recent EA NHL Pro Clubs matches for a team, filtered to league opponents |
| EA Matches | `/ea.html` | Look up EA match results for a club by name |
| Admin | `/admin.html` | Add/delete teams (with optional EA Club ID), players, and games |

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/teams` | List all teams (includes `ea_club_id`) |
| POST | `/api/teams` | Create a team (`name`, `conference`, `division`, optionally `ea_club_id`) |
| PATCH | `/api/teams/:id` | Update a team's EA club ID (`ea_club_id`) |
| DELETE | `/api/teams/:id` | Delete a team (cascades to players and games) |
| GET | `/api/teams/:id/ea-matches` | Fetch live matches from EA NHL Pro Clubs API, filtered to league opponents |
| GET | `/api/players` | List all players |
| POST | `/api/players` | Create a player (`name`, optionally `team_id`, `position`, `number`) |
| DELETE | `/api/players/:id` | Delete a player |
| GET | `/api/games` | List all games (includes `ea_match_id`) |
| POST | `/api/games` | Record a game (`home_team_id`, `away_team_id`, `home_score`, `away_score`, `date`) |
| PATCH | `/api/games/:id` | Update scores (`home_score`, `away_score`, validated 0–99) and/or `ea_match_id` |
| DELETE | `/api/games/:id` | Delete a game |
| GET | `/api/games/:id/ea-matches` | Fetch recent EA matches for the home team; annotates whether each opponent is the scheduled away team |
| GET | `/api/standings` | Standings calculated from recorded games |
| GET | `/api/ea-matches` | List mocked EA match data (filter by `?club=` query param) |
| POST | `/api/ea-matches/assign` | Assign an EA match to a league game (`ea_match_id`, `game_id`) |