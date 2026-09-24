// Batter page: batted-ball / spray / discipline similarity graph. Data: data/batters.json
import { initGraphPage } from "./graph-page.js";

const pct = (v) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);
const num = (v, d = 1) => (v == null ? "–" : v.toFixed(d));

initGraphPage({
  kind: "batter",
  dataUrl: "data/batters.json",
  noun: "batters",
  subtitle: (n) => `${{ L: "Bats left", R: "Bats right", S: "Switch" }[n.stands]} · ${n.pa} PA`,
  details: (n) => {
    const s = n.stats;
    const stat = (v, label) => `<div><b>${v}</b><span>${label}</span></div>`;
    return `
      <div class="stats">
        ${stat(num(s.ev_mean), "Avg EV")}${stat(num(s.ev_90), "EV90")}${stat(pct(s.barrel), "Barrel")}
        ${stat(pct(s.hard_hit), "Hard-hit")}${stat(`${num(s.la_mean)}°`, "Launch angle")}${stat(pct(s.pull_air), "Pulled air")}
        ${stat(pct(s.chase), "Chase")}${stat(pct(s.whiff), "Whiff")}${stat(num(s.bat_speed), "Bat speed")}
      </div>
      <h3>Spray</h3>
      <table>
        <thead><tr><th>Direction</th><th>Share</th><th>Avg EV</th></tr></thead>
        <tbody>
          <tr><td>Pull</td><td>${pct(s.pull)}</td><td>${num(s.ev_pull)}</td></tr>
          <tr><td>Center</td><td>${pct(s.center)}</td><td>${num(s.ev_center)}</td></tr>
          <tr><td>Oppo</td><td>${pct(s.oppo)}</td><td>${num(s.ev_oppo)}</td></tr>
        </tbody>
      </table>
      <h3>Batted-ball types</h3>
      <table>
        <thead><tr><th>GB</th><th>LD</th><th>FB</th><th>PU</th></tr></thead>
        <tbody><tr><td>${pct(s.gb)}</td><td>${pct(s.ld)}</td><td>${pct(s.fb)}</td><td>${pct(s.pu)}</td></tr></tbody>
      </table>`;
  },
});
