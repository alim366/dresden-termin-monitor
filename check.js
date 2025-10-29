import { chromium } from '@playwright/test';
import fetch from 'node-fetch';

const PUSHOVER_USER = process.env.PUSHOVER_USER;   // your Pushover User Key
const PUSHOVER_TOKEN = process.env.PUSHOVER_TOKEN; // your Pushover App Token

// Basic config
const START_URL = 'https://termine-buergerbuero.dresden.de/select2?md=1';
const CHECK_WINDOW = { start: '06:00', end: '19:00' }; // info only; we don’t need to filter times if site shows only available

// Helper: send a Pushover notification
async function notifyPushover(title, message) {
  const res = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: PUSHOVER_TOKEN,
      user: PUSHOVER_USER,
      title,
      message,
      priority: '0'
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pushover failed: ${res.status} ${text}`);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // TODO: Select the correct service category / concern.
    // Many TEVIS systems use a dropdown or tile for "Staatsangehörigkeit / Einbürgerung" or similar.
    // Example patterns (adjust to the real labels visible to you):
    // await page.getByRole('link', { name: /Einbürgerung/i }).click();
    // or:
    // await page.getByRole('button', { name: /Termin buchen/i }).click();

    // TODO: Navigate to the calendar view where dates/times are listed.
    // Wait for something like a calendar container:
    // await page.waitForSelector('.calendar, .tevis-calendar, table.calendar', { timeout: 30000 });

    // TODO: Extract available slots.
    // Strategy: find all link/buttons that represent *free* time entries.
    // Replace selectors with the actual ones after inspecting the site once.
    const slots = await page.$$eval('a, button, td, div', nodes => {
      const times = [];
      const timeRegex = /\b([01]?\d|2[0-3]):[0-5]\d\b/; // 00:00–23:59
      nodes.forEach(n => {
        const text = (n.innerText || '').trim();
        // Heuristic: entries that contain a time and look clickable/available
        if (timeRegex.test(text) && !/ausgebucht|belegt|nicht verfügbar/i.test(text)) {
          times.push(text);
        }
      });
      return times;
    });

    // Deduplicate and take first 4 items (1 primary + up to 3 more)
    const uniqueTimes = Array.from(new Set(slots)).slice(0, 4);

    if (uniqueTimes.length > 0) {
      // Optional: parse location/service text (adjust selector):
      let location = '';
      try {
        // example placeholder; adjust after inspecting:
        const locEl = await page.$('h1, .location, .office, .breadcrumb');
        if (locEl) location = (await locEl.innerText()).trim();
      } catch {}

      const primary = uniqueTimes[0];
      const more = uniqueTimes.slice(1).join(', ');

      let message = `Time: ${primary}`;
      if (more) message += `\nMore: ${more}`;
      if (location) message += `\nPlace: ${location}`;

      await notifyPushover('Slot available – Dresden Bürgerbüro', message);
      // Exit with 0 to mark success
      process.exit(0);
    } else {
      // No slot → do nothing and exit silently
      process.exit(0);
    }
  } catch (err) {
    // Don’t spam on errors; log to workflow logs only
    console.error('Check failed:', err.message);
    process.exit(0);
  } finally {
    await context.close();
    await browser.close();
  }
}

if (!PUSHOVER_USER || !PUSHOVER_TOKEN) {
  console.error('Missing Pushover credentials');
  process.exit(0);
}

run();
