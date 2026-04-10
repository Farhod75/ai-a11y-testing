/**
 * Slack Notification System
 * Sends accessibility audit results to Slack
 * 
 * Usage: npx ts-node scripts/slack-notifier.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ─── Types ────────────────────────────────────────────────────────────────────
interface SlackBlock {
  type: string;
  [key: string]: any;
}

interface NotificationPayload {
  blocks: SlackBlock[];
  text: string; // Fallback for notifications
}

// ─── Load Report Data ─────────────────────────────────────────────────────────
function loadLatestScan() {
  const violationsPath = path.join(process.cwd(), 'reports', 'violations.json');
  const analysisPath   = path.join(process.cwd(), 'reports', 'ai-analysis.json');
  const crawlPath      = path.join(process.cwd(), 'reports', 'crawl-results.json');

  // Try crawl report first (more complete)
  if (fs.existsSync(crawlPath)) {
    const crawl = JSON.parse(fs.readFileSync(crawlPath, 'utf-8'));
    return { type: 'crawl', data: crawl };
  }

  // Fall back to single page scan
  if (fs.existsSync(violationsPath)) {
    const scans    = JSON.parse(fs.readFileSync(violationsPath, 'utf-8'));
    const analysis = fs.existsSync(analysisPath)
      ? JSON.parse(fs.readFileSync(analysisPath, 'utf-8'))
      : [];
    return { type: 'single', data: scans[scans.length - 1], analysis };
  }

  return null;
}

// ─── Build Slack Message ──────────────────────────────────────────────────────
function buildSlackMessage(report: any): NotificationPayload {
  const isCrawl = report.type === 'crawl';
  const data    = report.data;

  // Determine overall status
  const totalViolations = isCrawl
    ? data.totalViolations
    : data.violations?.length ?? 0;

  const criticalCount = isCrawl
    ? data.criticalCount
    : (data.violations?.filter((v: any) => v.impact === 'critical').length ?? 0);

  const url = isCrawl ? data.baseUrl : data.url;
  const pagesScanned = isCrawl ? data.totalPages : 1;

  // Status emoji and color
  const statusEmoji  = criticalCount > 0 ? '🚨' : totalViolations > 0 ? '⚠️' : '✅';
  const statusText   = criticalCount > 0 ? 'CRITICAL VIOLATIONS FOUND'
                     : totalViolations > 0 ? 'Violations Found'
                     : 'All Clear — WCAG Compliant!';
  const headerColor  = criticalCount > 0 ? '#dc2626'
                     : totalViolations > 0 ? '#d97706'
                     : '#22c55e';

  // Build Slack blocks (rich formatting)
  const blocks: SlackBlock[] = [
    // ── Header ───────────────────────────────────────────────────────────────
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${statusEmoji} Accessibility Audit — ${statusText}`,
        emoji: true,
      },
    },

    // ── URL + timestamp ───────────────────────────────────────────────────────
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*🌐 URL:*\n<${url}|${url.slice(0, 50)}...>`,
        },
        {
          type: 'mrkdwn',
          text: `*🕐 Scanned:*\n${new Date().toLocaleString()}`,
        },
      ],
    },

    { type: 'divider' },

    // ── Stats ─────────────────────────────────────────────────────────────────
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*📄 Pages Scanned:*\n${pagesScanned}`,
        },
        {
          type: 'mrkdwn',
          text: `*❌ Total Violations:*\n${totalViolations}`,
        },
        {
          type: 'mrkdwn',
          text: `*🔴 Critical:*\n${criticalCount}`,
        },
        {
          type: 'mrkdwn',
          text: `*🟠 Serious:*\n${isCrawl ? data.seriousCount : data.violations?.filter((v: any) => v.impact === 'serious').length ?? 0}`,
        },
      ],
    },

    { type: 'divider' },
  ];

  // ── Critical violations detail ──────────────────────────────────────────────
  if (criticalCount > 0) {
    const criticalViolations = isCrawl
      ? data.pages.flatMap((p: any) =>
          p.violations
            .filter((v: any) => v.impact === 'critical')
            .map((v: any) => `• *${v.id}* on ${p.url}`)
        ).slice(0, 5)
      : data.violations
          .filter((v: any) => v.impact === 'critical')
          .map((v: any) => `• *${v.id}*: ${v.help}`)
          .slice(0, 5);

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🚨 Critical Violations (must fix immediately):*\n${criticalViolations.join('\n')}`,
      },
    });

    blocks.push({ type: 'divider' });
  }

  // ── AI Analysis summary ─────────────────────────────────────────────────────
  if (isCrawl && data.totalViolations === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '✅ *Zero violations found across all pages!*\nYour app is WCAG 2.1 AA compliant. Keep up the great work! 🏆',
      },
    });
  } else if (!isCrawl && report.analysis?.length > 0) {
    const topPriority = report.analysis
      .filter((a: any) => a.priority === 1)
      .slice(0, 3)
      .map((a: any) => `• *${a.violationId}*: ${a.summary} _(${a.estimatedEffort} effort)_`)
      .join('\n');

    if (topPriority) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🤖 Claude AI — Top Priority Fixes:*\n${topPriority}`,
        },
      });
      blocks.push({ type: 'divider' });
    }
  }

  // ── Action buttons ──────────────────────────────────────────────────────────
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '📊 View Report', emoji: true },
        url: url,
        style: criticalCount > 0 ? 'danger' : 'primary',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '🐙 GitHub Actions', emoji: true },
        url: 'https://github.com/Farhod75/ai-a11y-testing/actions',
      },
    ],
  });

  // ── Footer ──────────────────────────────────────────────────────────────────
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: '🤖 Powered by *Claude AI* + *Playwright* + *axe-core* | WCAG 2.1 AA',
      },
    ],
  });

  return {
    text: `${statusEmoji} Accessibility Audit: ${totalViolations} violations found on ${url}`,
    blocks,
  };
}

// ─── Send to Slack ────────────────────────────────────────────────────────────
async function sendToSlack(payload: NotificationPayload): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.error('❌ SLACK_WEBHOOK_URL not set in .env');
    process.exit(1);
  }

  console.log('📤 Sending to Slack...');

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (response.ok) {
    console.log('✅ Slack notification sent successfully!');
  } else {
    const error = await response.text();
    console.error(`❌ Slack error: ${response.status} — ${error}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('📣 Accessibility Slack Notifier\n');

  const report = loadLatestScan();

  if (!report) {
    console.error('❌ No scan data found. Run the crawler first.');
    process.exit(1);
  }

  console.log(`📂 Loaded: ${report.type} report`);

  const payload = buildSlackMessage(report);
  await sendToSlack(payload);
}

main().catch(console.error);