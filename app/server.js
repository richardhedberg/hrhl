import express from "express";
import fetch from "node-fetch";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

/* =========================
   League Config (edit me) TEST
   ========================= */
const LEAGUE_ID = "1520";               // numeric part after .l.
const DEFAULT_YEAR = 2024;              // 2024 -> 2024-25
const GAME_KEYS = {
  2014: 206, 2015: 236, 2016: 267, 2017: 308, 2018: 331,
  2019: 342, 2020: 363, 2021: 380, 2022: 395, 2023: 410,
  2024: 453, // current
};
function leagueKeyForYear(year) {
  const game = GAME_KEYS[year];
  if (!game) throw new Error(`No game_key configured for year ${year}`);
  return `${game}.l.${LEAGUE_ID}`;
}

/* =========================
   OAuth (refresh token)
   ========================= */
const { YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REDIRECT_URI } = process.env;
let accessToken = null;
let accessTokenExpiresAt = 0;
let latestRefreshToken = null;

async function refreshAccessToken() {
  if (!process.env.YAHOO_REFRESH_TOKEN) {
    throw new Error("Missing YAHOO_REFRESH_TOKEN. Visit /admin/login once, then paste refresh_token into .env");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.YAHOO_REFRESH_TOKEN,
  });
  const basic = Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString("base64");
  const r = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`refresh get_token ${r.status}: ${txt}`);
  const json = JSON.parse(txt);
  accessToken = json.access_token;
  accessTokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000 - 60 * 1000;
  if (json.refresh_token && json.refresh_token !== process.env.YAHOO_REFRESH_TOKEN) {
    latestRefreshToken = json.refresh_token;
    console.warn("Yahoo rotated refresh_token. Update your .env");
  }
  return accessToken;
}
async function ensureAccessToken() {
  if (!accessToken || Date.now() >= accessTokenExpiresAt) await refreshAccessToken();
  return accessToken;
}

/* =========================
   Express app
   ========================= */
const app = express();
app.set("trust proxy", 1);

// --- static frontend
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const publicDir = path.join(__dirname, "public");
const hasDist = fs.existsSync(distDir);
const fallbackHtml = hasDist
  ? path.join(distDir, "index.html")
  : path.join(publicDir, "heatmap.html");

if (hasDist) app.use(express.static(distDir));
app.use(express.static(publicDir));

function serveApp(_req, res) {
  if (fs.existsSync(fallbackHtml)) {
    res.sendFile(fallbackHtml);
  } else {
    res.status(404).type("text").send("Frontend build not found.");
  }
}

app.get(["/", "/heatmap"], serveApp);
app.get(/^\/(?!api|admin).*/, serveApp);

// one-time: obtain refresh token (if needed)
app.get("/admin/login", (_req, res) => {
  const p = new URLSearchParams({
    client_id: YAHOO_CLIENT_ID,
    redirect_uri: YAHOO_REDIRECT_URI,
    response_type: "code",
  });
  res.redirect(`https://api.login.yahoo.com/oauth2/request_auth?${p.toString()}`);
});
app.get("/auth/callback", async (req, res) => {
  try {
    if (req.query.error) {
      return res.status(400).type("html").send(
        `<h2>OAuth error</h2><pre>${req.query.error}: ${req.query.error_description || ""}</pre>`
      );
    }
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing ?code");
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: YAHOO_REDIRECT_URI });
    const basic = Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString("base64");
    const r = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const txt = await r.text();
    if (!r.ok) return res.status(r.status).type("text").send(txt);
    const tokens = JSON.parse(txt);
    accessToken = tokens.access_token;
    accessTokenExpiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000 - 60 * 1000;
    res.type("html").send(
      "<h2>Success ✅</h2><p>Copy this into .env as <code>YAHOO_REFRESH_TOKEN</code>:</p>" +
      `<pre style="white-space:pre-wrap;">${tokens.refresh_token || "(no refresh_token returned)"}</pre>` +
      `<p><a href="/">Home</a></p>`
    );
  } catch (e) {
    res.status(500).type("text").send(String(e));
  }
});
app.get("/admin/refresh-token", (_req, res) => res.type("text").send(latestRefreshToken || "(none)"));
app.get("/health", (_req, res) => res.json({ ok: true, port: process.env.PORT || 8080 }));

/* =========================
   Yahoo helpers
   ========================= */
