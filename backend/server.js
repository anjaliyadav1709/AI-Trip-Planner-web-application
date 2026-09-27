/**
 * AI Trip Planner — backend, all in one file. FREE-DATA VERSION.
 * ------------------------------------------------------------
 * No Google API key, no billing account, no credit card anywhere in this
 * file. Real place search/nearby-POI data comes from OpenStreetMap via:
 *   - Nominatim  (search / geocoding)      https://nominatim.org
 *   - Overpass API (nearby points of interest) https://overpass-api.de
 * Real photos come from Wikimedia Commons via Wikidata, for places that
 * have a Wikidata entry (most well-known landmarks do) — also free.
 * Weather is Open-Meteo (free, no key). Email is Nodemailer/SMTP (needs
 * your own mailbox credentials, not a paid API).
 *
 * TRADE-OFF vs. Google Places: no card/billing risk at all, but coverage
 * and data quality are community-maintained rather than Google-run — some
 * places will be missing, sparsely tagged, or have no photo on Wikidata.
 *
 * SETUP (run these once, in a terminal, in this file's folder):
 *   1) npm init -y
 *   2) npm install express cors dotenv nodemailer
 *   3) Create a file named ".env" next to this one (see the block of
 *      variables listed just below — copy them in and fill your own values).
 *   4) node ai-trip-planner-backend.js
 *   5) You should see: "AI Trip Planner backend running on
 *      http://localhost:5175"
 *
 * .env FILE CONTENTS TO CREATE (copy this block into a real file named
 * ".env" and fill in your own values):
 * ------------------------------------------------------------
 *   PORT=5175
 *   APP_USER_AGENT=AI-Trip-Planner/1.0 (contact: you@example.com)
 *
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=your-email@gmail.com
 *   SMTP_PASS=your-16-char-gmail-app-password
 *   FROM_EMAIL=your-email@gmail.com
 * ------------------------------------------------------------
 * APP_USER_AGENT matters: OpenStreetMap's Nominatim usage policy requires
 * every request to identify the calling app with a real contact — put your
 * own email in there. Requests without one can get silently blocked.
 *
 * Gmail note: SMTP_PASS must be a Gmail "App Password" (Google Account →
 * Security → 2-Step Verification → App passwords), not your normal Gmail
 * login password — Google blocks that.
 *
 * USAGE LIMITS TO RESPECT (both free, both community-run — be a good
 * citizen or you risk getting rate-limited or blocked):
 *   - Nominatim: max ~1 request/second. This file already queues requests
 *     to enforce that automatically — don't remove that queue.
 *   - Overpass: keep queries small (this file limits results to 30) and
 *     don't hammer it in a tight loop.
 *   - For anything beyond light personal/dev use, self-hosting your own
 *     Nominatim/Overpass instance is the polite (and more reliable) path.
 *
 * TESTING IT:
 *   Alive check:  http://localhost:5175/health
 *   Weather:      http://localhost:5175/api/weather?lat=15.49&lon=73.82
 *   Search:       http://localhost:5175/api/places/search?query=Baga+Beach+Goa
 *   Nearby POIs:  http://localhost:5175/api/places/nearby?lat=15.55&lon=73.75&category=tourism
 *   Photo:        http://localhost:5175/api/places/photo?wikidata=Q243  (Eiffel Tower)
 *   Email (POST): curl -X POST http://localhost:5175/api/email/send \
 *     -H "Content-Type: application/json" \
 *     -d '{"to":"you@example.com","subject":"Test","text":"It works."}'
 *
 * IMPORTANT LIMIT: this server has to run somewhere with real network
 * access (this sandboxed chat environment and the published artifact page
 * both block it — the artifact's content-security policy refuses calls to
 * any external server, including this one). To wire the frontend to it for
 * real, host both yourself and point the frontend's fetch calls at this
 * server's real URL.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 5175;
const USER_AGENT = process.env.APP_USER_AGENT || 'AI-Trip-Planner/1.0 (no contact email set)';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const OVERPASS_BASE = 'https://overpass-api.de/api/interpreter';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

/* ---------- health ---------- */
app.get('/health', (_req, res) => res.json({ ok: true }));

/* ---------- Nominatim request queue: enforces the ~1 req/sec usage policy ---------- */
let nominatimChain = Promise.resolve();
function nominatimFetch(url) {
  const run = () =>
    fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      .then((r) => r.json())
      .then((data) => new Promise((resolve) => setTimeout(() => resolve(data), 1000)));
  const result = nominatimChain.then(run, run);
  nominatimChain = result.catch(() => {});
  return result;
}

