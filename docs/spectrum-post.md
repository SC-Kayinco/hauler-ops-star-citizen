# HAULER OPS — a free cargo hauling planner (reads your contracts, packs your ship in 3D, plans your route)

Hey haulers o7

Some of my best ideas show up mid-run. A while back — Guinness in hand, hold full, cruising to a drop-off — it hit me that I'd love a proper tool to plan these hauls: read the contracts, pack the ship, sort out the route. So my good friend Claude and I sat down and built one. 😄 It's **free, open-source, and 100% offline** (more on privacy below), and I'd genuinely love your feedback.

**Download (Windows):** https://github.com/SC-Kayinco/hauler-ops-star-citizen/releases/latest
**Source code:** https://github.com/SC-Kayinco/hauler-ops-star-citizen

---

## What it does

- **📸 Reads your missions from screenshots.** It watches your Star Citizen screenshot folder and OCRs the contract text — cargo type, SCU, pickup and dropoff — so you don't retype anything. Just screenshot the mission board.
- **📦 Packs your ship in real 3D.** Every ship has bay-accurate geometry. It lays out your boxes in a 3D view (and a top-down 2D view) so you can see exactly what fits where, per bay, and check off cargo as you load it.
- **🗺️ Plans your route.** Multi-pickup, multi-dropoff optimizer that orders your stops and splits contracts across bays sensibly.
- **💰 Tracks your earnings.** Logs completed runs and shows your aUEC/hour so you know which routes actually pay.
- **🌌 3D Star Map.** See your mission pickups/dropoffs across the 'verse with clickable mission tracking.
- **📈 Live market prices** from UEX Corp, right in the planner.
- **🚢 Fleet reference** for 20+ haulers (with a "verify in-game" disclaimer since values drift patch to patch), plus you can add your own custom ships and bay layouts.
- **💾 Mission templates** — save a recurring run and re-fill it in one click.
- Pilot profile, backup/restore, and it **auto-updates** (installer build) so you always have the latest.

---

## Screenshots

*(attach: 01-fleet, 04-1-loadplan, 03-1-missions, 04-3-loadplan, 06-starmap, 05-earnings)*

---

## Is it safe? (privacy + transparency)

This was my #1 concern building it, so I'll be straight with you:

- **It never sends your data anywhere.** No accounts, no telemetry, no analytics. Your missions, cargo, and profile stay on your PC.
- The **only** outbound network calls are: fetching public commodity prices from UEX Corp, checking GitHub for app updates, and (rarely) downloading the OCR engine. None of these send anything about you or your game.
- OCR runs **fully locally** — no screenshots are uploaded.
- It's **open-source**, so you can read every line yourself.

**Heads up on the Windows warning:** the app isn't code-signed (signing certs are expensive and hard to get from Turkey), so Windows SmartScreen will show *"Windows protected your PC."* Click **More info → Run anyway**. If you'd rather not, you can build it from source. Full explanation is in the README.

---

## Feedback welcome

This is very much a work in progress and I'm a solo dev, so bug reports, ship-data corrections, and feature ideas are all hugely appreciated — drop them here or open an issue on GitHub.

---

*HAULER OPS is an unofficial fan-made tool and is not affiliated with or endorsed by Cloud Imperium Games. All game content and materials are property of CIG. Market data courtesy of [UEX Corp](https://uexcorp.space). Free forever.*
