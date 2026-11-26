# Lights Out: roadmap

A plan for the next stretch, from small rule changes to a career. Each step is playable on its own, and each one makes the next easier. Sizes are rough: **S** is a build or two, **M** a few, **L** a bigger project.

## Quick answers first

- **Impossible in time trial?** No. Time trial has no rivals, so the levels don't apply there, and you can always drift. Once there's an Arcade switch (step 1), time trial follows it: Arcade off means no drifting in time trial too, with its own lap records.
- **Impossible** stays as it is for now. Step 1 folds it into the new switch without changing how it drives.

## The idea: two settings instead of one

How quick the rivals are and what your car can do are really two different things, so they get two separate settings:

- **Rivals:** Easy, Normal, Hard. This is how quick the field is.
- **Arcade:** On or Off. This is what your car can do.

| | Arcade on (like today) | Arcade off |
|---|---|---|
| Drifting | yes | no |
| Perfect start | big speed boost | a small one: your reaction is the gain |
| Brakes | stop almost instantly | real braking distances: brake earlier |
| Tyres and damage | slow you down, never break | can fail: punctures, retirements (step 3) |
| Lap records | as now | kept separately |

Each combination gets its own rival speed, so Normal feels like Normal either way. **Impossible becomes Hard with Arcade off** (decided): that's what it is today, and its rival settings carry over. If that turns out too easy, a harder level comes back later. Arcade off also fixes the problem that started all this: with nobody drifting, no circuit is much easier than another.

## Step 1: the Arcade switch (M) · built (build 36, on the preview)

- A switch next to Rivals in race setup and season setup, and one in time trial.
- Arcade off: no drifting, a smaller launch boost and longer braking distances. The rivals need retuning for every level.
- Time trial keeps a separate set of records for each (we can wipe the old ones while we're building).
- A small ARCADE or no-drift badge on the HUD, so you always know which one you're in.

## Step 2: every race is a weekend (S) · built (build 37, on the preview)

Single races get qualifying, like season rounds: garage, out-lap, one flying lap, then the race from that grid. Qualifying is optional; skip it and you start from the middle, as today. Almost all the work is already done for seasons.

## Step 3: things can break, with Arcade off only (M)

Worn tyres and a damaged car become a real risk, so pitting is a decision rather than a chore.

- **Tyres below about 40%:** the chance of a puncture grows the lower they get. A warning comes first (TYRES CRITICAL · BOX). A puncture doesn't end your race: you limp back to the pits at low speed and lose a lot of time.
- **Car below about 40%:** something can fail. A warning comes first (CAR DAMAGED · BOX TO REPAIR), and a failure means STOP THE CAR: you're out (DNF, no points).
- Pitting fixes both, so there's always a way out if you react to the warning.
- The rivals run the same risks: a car ahead can drop out, and the results show DNFs.
- Numbers to tune by playing: where the risk starts, how fast it grows, how slow a puncture is.

## Step 4: cars that differ by team, and change over a season (L)

Today your car is the same whichever team you pick; the team only changes how quick the AI cars are. The plan:

- **Each team's car gets three ratings:** Engine (top speed), Aero (fast corners) and Reliability (failures, with Arcade off). Your car uses your team's ratings, so a Haas seat really is harder than a McLaren one.
- **Development through a season:** after each round every team improves a little, some faster than others. Now and then a team brings a big upgrade ("Ferrari: new floor, +aero") or one that doesn't work. A short news line and a small car chart on the season screen show it.
- **Would it be fun?** Yes, if you can see it. The pecking order shifts, so a midfield car can be fighting for podiums by the end of the season and a top team can slip. The changes need to stay moderate, so a season never feels lost because your team fell behind. In a normal season your own team develops at about the average rate. Steering your team's development is for career mode (step 6).

## Step 5: career (L)

You start as a newcomer with offers from the back of the grid (two or three teams to choose from).

- **Each race the team sets you a target:** beat your teammate, or finish in the top 12. Beating targets builds your reputation, and so does beating your teammate in the same car, which counts for a lot.
- **At the end of a season**, better teams make offers. You pick a contract and move up.
- **The full calendar** of 25 rounds per season (shorter seasons could come later as an option).
- Your car follows your team's ratings (step 4), so moving to a top team is a real upgrade you can feel.

## Step 6: running the team, inside the career (M)

Rather than a separate team-principal mode where you don't drive, I'd add the management to the career. The fun of this game is driving; watching the AI race is what the menus already show.

- **Between rounds, spend development points** (earned from results) on one area: engine, aero, reliability or pit crew. A better pit crew gives your pit stop a wider green zone and faster stops for your teammate.
- **Safe or risky:** a small sure gain, or a bigger one that might not work or might cost reliability.
- Later, maybe: choose your teammate, or bring up a junior driver.

A full team-principal mode, where you manage two drivers and watch, could come after that, but only if the management turns out to be fun on its own.

## Step 7: racing each other (L)

This is the multiplayer already on the roadmap: two of you in the same race, each on your own device. The steps above are built with that in mind: race settings like Arcade and Rivals are shared by everyone in a race, team car ratings travel with the race, and nothing pauses the race clock.

## About saving

Your current season can't change format while it's in progress. Steps 3 to 6 need more saved per season: DNFs, car ratings, development and contracts. So they start with a **new season**: the current one plays to the end on today's rules (or you abandon it), and the next season uses the new format. Career gets its own save, separate from seasons.

## Order and size

| Step | Size | Needs |
|---|---|---|
| 1. Arcade switch | M | nothing |
| 2. Qualifying for single races | S | nothing |
| 3. Things can break | M | step 1 (Arcade off only) |
| 4. Team cars and development | L | a new season format |
| 5. Career | L | step 4 |
| 6. Running the team | M | step 5 |
| 7. Racing each other | L | best after 1 and 2 |

Steps 1 and 2 are small, change how every race feels, and can go first in either order.

## Decisions (owner, 25 November 2026)

1. **Impossible folds into the switch:** it becomes Hard with Arcade off. If that turns out too easy, a harder level comes back later.
2. **Arcade off brakes:** braking takes about a third longer, tuned by feel from there.
3. **A puncture:** you limp to the pits; it doesn't end your race on the spot.
4. **Skipping qualifying in a single race:** start from the middle, as today.
5. **Career seasons:** the full calendar by default.
6. **Running the team:** inside the career, not a separate team-principal mode.
