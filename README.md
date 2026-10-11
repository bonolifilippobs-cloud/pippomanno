# Pippo Tracker: talk to Claude, get a dashboard

A personal nutrition and fitness tracker where **you don't fill in forms, you just talk.**
Say *"for lunch I had a plate of carbonara and a Coke Zero, then I ran 5 km"* from your iPhone,
and Claude estimates the calories and macros, logs everything to a database, and the dashboard
updates.

- 🎙 **Voice first.** Use the mic button in the web app, or say *"Hey Siri, log food"* from anywhere with the iOS Shortcut below.
- 🤖 **Claude does the tracking.** It splits meals into items, estimates portions, calories, protein, carbs, fat, fiber, sugar and sodium, and logs workouts, water and weight. It also handles corrections ("actually it was two eggs", "remove the beer") and goals ("set my protein goal to 150 g").
- 📷 **Meal photos.** Snap a picture of your plate and Claude logs it.
- 📊 **Dashboard.** Calories left (goal + exercise − eaten), macro bars, water, exercise, a per-meal log, a 14-day calorie chart and a 60-day weight trend. Light and dark mode. You can add it to your Home Screen like an app.
- 🗄 **Your data, one file.** Everything is stored in a single SQLite database (`data/tracker.db`).

## How it works

```
iPhone (web app mic / Siri Shortcut)
        │  "two eggs and a cappuccino"
        ▼
Node server ──► Claude API (tool use) ──► log_food / log_exercise / log_water /
   │                                       log_weight / get_day / update_entry /
   │                                       delete_entry / set_goals / get_history
   ▼
SQLite (entries, goals, conversation) ──► Dashboard
```

| File | What it does |
|---|---|
| `src/server.js` | Express API + static hosting, token auth, time-zone handling |
| `src/agent.js` | The Claude agent: system prompt, tool definitions, tool loop |
| `src/db.js` | SQLite schema and queries (uses Node's built-in `node:sqlite`) |
| `public/` | The mobile web app / dashboard (no build step) |

## Run it locally

Requires **Node 22.13+**.

```bash
cp .env.example .env      # then fill in ANTHROPIC_API_KEY and APP_TOKEN
npm install
npm start                 # http://localhost:3000
```

Open the app, tap ⚙︎, paste your `APP_TOKEN`, and start talking.

## Put it online (so your iPhone can reach it)

Any host that runs Node or Docker **with a persistent disk** works. The SQLite file has to survive restarts.

**Railway / Render / Fly.io (Docker):**
1. Create a new service from this GitHub repo. The `Dockerfile` is picked up automatically.
2. Attach a volume mounted at **`/data`**.
3. Set environment variables: `ANTHROPIC_API_KEY`, `APP_TOKEN` (a long random string), and optionally `TZ_DEFAULT` (e.g. `Europe/Rome`).
4. Deploy and open the public HTTPS URL on your iPhone.

**Install on the iPhone:** open the URL in Safari → Share → **Add to Home Screen**.

> The 🎙 button uses Safari's speech recognition. If it's not available (e.g. in some
> Home Screen app modes), tap the text box and use the 🎤 key on the iOS keyboard. It works just as well.

## “Hey Siri, log food”: iOS Shortcut

This is the fastest way to log: no app to open.

1. Open the **Shortcuts** app → **+** → name it **Log food** (this is the Siri phrase).
2. Add **Dictate Text** (set *Stop Listening* to *After Pause*, and pick your language).
3. Add **Get Contents of URL**:
   - URL: `https://YOUR-APP-URL/api/chat?format=text`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer YOUR_APP_TOKEN`
   - Request Body: **JSON** → add a field `text` = *Dictated Text*, and a field `tz` = `Europe/Rome` (your time zone)
4. Add **Speak Text** (or **Show Result**) with *Contents of URL*.

Now say *"Hey Siri, log food"* and then *"a banana and a protein shake with milk"*. Siri reads
back Claude's confirmation, and the dashboard is updated the next time you open it.

You can duplicate the shortcut as "Log workout", "Log weight" or "How am I doing today". The
endpoint is the same, since Claude works out what you meant.

## API

All endpoints need `Authorization: Bearer <APP_TOKEN>` (or `?token=`).

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chat` | `{ text, tz?, image?: { media_type, data } }` → `{ reply, changed, date }`. Add `?format=text` for a plain-text reply. A `text/plain` body is accepted too. |
| `GET` | `/api/day?date=YYYY-MM-DD` | Entries, totals, goals and conversation for a day |
| `GET` | `/api/history?days=14&date=YYYY-MM-DD` | Per-day totals for the N days ending at `date` |
| `DELETE` | `/api/entries/:id` | Delete an entry |
| `GET` / `PUT` | `/api/goals` | Read / update daily goals |

## Notes

- **Model:** `claude-opus-5-5` at low effort, which keeps logging fast. Override it with `CLAUDE_MODEL`.
  Requests opt into server-side refusal fallbacks (`fallbacks: "default"`).
- **Accuracy:** calories and macros are Claude's estimates from typical nutrition data. They are good
  for trends, not lab-precise. Saying brands and amounts ("200 g Fage 0% yogurt") makes them better.
- **Security:** always set `APP_TOKEN` on a public server. Without it, anyone with the URL can read
  and write your log.
