/**
 * Accessibility Trend Tracker
 * Tracks violations over time and generates trend dashboard
 * 
 * Usage: npx ts-node scripts/trend-tracker.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ─── Types ────────────────────────────────────────────────────────────────────
interface TrendEntry {
  timestamp: string;
  url: string;
  totalViolations: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  passes: number;
  complianceScore: number;
  violations: string[]; // violation IDs
  newViolations: string[];
  fixedViolations: string[];
}

interface TrendData {
  url: string;
  entries: TrendEntry[];
  lastUpdated: string;
}

// ─── Paths ────────────────────────────────────────────────────────────────────
const REPORTS_DIR   = path.join(process.cwd(), 'reports');
const VIOLATIONS_FILE = path.join(REPORTS_DIR, 'violations.json');
const TREND_FILE    = path.join(REPORTS_DIR, 'trend-data.json');
const TREND_HTML    = path.join(REPORTS_DIR, 'trend-dashboard.html');

// ─── Calculate Compliance Score ───────────────────────────────────────────────
function calculateScore(entry: Partial<TrendEntry>): number {
  // Score = 100 - weighted violations
  const penalty =
    (entry.critical ?? 0) * 25 +
    (entry.serious  ?? 0) * 10 +
    (entry.moderate ?? 0) * 5  +
    (entry.minor    ?? 0) * 2;
  return Math.max(0, 100 - penalty);
}

// ─── Load Current Scan ────────────────────────────────────────────────────────
function loadCurrentScan(): any {
  if (!fs.existsSync(VIOLATIONS_FILE)) {
    console.error('❌ No violations.json found. Run a scan first.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(VIOLATIONS_FILE, 'utf-8'));
  return data[data.length - 1]; // Latest scan
}

// ─── Load Trend History ───────────────────────────────────────────────────────
function loadTrendData(url: string): TrendData {
  if (fs.existsSync(TREND_FILE)) {
    const all = JSON.parse(fs.readFileSync(TREND_FILE, 'utf-8'));
    if (all[url]) return all[url];
  }
  return { url, entries: [], lastUpdated: new Date().toISOString() };
}

// ─── Save Trend Data ──────────────────────────────────────────────────────────
function saveTrendData(url: string, trendData: TrendData) {
  let all: Record<string, TrendData> = {};
  if (fs.existsSync(TREND_FILE)) {
    all = JSON.parse(fs.readFileSync(TREND_FILE, 'utf-8'));
  }
  all[url] = trendData;
  fs.writeFileSync(TREND_FILE, JSON.stringify(all, null, 2));
}

// ─── Detect New and Fixed Violations ─────────────────────────────────────────
function detectChanges(
  currentIds: string[],
  previousIds: string[]
): { newViolations: string[]; fixedViolations: string[] } {
  const newViolations   = currentIds.filter(id => !previousIds.includes(id));
  const fixedViolations = previousIds.filter(id => !currentIds.includes(id));
  return { newViolations, fixedViolations };
}

// ─── Generate HTML Trend Dashboard ───────────────────────────────────────────
function generateTrendHTML(trendData: TrendData): string {
  const entries  = trendData.entries;
  const latest   = entries[entries.length - 1];
  const previous = entries[entries.length - 2];

  // Chart data
  const labels    = entries.map(e =>
    new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  );
  const totalData    = entries.map(e => e.totalViolations);
  const criticalData = entries.map(e => e.critical);
  const seriousData  = entries.map(e => e.serious);
  const scoreData    = entries.map(e => e.complianceScore);

  // Trend arrow
  const trend = previous
    ? latest.totalViolations < previous.totalViolations ? '📉 Improving'
    : latest.totalViolations > previous.totalViolations ? '📈 Regressing'
    : '➡️ No Change'
    : '🆕 First Scan';

  const trendColor = trend.includes('Improving') ? '#22c55e'
                   : trend.includes('Regressing') ? '#ef4444'
                   : '#64748b';

  // Violation history rows
  const historyRows = [...entries].reverse().map((e, i) => {
    const prev = [...entries].reverse()[i + 1];
    const delta = prev
      ? e.totalViolations - prev.totalViolations
      : 0;
    const deltaStr = delta > 0 ? `<span style="color:#ef4444">+${delta}</span>`
                   : delta < 0 ? `<span style="color:#22c55e">${delta}</span>`
                   : '<span style="color:#64748b">—</span>';

    return `
      <tr>
        <td>${new Date(e.timestamp).toLocaleString()}</td>
        <td style="color:${e.complianceScore >= 80 ? '#22c55e' : e.complianceScore >= 60 ? '#d97706' : '#ef4444'};font-weight:700">
          ${e.complianceScore}/100
        </td>
        <td style="color:#ef4444">${e.critical}</td>
        <td style="color:#ea580c">${e.serious}</td>
        <td style="color:#d97706">${e.moderate}</td>
        <td>${e.totalViolations} ${i > 0 ? deltaStr : ''}</td>
        <td style="color:#22c55e">${e.fixedViolations.join(', ') || '—'}</td>
        <td style="color:#ef4444">${e.newViolations.join(', ') || '—'}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Accessibility Trend Dashboard</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1 { color: #f8fafc; font-size: 1.5rem; margin-bottom: 0.5rem; }
    h2 { color: #94a3b8; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 1.5rem 0 0.75rem; }
    .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .stats { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .stat { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1rem 1.5rem; min-width: 140px; }
    .stat .num { font-size: 2.5rem; font-weight: 700; }
    .stat .label { color: #94a3b8; font-size: 0.75rem; margin-top: 0.25rem; }
    .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
    .chart-box { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1.25rem; }
    .chart-box h3 { color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
    th { background: #0f172a; color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.75rem 1rem; text-align: left; }
    td { padding: 0.75rem 1rem; border-bottom: 1px solid #334155; font-size: 0.8rem; }
    .trend-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 600; }
  </style>
</head>
<body>
  <h1>📈 Accessibility Trend Dashboard</h1>
  <p class="meta">
    URL: <code>${trendData.url}</code> &nbsp;|&nbsp;
    Total scans: ${entries.length} &nbsp;|&nbsp;
    Last updated: ${new Date(trendData.lastUpdated).toLocaleString()}
  </p>

  <!-- Current Status -->
  <div class="stats">
    <div class="stat">
      <div class="num" style="color:${latest.complianceScore >= 80 ? '#22c55e' : latest.complianceScore >= 60 ? '#d97706' : '#ef4444'}">
        ${latest.complianceScore}
      </div>
      <div class="label">Compliance Score /100</div>
    </div>
    <div class="stat">
      <div class="num" style="color:#ef4444">${latest.totalViolations}</div>
      <div class="label">Current Violations</div>
    </div>
    <div class="stat">
      <div class="num" style="color:#22c55e">${latest.fixedViolations.length}</div>
      <div class="label">Fixed Since Last Scan</div>
    </div>
    <div class="stat">
      <div class="num" style="color:#f59e0b">${entries.length}</div>
      <div class="label">Total Scans</div>
    </div>
    <div class="stat">
      <div class="num" style="font-size:1.5rem;padding-top:0.5rem">
        <span class="trend-badge" style="background:#1e293b;border:1px solid ${trendColor};color:${trendColor}">
          ${trend}
        </span>
      </div>
      <div class="label">Trend</div>
    </div>
  </div>

  <!-- Charts -->
  <div class="charts">
    <div class="chart-box">
      <h3>📊 Violations Over Time</h3>
      <canvas id="violationsChart" height="200"></canvas>
    </div>
    <div class="chart-box">
      <h3>🎯 Compliance Score Over Time</h3>
      <canvas id="scoreChart" height="200"></canvas>
    </div>
  </div>

  <!-- History Table -->
  <h2>📋 Scan History</h2>
  <table>
    <thead>
      <tr>
        <th>Timestamp</th>
        <th>Score</th>
        <th>Critical</th>
        <th>Serious</th>
        <th>Moderate</th>
        <th>Total</th>
        <th>✅ Fixed</th>
        <th>🆕 New</th>
      </tr>
    </thead>
    <tbody>${historyRows}</tbody>
  </table>

  <script>
    const labels = ${JSON.stringify(labels)};

    // Violations chart
    new Chart(document.getElementById('violationsChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Total',
            data: ${JSON.stringify(totalData)},
            borderColor: '#94a3b8',
            backgroundColor: 'rgba(148,163,184,0.1)',
            tension: 0.4,
            fill: true,
          },
          {
            label: 'Critical',
            data: ${JSON.stringify(criticalData)},
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.1)',
            tension: 0.4,
          },
          {
            label: 'Serious',
            data: ${JSON.stringify(seriousData)},
            borderColor: '#f97316',
            backgroundColor: 'rgba(249,115,22,0.1)',
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
          y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' }, beginAtZero: true },
        },
      },
    });

    // Score chart
    new Chart(document.getElementById('scoreChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Compliance Score',
          data: ${JSON.stringify(scoreData)},
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.1)',
          tension: 0.4,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
          y: {
            ticks: { color: '#64748b' },
            grid: { color: '#1e293b' },
            min: 0, max: 100,
          },
        },
      },
    });
  </script>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('📈 Accessibility Trend Tracker\n');

  // Load current scan
  const scan = loadCurrentScan();
  const url  = scan.url;
  console.log(`📂 Loaded scan for: ${url}`);
  console.log(`   Violations: ${scan.violations.length}`);

  // Load existing trend history
  const trendData = loadTrendData(url);
  const previousEntry = trendData.entries[trendData.entries.length - 1];

  // Current violation IDs
  const currentIds = scan.violations.map((v: any) => v.id);
  const previousIds = previousEntry?.violations ?? [];

  // Detect changes
  const { newViolations, fixedViolations } = detectChanges(currentIds, previousIds);

  // Build new entry
  const critical = scan.violations.filter((v: any) => v.impact === 'critical').length;
  const serious  = scan.violations.filter((v: any) => v.impact === 'serious').length;
  const moderate = scan.violations.filter((v: any) => v.impact === 'moderate').length;
  const minor    = scan.violations.filter((v: any) => v.impact === 'minor').length;

  const newEntry: TrendEntry = {
    timestamp: scan.timestamp,
    url,
    totalViolations: scan.violations.length,
    critical,
    serious,
    moderate,
    minor,
    passes: scan.passes,
    complianceScore: calculateScore({ critical, serious, moderate, minor }),
    violations: currentIds,
    newViolations,
    fixedViolations,
  };

  // Add to history
  trendData.entries.push(newEntry);
  trendData.lastUpdated = new Date().toISOString();

  // Save
  saveTrendData(url, trendData);
  console.log(`\n💾 Trend data saved — ${trendData.entries.length} total entries`);

  // Print changes
  if (fixedViolations.length > 0) {
    console.log(`\n✅ Fixed since last scan: ${fixedViolations.join(', ')}`);
  }
  if (newViolations.length > 0) {
    console.log(`\n🆕 New violations: ${newViolations.join(', ')}`);
  }

  console.log(`\n📊 Compliance Score: ${newEntry.complianceScore}/100`);

  // Generate HTML
  const html = generateTrendHTML(trendData);
  fs.writeFileSync(TREND_HTML, html);
  console.log(`📊 Trend dashboard: ${TREND_HTML}`);
}

main().catch(console.error);