/* ---------- search a place by free-text query (Nominatim) ---------- */
app.get('/api/places/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'query is required' });
    const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=1&extratags=1&limit=10`;
    const data = await nominatimFetch(url);
    const places = (Array.isArray(data) ? data : []).map((p) => ({
      id: `${p.osm_type}/${p.osm_id}`,
      name: p.name || p.display_name.split(',')[0],
      address: p.display_name,
      location: { lat: parseFloat(p.lat), lng: parseFloat(p.lon) },
      type: p.type,
      wikidata: p.extratags?.wikidata || null,
      wikipedia: p.extratags?.wikipedia || null,
    }));
    res.json({ places });
  } catch (e) {
    res.status(500).json({ error: 'places search failed', detail: String(e) });
  }
});

/* ---------- nearby points of interest around a coordinate (Overpass) ---------- */
// category examples: tourism, amenity=restaurant, historic, natural, shop
app.get('/api/places/nearby', async (req, res) => {
  try {
    const { lat, lon, radius = 1500, category = 'tourism' } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon are required' });
    const [key, val] = category.includes('=') ? category.split('=') : [category, null];
    const tagFilter = val ? `["${key}"="${val}"]` : `["${key}"]`;
    const overpassQuery = `[out:json][timeout:25];(node${tagFilter}(around:${radius},${lat},${lon});way${tagFilter}(around:${radius},${lat},${lon}););out center 30;`;
    const r = await fetch(OVERPASS_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'User-Agent': USER_AGENT },
      body: overpassQuery,
    });
    const data = await r.json();
    const places = (data.elements || [])
      .map((el) => ({
        id: `${el.type}/${el.id}`,
        name: el.tags?.name,
        category: el.tags?.[key] || category,
        location: { lat: el.lat || el.center?.lat, lng: el.lon || el.center?.lng || el.center?.lon },
        wikidata: el.tags?.wikidata || null,
        openingHours: el.tags?.opening_hours || null,
      }))
      .filter((p) => p.name);
    res.json({ places });
  } catch (e) {
    res.status(500).json({ error: 'nearby search failed', detail: String(e) });
  }
});

/* ---------- details for one place by OSM type + id (Nominatim lookup) ---------- */
app.get('/api/places/:osmType/:osmId', async (req, res) => {
  try {
    const { osmType, osmId } = req.params;
    const prefix = { node: 'N', way: 'W', relation: 'R' }[osmType];
    if (!prefix) return res.status(400).json({ error: 'osmType must be node, way, or relation' });
    const url = `${NOMINATIM_BASE}/lookup?osm_ids=${prefix}${osmId}&format=jsonv2&addressdetails=1&extratags=1`;
    const data = await nominatimFetch(url);
    res.json((Array.isArray(data) && data[0]) || {});
  } catch (e) {
    res.status(500).json({ error: 'place details failed', detail: String(e) });
  }
});

/* ---------- real photo via Wikidata → Wikimedia Commons (free, no key) ---------- */
// Pass the wikidata QID a search/nearby result returned, e.g. ?wikidata=Q243
app.get('/api/places/photo', async (req, res) => {
  try {
    const { wikidata } = req.query;
    if (!wikidata) return res.status(400).json({ error: 'wikidata QID is required (from a search result, if present)' });
    const wd = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${wikidata}.json`, {
      headers: { 'User-Agent': USER_AGENT },
    }).then((r) => r.json());
    const entity = wd.entities?.[wikidata];
    const image = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (!image) return res.status(404).json({ error: 'no photo on file for this place in Wikidata' });
    const commonsUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image.replace(/ /g, '_'))}?width=800`;
    res.redirect(commonsUrl);
  } catch (e) {
    res.status(500).json({ error: 'photo lookup failed', detail: String(e) });
  }
});

/* ---------- weather (Open-Meteo, no key needed) ---------- */
app.get('/api/weather', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon are required' });
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto`
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: 'weather fetch failed', detail: String(e) });
  }
});

/* ---------- email: sends for real, immediately, no user click ---------- */
app.post('/api/email/send', async (req, res) => {
  try {
    const { to, subject, text, html, attachmentBase64, attachmentName } = req.body;
    if (!to || !subject) return res.status(400).json({ error: 'to and subject are required' });
    const mail = { from: process.env.FROM_EMAIL || process.env.SMTP_USER, to, subject, text, html };
    if (attachmentBase64 && attachmentName) {
      mail.attachments = [{ filename: attachmentName, content: attachmentBase64, encoding: 'base64' }];
    }
    const info = await transporter.sendMail(mail);
    res.json({ ok: true, messageId: info.messageId });
  } catch (e) {
    res.status(500).json({ error: 'email send failed', detail: String(e) });
  }
});
app.listen(PORT, '0.0.0.0', () => console.log(
  `AI Trip Planner backend running on port ${PORT}`
));
