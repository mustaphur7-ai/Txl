# BTCUSD Levels

Bitcoin option levels from Deribit, refreshed daily, with live Binance price. This version has the dashboard only (no chart, alarms or signals yet).

## Setup on a phone (use the browser, "Desktop site" helps)
1. On github.com create a **public** repository.
2. Tap **Add file > Upload files** and add to the root: index.html, style.css, app.js, levels.json, make_levels.py, requirements.txt, README.md.
3. Tap **Add file > Create new file**, type `.github/workflows/analyze.yml` as the name, paste the contents of analyze.yml, and commit.
4. **Settings > Actions > General > Workflow permissions**: choose "Read and write", then save.
5. **Settings > Pages**: deploy from branch `main`, folder `/ (root)`.
6. **Actions > Daily levels analysis > Run workflow**.
7. Open `https://USERNAME.github.io/REPO/`.

The schedule is 14:33 UTC (17:33 Kenya time). GitHub cron can run several minutes late; the page shows the real analysis time. If a run fails, the old levels.json is kept.

## Test checklist
- [ ] levels.json loads and the sample banner shows
- [ ] The workflow run replaces the sample data (reload after a few minutes)
- [ ] Price updates every 5 seconds and the dot is green
- [ ] Countdown ticks
- [ ] Ladder is sorted with "Price now" in the right place
