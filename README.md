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

## Pages

| Page | URL | Description |
|------|-----|-------------|
| Home | `/` | Navigation hub |
| Standings | `/standings.html` | League standings grouped by conference and division |
| EA Matches | `/ea.html` | Look up EA match results for a club |
| Admin | `/admin.html` | Add/delete teams, players, and games; assign EA matches to league games |

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/teams` | List all teams |
| POST | `/api/teams` | Create a team (`name`, `conference`, `division`) |
| DELETE | `/api/teams/:id` | Delete a team (cascades to players and games) |
| GET | `/api/players` | List all players |
| POST | `/api/players` | Create a player (`name`, optionally `team_id`, `position`, `number`) |
| DELETE | `/api/players/:id` | Delete a player |
| GET | `/api/games` | List all games |
| POST | `/api/games` | Record a game (`home_team_id`, `away_team_id`, `home_score`, `away_score`, `date`) |
| DELETE | `/api/games/:id` | Delete a game |
| GET | `/api/standings` | Standings calculated from recorded games |
| GET | `/api/ea-matches` | List mocked EA match data (filter by `?club=` query param) |
| POST | `/api/ea-matches/assign` | Assign an EA match to a league game (`ea_match_id`, `game_id`) |