# XAUUSD Levels

A GitHub Action runs once a day at 17:33 Kenya time (14:33 UTC), reads the GLD options chain and writes levels.json. The page only reads that file, so the levels stay frozen until the next run. Spot price comes live from Binance in the browser.

All files live in the repo root except the workflow, which must be at .github/workflows/analyze.yml.
