# ⚡ EHL Site — Electric Hockey League

A full-stack hockey league management website built with Node.js/Express and SQLite.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```

Then open your browser to **http://localhost:3000**.

The server creates a local `league.db` SQLite file on first run. No other setup is needed.

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