function findMatchupsDeep(root) {
  const found = [];
  const toArray = (x) => (!x ? [] : Array.isArray(x) ? x : [x]);
  function visit(node) {
    if (!node) return;
    if (node.matchup) found.push(...toArray(node.matchup));
    if (node.matchups) {
      const m = node.matchups;
      if (Array.isArray(m)) for (const it of m) if (it?.matchup) found.push(...toArray(it.matchup));
      else if (typeof m === "object") for (const k of Object.keys(m)) if (k !== "count") {
        const got = m[k]?.matchup || m[k];
        if (got) found.push(...toArray(got));
      }
    }
    if (Array.isArray(node)) for (const v of node) visit(v);
    else if (typeof node === "object") for (const k of Object.keys(node)) visit(node[k]);
  }
  visit(root);
  return found;
}
function deepFindFirst(node, picker) {
  const seen = new Set();
  function walk(x) {
    if (!x || typeof x !== "object") return null;
    if (seen.has(x)) return null;
    seen.add(x);
    const got = picker(x);
    if (got != null) return got;
    if (Array.isArray(x)) {
      for (const v of x) {
        const r = walk(v);
        if (r != null) return r;
      }
    } else {
      for (const k of Object.keys(x)) {
        const r = walk(x[k]);
        if (r != null) return r;
      }
    }
    return null;
  }
  return walk(node);
}

function yahooScalar(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (Array.isArray(value)) {
    for (const item of value) {
      const got = yahooScalar(item);
      if (got != null && got !== "") return got;
    }
    return null;
  }
  if (typeof value === "object") {
    if (typeof value.$ === "string") return value.$;
    if (typeof value.full === "string") return value.full;
    if (typeof value.value === "string") return value.value;
    for (const key of Object.keys(value)) {
      const got = yahooScalar(value[key]);
      if (got != null && got !== "") return got;
    }
  }
  return null;
}

function findYahooValue(node, key) {
  return deepFindFirst(node, (n) =>
    Object.prototype.hasOwnProperty.call(n, key) ? yahooScalar(n[key]) : null
  );
}

function pickTeamKey(node) {
  const key = findYahooValue(node, "team_key");
  return typeof key === "string" && key ? key : null;
}

function pickTeamName(node) {
  for (const field of ["team_name", "name", "nickname"]) {
    const val = findYahooValue(node, field);
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function findTeamNode(matchup, teamKey) {
  if (!teamKey) return null;
  return deepFindFirst(matchup, (candidate) => {
    const key = pickTeamKey(candidate);
    return key === teamKey ? candidate : null;
  });
}

function resolveTeamName(teamDir, matchup, teamKey) {
  const cached = teamDir.get(teamKey);
  if (cached) return cached;
  const node = findTeamNode(matchup, teamKey);
  if (node) {
    const name = pickTeamName(node);
    if (name) {
      teamDir.set(teamKey, name);
      return name;
    }
  }
  return teamKey;
}

function normalizeYahooList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") {
    return Object.keys(value)
      .filter((k) => k !== "count")
      .map((k) => value[k])
      .filter(Boolean);
  }
  return [value];
}

function normalizeTeamsContainer(tc) {
  if (!tc) return [];
  if (Array.isArray(tc)) return tc;
  if (typeof tc === "object") {
    return Object.keys(tc)
      .filter((k) => k !== "count")
      .map((k) => tc[k]?.team || tc[k])
      .filter(Boolean);
  }
  return [];
}

function extractTeamStatNodes(teamNode) {
  if (!teamNode) return [];
  let statsContainer = teamNode?.team_stats?.stats;
  if (!statsContainer) {
    statsContainer = deepFindFirst(teamNode, (n) =>
      n?.team_stats?.stats ? n.team_stats.stats : null
    );
  }
  if (!statsContainer) return [];
  const raw = normalizeYahooList(statsContainer?.stat || statsContainer);
  return raw.map((item) => (item?.stat ? item.stat : item)).filter(Boolean);
}

