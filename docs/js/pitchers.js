// Pitcher page: arsenal + delivery similarity graph. Data: data/pitchers.json
import { initGraphPage } from "./graph-page.js";

initGraphPage({
  kind: "pitcher",
  dataUrl: "data/pitchers.json",
  noun: "pitchers",
  subtitle: (n) => `${n.throws}HP`,
  details: (n) => {
    const rows = n.arsenal.map((p) => `
      <tr><td>${p.type}</td><td>${(p.usage * 100).toFixed(0)}%</td><td>${p.velo}</td>
      <td>${p.h_break > 0 ? "+" : ""}${p.h_break}</td><td>${p.v_break}</td><td>${p.spin ?? "–"}</td></tr>`).join("");
    return `
      <div class="stats">
        <div><b>${n.arm_angle}°</b><span>Arm angle</span></div>
        <div><b>${n.release_height}′</b><span>Release ht</span></div>
        <div><b>${n.extension}′</b><span>Extension</span></div>
      </div>
      <h3>Arsenal</h3>
      <table>
        <thead><tr><th>Pitch</th><th>Use</th><th>MPH</th><th title="Horizontal break, + = arm side (in)">HB</th><th title="Induced vertical break (in)">IVB</th><th>RPM</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  },
});