function parseStatValue(raw) {
  if (raw == null || raw === "") return 0;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function ensureNestedMap(map, key) {
  if (!map.has(key)) map.set(key, new Map());
  return map.get(key);
}

function ensureOutcomeRecord(map, teamKey, statId) {
  const teamMap = ensureNestedMap(map, teamKey);
  if (!teamMap.has(statId)) teamMap.set(statId, { wins: 0, losses: 0, ties: 0 });
  return teamMap.get(statId);
}

function extractStatWinnersDetailed(matchup) {
  const winners = [];
  const swc =
    matchup?.stat_winners ||
    matchup?.["0"]?.stat_winners ||
    matchup?.["1"]?.stat_winners;
  if (!swc) return winners;
  const wrap = normalizeYahooList(swc);
  for (const item of wrap) {
    const node = item?.stat_winner || item;
    if (!node) continue;
    const statId = findYahooValue(node, "stat_id");
    if (!statId) continue;
    const tiedVal = findYahooValue(node, "is_tied");
    const isTied =
      tiedVal === 1 ||
      tiedVal === "1" ||
      tiedVal === true ||
      (typeof tiedVal === "string" && tiedVal.toLowerCase() === "true");
    const winnerKey = findYahooValue(node, "winner_team_key");
    winners.push({ statId, winnerKey: winnerKey || null, isTied });
  }
  return winners;
}

async function getTeamDirectory(leagueKey) {
  const at = await ensureAccessToken();
  const url = `https://fantasysports.yahooapis.com/fantasy/v2/league/${encodeURIComponent(leagueKey)}/teams?format=json`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { return new Map(); }

  const map = new Map();

  // preferred path
  try {
    const league = j?.fantasy_content?.league;
    const teamsContainer = (Array.isArray(league) ? league.find((x) => x && x.teams)?.teams : league?.teams) ?? league?.[1]?.teams;
    let teams = teamsContainer?.team;
    if (!Array.isArray(teams) && teams && typeof teams === "object") {
      teams = Object.keys(teams).filter((k) => k !== "count").map((k) => teams[k]?.team || teams[k]).filter(Boolean);
    }
    if (Array.isArray(teams)) {
      for (const t of teams) {
        const items = Array.isArray(t) ? t : t?.team || t;
        const arr = Array.isArray(items) ? items : [items];
        let key = null, name = null;
        for (const node of arr) {
          if (!node || typeof node !== "object") continue;
          if (!key) key = pickTeamKey(node);
          if (!name) name = pickTeamName(node);
        }
        if (key && name) map.set(key, name);
      }
    }
  } catch {}

  // fallback walk
  if (map.size === 0) {
    (function walk(x) {
      if (!x) return;
      if (Array.isArray(x)) {
        for (const v of x) walk(v);
      } else if (typeof x === "object") {
        const key = pickTeamKey(x);
        const name = pickTeamName(x);
        if (key && name) map.set(key, name);
        for (const k of Object.keys(x)) walk(x[k]);
      }
    })(j);
  }
  return map;
}
function extractTwoTeamKeysFromMatchup(m) {
  const keys = [];
  const seen = new Set();
  const reKey = /\b\d+\.l\.\d+\.t\.\d+\b/;
  (function walk(x) {
    if (!x || seen.has(x)) return;
    if (typeof x === "string") { const mm = x.match(reKey); if (mm && !keys.includes(mm[0])) keys.push(mm[0]); return; }
    seen.add(x);
    if (Array.isArray(x)) for (const v of x) walk(v);
    else if (typeof x === "object") for (const k of Object.keys(x)) walk(x[k]);
  })(m?.teams || m);
  return keys.slice(0, 2);
}
function winsFromStatWinners(matchup, keyA, keyB) {
  const swc = matchup?.stat_winners || matchup?.["0"]?.stat_winners || matchup?.["1"]?.stat_winners;
  if (!swc) return null;
  const winners = [];
  if (Array.isArray(swc)) for (const item of swc) winners.push(item?.stat_winner || item);
  else if (typeof swc === "object") for (const k of Object.keys(swc)) if (k !== "count") winners.push(swc[k]?.stat_winner || swc[k]);
  let a = 0, b = 0, ties = 0;
  for (const w of winners) {
    if (!w) continue;
    const tied = w.is_tied === 1 || w.is_tied === "1" || w.is_tied === true;
    if (tied) { ties++; continue; }
    if (w.winner_team_key === keyA) a++;
    else if (w.winner_team_key === keyB) b++;
  }
  return { a, b, ties, total: a + b + ties };
}

/* =========================
   Core fetchers
   ========================= */
async function yahooGetJSON(url, at) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = null; }
  return { ok: r.ok, status: r.status, json: j, text: txt };
}
async function fetchScoreboardWeeks(leagueKey, { from = 1, to = 40 } = {}) {
  const at = await ensureAccessToken();
  const weeks = [];
  let sawAny = false;
  for (let w = from; w <= to; w++) {
    const url = `https://fantasysports.yahooapis.com/fantasy/v2/league/${encodeURIComponent(leagueKey)}/scoreboard;week=${w}?format=json`;
    const { ok, status, json } = await yahooGetJSON(url, at);
    if (status === 404) break;
    if (!ok || !json) continue;
    const matchups = findMatchupsDeep(json);
    if (matchups.length) { weeks.push({ week: w, matchups, raw: json }); sawAny = true; }
    else if (sawAny) break;
  }
  return weeks;
}

async function getStatCategories(leagueKey) {
  const cached = statCategoriesCache.get(leagueKey);
  if (cached && cached.until > Date.now()) return cached.categories;

  const at = await ensureAccessToken();
  const url = `https://fantasysports.yahooapis.com/fantasy/v2/league/${encodeURIComponent(
    leagueKey
  )}/settings?format=json`;
  const { status, json, text } = await yahooGetJSON(url, at);
  if (!json) throw new Error(`settings fetch ${status}: ${text}`);

  const statsContainer = deepFindFirst(json, (n) =>
    n?.stat_categories?.stats ? n.stat_categories.stats : null
  );
  const rawStats = normalizeYahooList(statsContainer?.stat || statsContainer);
const categories = rawStats
    .map((node) => (node?.stat ? node.stat : node))
    .filter(Boolean)
    .map((node) => {
      const id = findYahooValue(node, "stat_id");
      if (!id) return null;
      const name = findYahooValue(node, "name") || null;
      const displayName =
        findYahooValue(node, "display_name") ||
        findYahooValue(node, "abbrev") ||
        name ||
        id;
      const sortOrderRaw = findYahooValue(node, "sort_order");
      const decimalPlacesRaw = findYahooValue(node, "decimal_places");
      const positionType = findYahooValue(node, "stat_position_type") || null;
      const isOnlyDisplay = findYahooValue(node, "is_only_display_stat");
      const sortOrder = Number(sortOrderRaw);
      const decimalPlaces = Number(decimalPlacesRaw);
      return {
        id,
        name: name || displayName,
        display_name: displayName,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : null,
        decimal_places: Number.isFinite(decimalPlaces) ? decimalPlaces : null,
        position_type: positionType,
        is_only_display: isOnlyDisplay === 1 || isOnlyDisplay === "1" || isOnlyDisplay === true,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aOrder = a.sort_order ?? Number(a.id) ?? 0;
      const bOrder = b.sort_order ?? Number(b.id) ?? 0;
      return aOrder - bOrder;
    });

  statCategoriesCache.set(leagueKey, {
    until: Date.now() + 30 * 60 * 1000,
    categories,
  });
  return categories;
}

const seasonStatsCache = new Map();

function ensureArrayMap(store, key) {
  if (!store.has(key)) store.set(key, new Map());
  return store.get(key);
}

function ensureNumberArray(map, key) {
  if (!map.has(key)) map.set(key, []);
  return map.get(key);
}

function addToMap(map, key, amount) {
  map.set(key, (map.get(key) || 0) + amount);
}

function sumNumericDeep(node) {
  if (node == null) return 0;
  if (typeof node === "number") return Number.isFinite(node) ? node : 0;
  if (typeof node === "string") {
    const num = Number(node);
    return Number.isFinite(num) ? num : 0;
  }
  if (Array.isArray(node)) return node.reduce((acc, v) => acc + sumNumericDeep(v), 0);
  if (typeof node === "object") {
    let sum = 0;
    for (const key of Object.keys(node)) sum += sumNumericDeep(node[key]);
    return sum;
  }
  return 0;
}

async function getTeamStandingsSummary(leagueKey) {
  const at = await ensureAccessToken();
  const url = `https://fantasysports.yahooapis.com/fantasy/v2/league/${encodeURIComponent(
    leagueKey
  )}/standings?format=json`;
  const { status, json, text } = await yahooGetJSON(url, at);
  if (!json) throw new Error(`standings fetch ${status}: ${text}`);

  const container = deepFindFirst(json, (node) =>
    node?.standings?.teams ? node.standings.teams : null
  );
  let teamsRaw = [];
  if (container?.team) teamsRaw = normalizeTeamsContainer(container.team);
  else teamsRaw = normalizeTeamsContainer(container);

  const summary = new Map();
  for (const item of teamsRaw) {
    const node = item?.team || item;
    if (!node || typeof node !== "object") continue;
    const key = pickTeamKey(node);
    if (!key) continue;
    const standings = deepFindFirst(node, (n) => (n?.team_standings ? n.team_standings : null));
    const outcomeTotals = standings?.outcome_totals || null;
    const movesRaw =
      findYahooValue(node, "number_of_moves") ||
      (typeof standings?.moves !== "undefined" ? standings.moves : null) ||
      (standings ? findYahooValue(standings, "moves") : null);
    const tradesRaw =
      findYahooValue(node, "number_of_trades") ||
      (typeof standings?.trades !== "undefined" ? standings.trades : null) ||
      (standings ? findYahooValue(standings, "trades") : null);
    const winsRaw = outcomeTotals ? outcomeTotals.wins : null;
    const lossesRaw = outcomeTotals ? outcomeTotals.losses : null;
    const tiesRaw = outcomeTotals ? outcomeTotals.ties : null;
    const pctRaw = outcomeTotals ? outcomeTotals.percentage : null;
    let moves = Number(movesRaw);
    console.log("team", key, "movesRaw", movesRaw, "->", moves);
    if (!Number.isFinite(moves) || moves === 0) {
      const txnNode = deepFindFirst(node, (n) =>
        n?.transaction_counter ? n.transaction_counter : null
      );
      const totalNode = txnNode ? txnNode.total || txnNode : null;
      const derived = sumNumericDeep(totalNode);
      if (Number.isFinite(derived) && derived > 0) moves = derived;
      else moves = 0;
    }
    let trades = Number(tradesRaw);
    if (!Number.isFinite(trades) || trades === 0) {
      const txnNode = deepFindFirst(node, (n) =>
        n?.transaction_counter ? n.transaction_counter : null
      );
      const tradesNode = txnNode?.trades || txnNode?.trade;
      const derivedTrades = sumNumericDeep(tradesNode);
      if (Number.isFinite(derivedTrades) && derivedTrades > 0) trades = derivedTrades;
      else trades = 0;
    }
    summary.set(key, {
      moves,
      trades,
      wins: Number(winsRaw) || 0,
      losses: Number(lossesRaw) || 0,
      ties: Number(tiesRaw) || 0,
      winPct: pctRaw != null ? Number(pctRaw) || 0 : null,
    });
  }
  return summary;
}

async function collectSeasonStats(leagueKey, { from = 1, to = 40 } = {}) {
  const cacheKey = `${leagueKey}:${from}:${to}`;
  const cached = seasonStatsCache.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.payload;

  const teamDir = await getTeamDirectory(leagueKey);
  const weeks = await fetchScoreboardWeeks(leagueKey, { from, to });
  if (!weeks.length) throw new Error("no data");

  const categories = await getStatCategories(leagueKey);
  const categoryIds = new Set(categories.map((c) => c.id));

  const totalsByTeam = new Map();
  const outcomesByTeam = new Map();
  const marginsByTeam = new Map();
  const totalsByCategory = new Map();
  const winEquivalentsByCategory = new Map();
  const gamesByCategory = new Map();

  for (const wk of weeks) {
    for (const matchup of wk.matchups) {
      const keys = extractTwoTeamKeysFromMatchup(matchup);
      if (!keys[0] || !keys[1]) continue;
      const summary = winsFromStatWinners(matchup, keys[0], keys[1]);
      if (!summary || summary.total === 0) continue;

      const teamStatsMap = new Map();
      for (const key of keys) {
        const node = findTeamNode(matchup, key);
        if (!node) continue;
        const statsNodes = extractTeamStatNodes(node);
        const statMap = new Map();
        for (const statNode of statsNodes) {
          const statId = findYahooValue(statNode, "stat_id");
          if (!statId) continue;
          categoryIds.add(statId);
          const rawValue =
            findYahooValue(statNode, "value") ??
            findYahooValue(statNode, "stat_value") ??
            0;
          const value = parseStatValue(rawValue);
          statMap.set(statId, value);
        }
        teamStatsMap.set(key, statMap);
      }

      if (!teamStatsMap.has(keys[0]) || !teamStatsMap.has(keys[1])) continue;

      for (const key of keys) {
        const statMap = teamStatsMap.get(key);
        const totalsMap = ensureNestedMap(totalsByTeam, key);
        for (const [statId, value] of statMap.entries()) {
          addToMap(totalsMap, statId, value);
          addToMap(totalsByCategory, statId, value);
        }
      }

      const statIds = new Set([
        ...teamStatsMap.get(keys[0]).keys(),
        ...teamStatsMap.get(keys[1]).keys(),
      ]);

      for (const statId of statIds) {
        const aVal = teamStatsMap.get(keys[0]).get(statId) || 0;
        const bVal = teamStatsMap.get(keys[1]).get(statId) || 0;
        const marginA = aVal - bVal;
        const marginB = bVal - aVal;
        const arrA = ensureNestedMap(marginsByTeam, keys[0]);
        const arrB = ensureNestedMap(marginsByTeam, keys[1]);
        ensureNumberArray(arrA, statId).push(marginA);
        ensureNumberArray(arrB, statId).push(marginB);
        addToMap(gamesByCategory, statId, 1);
      }

      const detailed = extractStatWinnersDetailed(matchup);
      for (const item of detailed) {
        const statId = item.statId;
        if (!statId) continue;
        if (item.isTied || !item.winnerKey) {
          for (const key of keys) {
            const rec = ensureOutcomeRecord(outcomesByTeam, key, statId);
            rec.ties += 1;
            addToMap(winEquivalentsByCategory, statId, 0.5);
          }
          continue;
        }
        const winner = keys.find((k) => k === item.winnerKey);
        const loser = keys.find((k) => k !== item.winnerKey) || null;
        if (winner) {
          const winRec = ensureOutcomeRecord(outcomesByTeam, winner, statId);
          winRec.wins += 1;
          addToMap(winEquivalentsByCategory, statId, 1);
        }
        if (loser) {
          const loseRec = ensureOutcomeRecord(outcomesByTeam, loser, statId);
          loseRec.losses += 1;
        }
      }
    }
  }

  const orderedCategories = [...categoryIds]
    .map((id) => categories.find((c) => c.id === id) || {
      id,
      name: id,
      display_name: id,
      sort_order: null,
      decimal_places: null,
    })
    .sort((a, b) => {
      const aOrder = a.sort_order ?? Number(a.id) ?? 0;
      const bOrder = b.sort_order ?? Number(b.id) ?? 0;
      return aOrder - bOrder;
    });

  const payload = {
    teamDir,
    weeks,
    categories: orderedCategories,
    totalsByTeam,
    outcomesByTeam,
    marginsByTeam,
    totalsByCategory,
    winEquivalentsByCategory,
    gamesByCategory,
    from,
    to,
  };

  seasonStatsCache.set(cacheKey, {
    until: Date.now() + 5 * 60 * 1000,
    payload,
  });

  return payload;
}

function calculateMean(values) {
  if (!values.length) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

function calculateStdDev(values, mean) {
  if (values.length < 2) return 0;
  const variance = values.reduce((acc, val) => acc + (val - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/* =========================
   API: standings & weekly matrix
   ========================= */
app.get("/api/standings", async (req, res) => {
  try {
    const year = Number(req.query.year || DEFAULT_YEAR);
    const leagueKey = leagueKeyForYear(year);
    const at = await ensureAccessToken();
    const url = `https://fantasysports.yahooapis.com/fantasy/v2/league/${encodeURIComponent(leagueKey)}/standings?format=json`;
    const { status, json, text } = await yahooGetJSON(url, at);
    if (!json) return res.status(status).type("text").send(text);
    res.json(json);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const matrixCache = new Map();
const statCategoriesCache = new Map();

app.get("/api/weekly-matrix", async (req, res) => {
  try {
    const year = Number(req.query.year || DEFAULT_YEAR);
    const leagueKey = leagueKeyForYear(year);
    const from = Math.max(1, Number(req.query.min || 1));
    const to = Math.max(from, Number(req.query.max || 40));
    const cacheKey = `${year}:${from}:${to}`;

    const cached = matrixCache.get(cacheKey);
    if (cached && cached.until > Date.now()) return res.json(cached.payload);

    const teamDir = await getTeamDirectory(leagueKey);
    const weeks = await fetchScoreboardWeeks(leagueKey, { from, to });

    const rows = [];
    for (const wk of weeks) {
      for (const m of wk.matchups) {
        const [aKey, bKey] = extractTwoTeamKeysFromMatchup(m);
        if (!aKey || !bKey) continue;
        const sw = winsFromStatWinners(m, aKey, bKey);
        if (!sw || sw.total === 0) continue; // in-progress week

        const aName = resolveTeamName(teamDir, m, aKey);
        const bName = resolveTeamName(teamDir, m, bKey);
        const aRes = sw.a > sw.b ? "W" : sw.a < sw.b ? "L" : "T";
        const bRes = sw.b > sw.a ? "W" : sw.b < sw.a ? "L" : "T";

        rows.push({ week: wk.week, team: aName, points: sw.a, opp_points: sw.b, result: aRes, opp_name: bName });
        rows.push({ week: wk.week, team: bName, points: sw.b, opp_points: sw.a, result: bRes, opp_name: aName }); // <-- fixed opp_name
      }
    }
    if (!rows.length) return res.status(404).json({ error: "no data" });

    // order teams by average weekly wins
    const totals = new Map(), counts = new Map();
    for (const r of rows) { totals.set(r.team, (totals.get(r.team) || 0) + r.points); counts.set(r.team, (counts.get(r.team) || 0) + 1); }
    const teams = [...totals.entries()].map(([t, sum]) => [t, sum / counts.get(t)]).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const weeksArr = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b);

    const points = teams.map((team) => weeksArr.map((week) => (rows.find((x) => x.team === team && x.week === week)?.points ?? null)));
    const outcome = teams.map((team) => weeksArr.map((week) => (rows.find((x) => x.team === team && x.week === week)?.result ?? null)));
    const oppPoints = teams.map((team) => weeksArr.map((week) => (rows.find((x) => x.team === team && x.week === week)?.opp_points ?? null)));
    const oppName   = teams.map((team) => weeksArr.map((week) => (rows.find((x) => x.team === team && x.week === week)?.opp_name   ?? "")));

    const payload = { season_year: year, league_key: leagueKey, teams, weeks: weeksArr, points, outcome, oppPoints, oppName };
    matrixCache.set(cacheKey, { until: Date.now() + 60_000, payload });
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/category-stats", async (req, res) => {
  try {
    const year = Number(req.query.year || DEFAULT_YEAR);
    const leagueKey = leagueKeyForYear(year);
    const from = Math.max(1, Number(req.query.min || 1));
    const to = Math.max(from, Number(req.query.max || 40));

    const teamDir = await getTeamDirectory(leagueKey);
    const weeks = await fetchScoreboardWeeks(leagueKey, { from, to });
    if (!weeks.length)
      return res.status(404).json({ error: "no data" });

    const categories = await getStatCategories(leagueKey);
    const categoryIds = new Set(categories.map((c) => c.id));

    const totalsByTeam = new Map();
    const outcomesByTeam = new Map();
    const teamNames = new Map();

    for (const wk of weeks) {
      for (const matchup of wk.matchups) {
        const keys = extractTwoTeamKeysFromMatchup(matchup);
        if (!keys[0] || !keys[1]) continue;
        const summary = winsFromStatWinners(matchup, keys[0], keys[1]);
        if (!summary || summary.total === 0) continue;

        for (const key of keys) {
          const node = findTeamNode(matchup, key);
          if (!node) continue;
          const statsNodes = extractTeamStatNodes(node);
          const totalsMap = ensureNestedMap(totalsByTeam, key);
          let name = teamDir.get(key);
          if (!name) {
            name = pickTeamName(node) || key;
            if (name) teamDir.set(key, name);
          }
          teamNames.set(key, name || key);
          for (const statNode of statsNodes) {
            const statId = findYahooValue(statNode, "stat_id");
            if (!statId) continue;
            categoryIds.add(statId);
            const rawValue =
              findYahooValue(statNode, "value") ??
              findYahooValue(statNode, "stat_value") ??
              0;
            const value = parseStatValue(rawValue);
            totalsMap.set(statId, (totalsMap.get(statId) || 0) + value);
          }
        }

        const detailed = extractStatWinnersDetailed(matchup);
        for (const item of detailed) {
          const statId = item.statId;
          if (!statId) continue;
          categoryIds.add(statId);
          if (item.isTied || !item.winnerKey) {
            for (const key of keys) {
              const rec = ensureOutcomeRecord(outcomesByTeam, key, statId);
              rec.ties += 1;
            }
            continue;
          }
          const winner = keys.find((k) => k === item.winnerKey);
          if (!winner) {
            for (const key of keys) {
              const rec = ensureOutcomeRecord(outcomesByTeam, key, statId);
              rec.ties += 1;
            }
            continue;
          }
          const loser = keys.find((k) => k !== winner) || null;
          const winRec = ensureOutcomeRecord(outcomesByTeam, winner, statId);
          winRec.wins += 1;
          if (loser) {
            const loseRec = ensureOutcomeRecord(outcomesByTeam, loser, statId);
            loseRec.losses += 1;
          }
        }
      }
    }

    const allCategoryIds = [...categoryIds];
    const knownCategories = new Map(categories.map((c) => [c.id, c]));
    for (const id of allCategoryIds) {
      if (!knownCategories.has(id)) {
        knownCategories.set(id, {
          id,
          name: id,
          display_name: id,
          sort_order: null,
          decimal_places: null,
          position_type: null,
          is_only_display: false,
        });
      }
    }
    const orderedCategories = [...knownCategories.values()].sort((a, b) => {
      const aOrder = a.sort_order ?? Number(a.id) ?? 0;
      const bOrder = b.sort_order ?? Number(b.id) ?? 0;
      return aOrder - bOrder;
    });

    const allTeamKeys = new Set([
      ...totalsByTeam.keys(),
      ...outcomesByTeam.keys(),
    ]);
    if (!allTeamKeys.size)
      return res.status(404).json({ error: "no data" });

    const teams = [...allTeamKeys].map((teamKey) => {
      const totalsMap = totalsByTeam.get(teamKey) || new Map();
      const outcomesMap = outcomesByTeam.get(teamKey) || new Map();
      const totals = {};
      const outcomes = {};
      for (const cat of orderedCategories) {
        const statId = cat.id;
        totals[statId] = totalsMap.get(statId) ?? 0;
        const rec = outcomesMap.get(statId) || { wins: 0, losses: 0, ties: 0 };
        const played = rec.wins + rec.losses + rec.ties;
        const winPct = played
          ? (rec.wins + rec.ties * 0.5) / played
          : null;
        outcomes[statId] = {
          wins: rec.wins,
          losses: rec.losses,
          ties: rec.ties,
          winPct,
          played,
        };
      }
      return {
        key: teamKey,
        name: teamDir.get(teamKey) || teamNames.get(teamKey) || teamKey,
        totals,
        outcomes,
      };
    });

    const payload = {
      season_year: year,
      league_key: leagueKey,
      categories: orderedCategories,
      teams,
      generated_at: new Date().toISOString(),
      from_week: from,
      to_week: to,
    };
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/season-analytics", async (req, res) => {
  try {
    const year = Number(req.query.year || DEFAULT_YEAR);
    const leagueKey = leagueKeyForYear(year);
    const from = Math.max(1, Number(req.query.min || 1));
    const to = Math.max(from, Number(req.query.max || 40));

    const stats = await collectSeasonStats(leagueKey, { from, to });
    const standings = await getTeamStandingsSummary(leagueKey);

    const {
      teamDir,
      categories,
      totalsByTeam,
      outcomesByTeam,
      marginsByTeam,
      totalsByCategory,
      winEquivalentsByCategory,
    } = stats;

    const teamKeys = [...new Set([
      ...totalsByTeam.keys(),
      ...outcomesByTeam.keys(),
      ...marginsByTeam.keys(),
    ])];

    const sharpe = teamKeys.map((teamKey) => {
      const marginMap = marginsByTeam.get(teamKey) || new Map();
      const teamName = teamDir.get(teamKey) || teamKey;
      const categoriesData = categories
        .map((cat) => {
          const values = marginMap.get(cat.id) || [];
          if (!values.length) return null;
          const mean = calculateMean(values);
          const stdDev = calculateStdDev(values, mean);
          const sharpeValue = stdDev ? mean / stdDev : null;
          return {
            statId: cat.id,
            label: cat.display_name,
            mean,
            stdDev,
            sharpe: sharpeValue,
            samples: values.length,
          };
        })
        .filter(Boolean);
      return {
        teamKey,
        teamName,
        categories: categoriesData,
      };
    });

    const ebitda = teamKeys.map((teamKey) => {
      const totalsMap = totalsByTeam.get(teamKey) || new Map();
      const outcomesMap = outcomesByTeam.get(teamKey) || new Map();
      const teamName = teamDir.get(teamKey) || teamKey;
      let totalDelta = 0;
      const categoriesData = categories.map((cat) => {
        const volume = totalsMap.get(cat.id) ?? 0;
        const rec = outcomesMap.get(cat.id) || { wins: 0, losses: 0, ties: 0 };
        const actual = rec.wins + rec.ties * 0.5;
        const totalVolume = totalsByCategory.get(cat.id) || 0;
        const totalWins = winEquivalentsByCategory.get(cat.id) || 0;
        const expected = totalVolume > 0 ? (volume / totalVolume) * totalWins : 0;
        const delta = actual - expected;
        totalDelta += delta;
        return {
          statId: cat.id,
          label: cat.display_name,
          actual,
          expected,
          delta,
        };
      });
      return {
        teamKey,
        teamName,
        totalDelta,
        categories: categoriesData,
      };
    });

    const contributionTree = teamKeys.map((teamKey) => {
      const outcomesMap = outcomesByTeam.get(teamKey) || new Map();
      const teamName = teamDir.get(teamKey) || teamKey;
      let total = 0;
      const categoriesData = categories.map((cat) => {
        const rec = outcomesMap.get(cat.id) || { wins: 0, losses: 0, ties: 0 };
        const value = rec.wins + rec.ties * 0.5;
        total += value;
        return {
          statId: cat.id,
          label: cat.display_name,
          value,
        };
      });
      return {
        teamKey,
        teamName,
        total,
        categories: categoriesData,
      };
    });

    const rosterMoves = [...standings.entries()].map(([teamKey, summary]) => {
      const name = teamDir.get(teamKey) || teamKey;
      const wins = summary.wins || 0;
      const losses = summary.losses || 0;
      const ties = summary.ties || 0;
      const totalGames = wins + losses + ties;
      const winPct = summary.winPct != null
        ? summary.winPct
        : totalGames > 0
        ? (wins + ties * 0.5) / totalGames
        : null;
      return {
        teamKey,
        teamName: name,
        moves: summary.moves || 0,
        trades: summary.trades || 0,
        wins,
        losses,
        ties,
        winPct,
      };
    });

    res.json({
      season_year: year,
      league_key: leagueKey,
      from,
      to,
      sharpe,
      ebitda,
      contributionTree,
      rosterMoves,
    });
  } catch (e) {
    if (String(e).includes("no data")) {
      return res.status(404).json({ error: "no data" });
    }
    res.status(500).json({ error: String(e) });
  }
});

/* =========================
   Start
   ========================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server on ${PORT}`));
