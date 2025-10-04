import { useEffect, useMemo, useRef, useState } from "react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip as RadarTooltip,
  Legend,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  Cell,
  Treemap,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type LegendEntry = {
  value: string;
  color: string;
};

const RadarLegendContent = ({ payload }: { payload?: LegendEntry[] }) => {
  if (!payload?.length) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
      {payload.map((entry) => (
        <div key={entry.value} className="flex items-center gap-2">
          <span
            className="inline-flex h-2.5 w-2.5 items-center justify-center rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="font-medium text-foreground/80">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

type WeeklyMatrixResponse = {
  season_year: number;
  league_key: string;
  teams: string[];
  weeks: number[];
  points: (number | null)[][];
  outcome: (string | null)[][];
  oppPoints: (number | null)[][];
  oppName: (string | null)[][];
};

type CategoryStatsResponse = {
  season_year: number;
  league_key: string;
  categories: {
    id: string;
    name: string;
    display_name: string;
    sort_order: number | null;
    decimal_places: number | null;
  }[];
  teams: {
    key: string;
    name: string;
    totals: Record<string, number>;
    outcomes: Record<
      string,
      {
        wins: number;
        losses: number;
        ties: number;
        winPct: number | null;
        played: number;
      }
    >;
  }[];
};

type StandingsEntry = {
  team: string;
  rank: number;
  points: number;
  wins: number;
  losses: number;
  ties: number;
  teamIndex: number;
};

type StandingsFrame = {
  week: number;
  entries: StandingsEntry[];
  byTeam: Map<string, StandingsEntry>;
};

type StandingsDisplayRow = {
  team: string;
  color: string;
  rankExact: number;
  rank: number;
  points: number;
  wins: number;
  losses: number;
  ties: number;
  record: string;
};

type HoverState = {
  x: number;
  y: number;
  team: string;
  week: string;
  value: number | null;
  result: string;
  oppName: string;
  oppValue: number | null;
};

type RadarDatum = {
  id: string;
  label: string;
  total: number;
  totalScaled: number;
  winPct: number;
  wins: number;
  losses: number;
  ties: number;
};

type RadarTeamDataset = {
  key: string;
  name: string;
  record: string;
  data: RadarDatum[];
};

type SharpeEntry = {
  teamKey: string;
  teamName: string;
  categories: {
    statId: string;
    label: string;
    mean: number;
    stdDev: number;
    sharpe: number | null;
    samples: number;
  }[];
};

type EbitdaEntry = {
  teamKey: string;
  teamName: string;
  totalDelta: number;
  categories: {
    statId: string;
    label: string;
    actual: number;
    expected: number;
    delta: number;
  }[];
};

type ContributionEntry = {
  teamKey: string;
  teamName: string;
  total: number;
  categories: {
    statId: string;
    label: string;
    value: number;
  }[];
};

type RosterMovesEntry = {
  teamKey: string;
  teamName: string;
  moves: number;
  trades: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number | null;
};

type SeasonAnalyticsResponse = {
  season_year: number;
  league_key: string;
  from: number;
  to: number;
  sharpe: SharpeEntry[];
  ebitda: EbitdaEntry[];
  contributionTree: ContributionEntry[];
  rosterMoves: RosterMovesEntry[];
};

type YahooStandingsResponse = {
  fantasy_content?: {
    league?: [unknown, {
      standings?: [unknown, {
        teams?: unknown;
      }];
    }?];
  };
};

function normalizeTeamsContainer(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") {
    return Object.keys(raw)
      .filter((key) => key !== "count")
      .map((key) => raw[key]?.team || raw[key])
      .filter(Boolean);
  }
  return [];
}

function deepFindFirstValue(node: any, key: string): any {
  const seen = new Set<any>();
  const walk = (value: any): any => {
    if (!value || typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = walk(item);
        if (result != null) return result;
      }
    } else {
      for (const childKey of Object.keys(value)) {
        const result = walk(value[childKey]);
        if (result != null) return result;
      }
    }
    return null;
  };
  return walk(node);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function hslToRgb(h: number, s: number, l: number) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s / 100);
  const lig = clamp01(l / 100);
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

const NEGATIVE_HSL = { h: 356, s: 86, l: 63 };
const POSITIVE_HSL = { h: 161, s: 56, l: 36 };
const NEGATIVE_RGB = hslToRgb(NEGATIVE_HSL.h, NEGATIVE_HSL.s, NEGATIVE_HSL.l);
const POSITIVE_RGB = hslToRgb(POSITIVE_HSL.h, POSITIVE_HSL.s, POSITIVE_HSL.l);
const NEGATIVE_SOLID = `rgb(${NEGATIVE_RGB.r},${NEGATIVE_RGB.g},${NEGATIVE_RGB.b})`;
const POSITIVE_SOLID = `rgb(${POSITIVE_RGB.r},${POSITIVE_RGB.g},${POSITIVE_RGB.b})`;
const FALLBACK_TILE = "rgba(26,35,48,0.6)";

const SCATTER_COLORS = [
  "#f97316",
  "#2563eb",
  "#22c55e",
  "#facc15",
  "#ec4899",
  "#8b5cf6",
  "#0ea5e9",
  "#ef4444",
  "#84cc16",
  "#a855f7",
  "#14b8a6",
  "#fb7185",
];

const TREEMAP_NEGATIVE_RGB = { r: 239, g: 68, b: 68 };
const TREEMAP_POSITIVE_RGB = { r: 34, g: 197, b: 94 };
const TREEMAP_FALLBACK = "rgba(26,35,48,0)";

const STANDINGS_BAR_HEIGHT = 48;
const STANDINGS_BAR_GAP = 10;
const STANDINGS_STEP_MS = 900;
const STANDINGS_INITIAL_STEP_MS = 300;
const STANDINGS_TRANSITION_MS = STANDINGS_STEP_MS;
const STANDINGS_NUMBERS_WIDTH = 48;

function contributionFill(delta: number | null, min: number, max: number) {
  if (delta == null || Number.isNaN(delta)) return TREEMAP_FALLBACK;
  const positiveMax = Math.max(max, 0.0001);
  const negativeMin = Math.min(min, -0.0001);
  if (delta >= 0) {
    const scale = clamp01(delta / positiveMax);
    const alpha = 0.25 + scale * 0.75;
    return `rgba(${TREEMAP_POSITIVE_RGB.r},${TREEMAP_POSITIVE_RGB.g},${TREEMAP_POSITIVE_RGB.b},${alpha.toFixed(3)})`;
  }
  const scale = clamp01(Math.abs(delta / negativeMin));
  const alpha = 0.25 + scale * 0.75;
  return `rgba(${TREEMAP_NEGATIVE_RGB.r},${TREEMAP_NEGATIVE_RGB.g},${TREEMAP_NEGATIVE_RGB.b},${alpha.toFixed(3)})`;
}

function colorForValue(value: number | null, min: number, max: number) {
  if (value == null || Number.isNaN(value)) return FALLBACK_TILE;
  const range = Math.max(1e-6, max - min);
  const t = clamp01((value - min) / range);
  if (t <= 0.5) {
    const alpha = 1 - (t / 0.5) * 0.9; // 1 -> 0.1 across negative half
    return `rgba(${NEGATIVE_RGB.r},${NEGATIVE_RGB.g},${NEGATIVE_RGB.b},${alpha.toFixed(3)})`;
  }
  const p = (t - 0.5) / 0.5;
  const alpha = 0.1 + p * 0.9; // 0.1 -> 1 across positive half
  return `rgba(${POSITIVE_RGB.r},${POSITIVE_RGB.g},${POSITIVE_RGB.b},${alpha.toFixed(3)})`;
}

function textColorForValue(_value: number | null, _min: number, _max: number) {
  return "#ffffff";
}


function formatResult(value: number | null, result: string) {
  if (value == null) return "–" + (result ? ` ${result}` : "");
  return `${value}${result ? ` ${result}` : ""}`;
}

function formatDiff(a: number | null, b: number | null) {
  if (a == null || b == null) return "";
  const diff = a - b;
  if (Number.isNaN(diff)) return "";
  if (diff > 0) return `Outscored opponent by ${diff}`;
  if (diff < 0) return `Trailed opponent by ${Math.abs(diff)}`;
  return "Tied in categories";
}

function useHeatmapData(matrix: WeeklyMatrixResponse | null) {
  return useMemo(() => {
    if (!matrix) return null;
    const { teams, weeks, points, outcome, oppName, oppPoints } = matrix;
    const MAX_WEEKS = 21;
    const weekCount = Math.min(weeks.length, MAX_WEEKS);
    const trimmedWeeks = weeks.slice(0, weekCount);
    const trim = <T,>(grid: T[][]) => grid.map((row) => row.slice(0, weekCount));
    const trimMaybe = <T,>(grid: (T | null)[][] | undefined) =>
      grid ? grid.map((row) => row.slice(0, weekCount)) : [];
    const pointsTrimmed = trim(points);
    const outcomeTrimmed = outcome ? trimMaybe(outcome) : [];
    const oppNameTrimmed = oppName ? trimMaybe(oppName) : [];
    const oppPointsTrimmed = oppPoints ? trimMaybe(oppPoints) : [];

    let min = Infinity;
    let max = -Infinity;
    for (const row of pointsTrimmed) {
      for (const v of row) {
        if (v == null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }

    return {
      teams,
      weeks: trimmedWeeks,
      points: pointsTrimmed,
      outcome: outcomeTrimmed,
      oppName: oppNameTrimmed,
      oppPoints: oppPointsTrimmed,
      min,
      max,
    };
  }, [matrix]);
}

function computeRadarDatasets(stats: CategoryStatsResponse | null) {
  return useMemo(() => {
    if (!stats) return null;
    const rawCategories = stats.categories || [];
    const categories = rawCategories.filter((category) => {
      const label = (category.display_name || category.name || category.id || "").toUpperCase();
      return label !== "SA";
    });
    const { teams } = stats;
    const maxByCategory: Record<string, number> = {};
    for (const team of teams) {
      for (const category of categories) {
        const value = team.totals[category.id] ?? 0;
        if (!Number.isFinite(value)) continue;
        if (!maxByCategory[category.id] || value > maxByCategory[category.id]) {
          maxByCategory[category.id] = value;
        }
      }
    }

    const datasets: RadarTeamDataset[] = teams.map((team) => {
      let totalWins = 0;
      let totalLosses = 0;
      let totalTies = 0;
      const data: RadarDatum[] = categories.map((category) => {
        const total = team.totals[category.id] ?? 0;
        const outcome = team.outcomes[category.id] || {
          wins: 0,
          losses: 0,
          ties: 0,
          winPct: null,
        };
        totalWins += outcome.wins;
        totalLosses += outcome.losses;
        totalTies += outcome.ties;
        const max = maxByCategory[category.id] || 1;
        return {
          id: category.id,
          label: category.display_name,
          total,
          totalScaled: max ? total / max : 0,
          winPct: outcome.winPct ?? 0,
          wins: outcome.wins,
          losses: outcome.losses,
          ties: outcome.ties,
        };
      });

      const record = `${totalWins}-${totalLosses}${totalTies ? `-${totalTies}` : ""}`;
      return {
        key: team.key,
        name: team.name,
        record,
        data,
      };
    });

    return {
      categories,
      datasets,
    };
  }, [stats]);
}

export default function App() {
  const [heatmap, setHeatmap] = useState<WeeklyMatrixResponse | null>(null);
  const [heatmapError, setHeatmapError] = useState<string | null>(null);
  const [radarStats, setRadarStats] = useState<CategoryStatsResponse | null>(null);
  const [radarError, setRadarError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<SeasonAnalyticsResponse | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [selectedContributionTeam, setSelectedContributionTeam] = useState<string | null>(null);
  const [standingsProgress, setStandingsProgress] = useState(0);
  const [standingsPlaying, setStandingsPlaying] = useState(false);
  const [fallbackRosterMoves, setFallbackRosterMoves] = useState<RosterMovesEntry[] | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchHeatmap = async () => {
      try {
        const res = await fetch("/api/weekly-matrix");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || res.statusText);
        if (!cancelled) setHeatmap(json);
      } catch (err) {
        if (!cancelled) setHeatmapError(err instanceof Error ? err.message : String(err));
      }
    };

    const fetchRadar = async () => {
      try {
        const res = await fetch("/api/category-stats");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || res.statusText);
        if (!cancelled) setRadarStats(json);
      } catch (err) {
        if (!cancelled) setRadarError(err instanceof Error ? err.message : String(err));
      }
    };

    const fetchAnalytics = async () => {
      try {
        const res = await fetch("/api/season-analytics");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || res.statusText);
        if (!cancelled) setAnalytics(json);
      } catch (err) {
        if (!cancelled) setAnalyticsError(err instanceof Error ? err.message : String(err));
      }
    };

    fetchHeatmap();
    fetchRadar();
    fetchAnalytics();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (analytics?.rosterMoves?.length) {
      setFallbackRosterMoves(null);
      return;
    }
    let cancelled = false;
    const loadStandingsFallback = async () => {
      try {
        const res = await fetch("/api/standings");
        const json: YahooStandingsResponse = await res.json();
        if (!res.ok) throw new Error("standings fetch failed");
        const teamsRaw = json.fantasy_content?.league?.[1]?.standings?.[0]?.teams;
        const teams = normalizeTeamsContainer(teamsRaw);
        const entries: RosterMovesEntry[] = teams.map((item: any) => {
          const teamNode = item?.team || item;
          const teamKey = deepFindFirstValue(teamNode, "team_key")?.toString() ?? "";
          const teamName = deepFindFirstValue(teamNode, "name")?.toString() ?? teamKey;
          const moves = Number(deepFindFirstValue(teamNode, "number_of_moves")) || 0;
          const trades = Number(deepFindFirstValue(teamNode, "number_of_trades")) || 0;
          const outcome = deepFindFirstValue(teamNode, "outcome_totals");
          const wins = Number(outcome?.wins) || 0;
          const losses = Number(outcome?.losses) || 0;
          const ties = Number(outcome?.ties) || 0;
          const pctRaw = outcome?.percentage;
          const winPct = pctRaw != null ? Number(pctRaw) || 0 : (wins + ties * 0.5) / Math.max(1, wins + losses + ties);
          return { teamKey, teamName, moves, trades, wins, losses, ties, winPct };
        }).filter((entry) => entry.teamKey);
        if (!cancelled) setFallbackRosterMoves(entries);
      } catch {
        if (!cancelled) setFallbackRosterMoves([]);
      }
    };
    loadStandingsFallback();
    return () => {
      cancelled = true;
    };
  }, [analytics]);

  const heatmapData = useHeatmapData(heatmap);
  const radarData = computeRadarDatasets(radarStats);
  const standingsData = useMemo(() => {
    if (!heatmapData) {
      return {
        frames: [] as StandingsFrame[],
        order: [] as string[],
        maxPoints: 0,
      };
    }
    const { teams, weeks, outcome } = heatmapData;
    const teamCount = teams.length;
    if (!teamCount || !weeks.length) {
      return {
        frames: [] as StandingsFrame[],
        order: teams.slice(),
        maxPoints: 0,
      };
    }

    const wins = Array(teamCount).fill(0);
    const losses = Array(teamCount).fill(0);
    const ties = Array(teamCount).fill(0);
    const frames: StandingsFrame[] = [];
    let maxPoints = 0;

    weeks.forEach((week, weekIdx) => {
      for (let idx = 0; idx < teamCount; idx += 1) {
        const result = outcome?.[idx]?.[weekIdx];
        if (result === "W") wins[idx] += 1;
        else if (result === "L") losses[idx] += 1;
        else if (result === "T" || result === "D") ties[idx] += 1;
      }

      const ranked = teams
        .map((team, idx) => {
          const points = wins[idx] * 2 + ties[idx];
          maxPoints = Math.max(maxPoints, points);
          return {
            team,
            points,
            wins: wins[idx],
            losses: losses[idx],
            ties: ties[idx],
            teamIndex: idx,
            rank: 0,
          } as StandingsEntry;
        })
        .sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (a.losses !== b.losses) return a.losses - b.losses;
          return a.team.localeCompare(b.team);
        })
        .map((entry, orderIdx) => ({ ...entry, rank: orderIdx + 1 }));

      const byTeam = new Map<string, StandingsEntry>();
      ranked.forEach((entry) => byTeam.set(entry.team, entry));
      frames.push({ week, entries: ranked, byTeam });
    });

    return {
      frames,
      order: teams.slice(),
      maxPoints,
    };
  }, [heatmapData]);

  const frameCount = standingsData.frames.length;
  const finalFrameIndex = frameCount ? frameCount - 1 : 0;
  const clampedProgress = frameCount
    ? Math.min(Math.max(Math.round(standingsProgress), 0), finalFrameIndex)
    : 0;
  const currentFrame = standingsData.frames[clampedProgress];

  useEffect(() => {
    if (!frameCount) return;
    setStandingsProgress(finalFrameIndex);
  }, [frameCount, finalFrameIndex]);

  useEffect(() => {
    if (!standingsPlaying || !frameCount) return;

    let rafId: number;
    let previous: number | null = null;
    let accumulator = 0;
    let stepsTaken = 0;

    const tick = (timestamp: number) => {
      if (previous == null) {
        previous = timestamp;
      }
      const delta = timestamp - previous;
      previous = timestamp;
      const stepDuration = stepsTaken === 0 ? STANDINGS_INITIAL_STEP_MS : STANDINGS_STEP_MS;
      accumulator += delta;

      if (accumulator >= stepDuration) {
        accumulator -= stepDuration;
        stepsTaken += 1;
        let reachedEnd = false;
        setStandingsProgress((prev) => {
          const next = Math.min(prev + 1, finalFrameIndex);
          if (next >= finalFrameIndex) reachedEnd = true;
          return next;
        });
        if (reachedEnd) {
          setStandingsPlaying(false);
          return;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [standingsPlaying, frameCount, finalFrameIndex]);

  const teamColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (heatmapData?.teams) {
      heatmapData.teams.forEach((team, idx) => {
        map.set(team, SCATTER_COLORS[idx % SCATTER_COLORS.length]);
      });
    }
    return map;
  }, [heatmapData]);

  const standingsRows = useMemo(() => {
    if (!currentFrame) return [] as StandingsDisplayRow[];
    const byTeam = currentFrame.byTeam;
    return standingsData.order.map((team, idx) => {
      const entry = byTeam.get(team);
      if (!entry) {
        return {
          team,
          color: SCATTER_COLORS[idx % SCATTER_COLORS.length],
          rankExact: idx + 1,
          rank: idx + 1,
          points: 0,
          wins: 0,
          losses: 0,
          ties: 0,
          record: "0-0",
        } as StandingsDisplayRow;
      }
      const color =
        teamColorMap.get(team) ??
        SCATTER_COLORS[entry.teamIndex % SCATTER_COLORS.length] ??
        SCATTER_COLORS[idx % SCATTER_COLORS.length];
      const record = entry.ties > 0 ? `${entry.wins}-${entry.losses}-${entry.ties}` : `${entry.wins}-${entry.losses}`;
      return {
        team,
        color,
        rankExact: entry.rank,
        rank: entry.rank,
        points: entry.points,
        wins: entry.wins,
        losses: entry.losses,
        ties: entry.ties,
        record,
      } as StandingsDisplayRow;
    });
  }, [currentFrame, standingsData.order, teamColorMap]);

  const standingsRanks = currentFrame?.entries ?? [];

  const standingsTrackHeight = standingsRows.length
    ? standingsRows.length * (STANDINGS_BAR_HEIGHT + STANDINGS_BAR_GAP) - STANDINGS_BAR_GAP
    : 0;

  const currentWeekNumber = currentFrame?.week ?? 0;
  const isFinalWeek = frameCount ? clampedProgress >= finalFrameIndex : true;

  const sharpeHighlights = useMemo(() => {
    if (!analytics?.sharpe) return [];
    const combos: {
      teamKey: string;
      teamName: string;
      statId: string;
      label: string;
      sharpe: number;
    }[] = [];
    for (const entry of analytics.sharpe) {
      for (const cat of entry.categories) {
        if (cat.sharpe != null && cat.samples >= 2) {
          combos.push({
            teamKey: entry.teamKey,
            teamName: entry.teamName,
            statId: cat.statId,
            label: cat.label,
            sharpe: cat.sharpe,
          });
        }
      }
    }
    return combos
      .sort((a, b) => Math.abs(b.sharpe) - Math.abs(a.sharpe))
      .slice(0, 10);
  }, [analytics]);

  const sharpeRange = useMemo(() => {
    if (!sharpeHighlights.length) return { min: -1, max: 1 };
    const values = sharpeHighlights.map((entry) => entry.sharpe ?? 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return { min: min - 1, max: max + 1 };
    return { min, max };
  }, [sharpeHighlights]);

  const ebitdaTotals = useMemo(() => {
    if (!analytics?.ebitda) return [];
    return analytics.ebitda
      .map((entry) => ({
        teamKey: entry.teamKey,
        teamName: entry.teamName,
        total: entry.totalDelta,
      }))
      .sort((a, b) => b.total - a.total);
  }, [analytics]);

  const ebitdaRange = useMemo(() => {
    if (!ebitdaTotals.length) return { min: -1, max: 1 };
    const values = ebitdaTotals.map((entry) => entry.total);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return { min: min - 1, max: max + 1 };
    return { min, max };
  }, [ebitdaTotals]);

  const contributionTeams = useMemo(() => analytics?.contributionTree ?? [], [analytics]);

  const contributionStats = useMemo(() => {
    const values: number[] = [];
    for (const team of contributionTeams) {
      for (const cat of team.categories) {
        if (cat.value == null || Number.isNaN(cat.value)) continue;
        values.push(cat.value);
      }
    }
    if (!values.length) return { mean: 0, min: -1, max: 1 };
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    let minDelta = 0;
    let maxDelta = 0;
    for (const value of values) {
      const delta = value - mean;
      if (delta < minDelta) minDelta = delta;
      if (delta > maxDelta) maxDelta = delta;
    }
    if (minDelta === maxDelta) {
      if (maxDelta <= 0) {
        maxDelta = 1;
      } else {
        minDelta = -maxDelta;
      }
    }
    return { mean, min: minDelta, max: maxDelta };
  }, [contributionTeams]);

  const contributionByTeam = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        categories: { name: string; size: number; value: number; delta: number; fill: string }[];
      }
    >();
    const { mean, min, max } = contributionStats;
    for (const team of contributionTeams) {
      map.set(team.teamKey, {
        name: team.teamName,
        categories: team.categories.map((cat) => {
          const value = cat.value ?? 0;
          const magnitude = Math.max(Math.abs(value), 0.0001);
          const delta = value - mean;
          return {
            name: cat.label,
            size: magnitude,
            value,
            delta,
            fill: contributionFill(delta, min, max),
          };
        }),
      });
    }
    return map;
  }, [contributionTeams, contributionStats.mean, contributionStats.min, contributionStats.max]);

  const selectedContribution = useMemo(() => {
    if (!selectedContributionTeam) return null;
    return contributionByTeam.get(selectedContributionTeam) || null;
  }, [contributionByTeam, selectedContributionTeam]);

  useEffect(() => {
    if (!analytics?.contributionTree?.length) return;
    if (selectedContributionTeam && contributionByTeam.has(selectedContributionTeam)) return;
    const firstKey = analytics.contributionTree[0]?.teamKey;
    if (firstKey) setSelectedContributionTeam(firstKey);
  }, [analytics, contributionByTeam, selectedContributionTeam]);

  const rosterMovesData = useMemo(() => {
    if (analytics?.rosterMoves && analytics.rosterMoves.length) {
      return analytics.rosterMoves.map((entry) => ({
        teamKey: entry.teamKey,
        teamName: entry.teamName,
        moves: entry.moves,
        winPct: entry.winPct ?? 0,
      }));
    }
    const fallback = fallbackRosterMoves ?? [];
    return fallback.map((entry) => ({
      teamKey: entry.teamKey,
      teamName: entry.teamName,
      moves: entry.moves,
      winPct: entry.winPct ?? 0,
    }));
  }, [analytics?.rosterMoves, fallbackRosterMoves]);

  useEffect(() => {
    if (!hover || !tooltipRef.current) return;
    const el = tooltipRef.current;
    const OFFSET_X = 12;
    const OFFSET_Y = 16;
    let left = hover.x + OFFSET_X;
    let top = hover.y + OFFSET_Y;
    const rect = el.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - 12) {
      left = Math.max(12, hover.x - rect.width - OFFSET_X);
    }
    if (top + rect.height > window.innerHeight - 12) {
      top = Math.max(12, hover.y - rect.height - OFFSET_Y);
    }
    if (left < 12) left = 12;
    if (top < 12) top = 12;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [hover]);

  return (
    <div className="min-h-screen bg-background pb-24 text-foreground">
      <div className="mx-auto w-full max-w-7xl px-4 pb-10 pt-12 sm:px-6 lg:px-10">
        <header className="mb-10">
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            HRHL Season Analysis 24/25
          </h1>
        </header>

        <div className="space-y-10">
          {standingsRows.length ? (
            <section className="space-y-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Season Standings Trajectory</h2>
                <p className="text-sm text-muted-foreground">
                  Final standings appear by default. Press play to replay the season (win = 2 pts, draw = 1 pt).
                </p>
              </div>
              <Card>
                <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <button
                      onClick={() => {
                        if (!frameCount) return;
                        if (standingsPlaying) {
                          setStandingsPlaying(false);
                          return;
                        }
                        setStandingsProgress(0);
                        setStandingsPlaying(true);
                      }}
                      className="rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:border-foreground/40"
                    >
                      {standingsPlaying ? "Pause" : "Play"}
                    </button>
                    <span>Week {currentWeekNumber}</span>
                  </div>
                  <div className="flex-1 sm:flex sm:justify-end">
                    <input
                      type="range"
                      min={0}
                      max={Math.max(finalFrameIndex, 0)}
                      step={1}
                      value={clampedProgress}
                      onChange={(evt) => {
                        setStandingsPlaying(false);
                        setStandingsProgress(Number(evt.target.value));
                      }}
                      className="w-full sm:w-72"
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                        <span>{isFinalWeek ? "Final standings" : `After week ${currentWeekNumber}`}</span>
                      </div>
                      <span className="text-xs uppercase tracking-widest">Points = 2W + 1D</span>
                    </div>
                    <div className="relative overflow-hidden rounded-2xl border border-border bg-card/40">
                      <div
                        className="absolute left-4 top-4 flex flex-col text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground/70"
                        style={{ width: STANDINGS_NUMBERS_WIDTH, gap: STANDINGS_BAR_GAP }}
                      >
                        {standingsRanks.map((row, idx) => (
                          <div
                            key={`rank-${row.team}`}
                            className="flex items-center justify-end pr-1"
                            style={{
                              height: STANDINGS_BAR_HEIGHT,
                              marginBottom: idx === standingsRanks.length - 1 ? 0 : STANDINGS_BAR_GAP,
                            }}
                          >
                            {row.rank.toString().padStart(2, "0")}
                          </div>
                        ))}
                      </div>
                      <div
                        className="relative p-4"
                        style={{ paddingLeft: STANDINGS_NUMBERS_WIDTH + 24 }}
                      >
                        <div
                          className="relative"
                          style={{ height: `${Math.max(standingsTrackHeight, 0)}px` }}
                        >
                          {standingsRows.map((row) => {
                            const top = (row.rankExact - 1) * (STANDINGS_BAR_HEIGHT + STANDINGS_BAR_GAP);
                            const widthPct = standingsData.maxPoints
                              ? Math.max(0, (row.points / standingsData.maxPoints) * 100)
                              : 0;
                            return (
                              <div
                                key={row.team}
                                className="absolute left-0 right-0"
                                style={{
                                  top: `${top}px`,
                                  transition: `top ${STANDINGS_TRANSITION_MS}ms ease`,
                                }}
                              >
                                <div
                                className="relative flex w-full items-center overflow-hidden rounded-xl border border-border bg-[#101010]"
                                style={{ height: STANDINGS_BAR_HEIGHT }}
                              >
                                  <div
                                    className="absolute inset-y-0 left-0 rounded-r-xl opacity-80"
                                    style={{
                                      width: `${widthPct}%`,
                                      backgroundColor: row.color,
                                      transition: `width ${STANDINGS_TRANSITION_MS}ms linear`,
                                    }}
                                  />
                                  <div className="relative flex w-full items-center justify-between gap-4 px-4 py-3">
                                    <div>
                                      <div className="text-base font-semibold text-foreground">{row.team}</div>
                                      <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                                        Record {row.record}
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-xl font-bold text-foreground">{Math.round(row.points)}</div>
                                      <div className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground">PTS</div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>
          ) : null}

          <section className="space-y-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Weekly Category Wins</h2>
              <p className="text-sm text-muted-foreground">
                Compare each team’s cumulative production (filled radar) against category win percentage (outline).
              </p>
            </div>
            {!heatmapData && !heatmapError && (
              <div className="h-48 animate-pulse rounded-xl bg-accent/40" />
            )}
            {heatmapError && (
              <p className="text-sm text-red-400">{heatmapError}</p>
            )}
            {heatmapData && (
              <div className="relative">
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="min-w-full border-collapse">
                    <thead>
                      <tr className="bg-[#131313] text-sm uppercase tracking-wide text-muted-foreground">
                        <th className="sticky left-0 top-0 z-20 border-b border-border bg-[#131313] px-4 py-3 text-left font-semibold">
                          Team
                        </th>
                        {heatmapData.weeks.map((week) => (
                          <th
                            key={week}
                            className="sticky top-0 z-10 border-b border-border bg-[#131313] px-3 py-3 text-center font-semibold"
                          >
                            W{week}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heatmapData.teams.map((team, rowIdx) => (
                        <tr key={team} className="text-sm">
                          <th className="sticky left-0 z-10 border-r border-border bg-[#131313] px-4 py-3 text-left font-medium text-foreground">
                            {team}
                          </th>
                          {heatmapData.weeks.map((week, colIdx) => {
                            const value = heatmapData.points[rowIdx]?.[colIdx] ?? null;
                            const result = heatmapData.outcome[rowIdx]?.[colIdx] ?? "";
                            const opp = heatmapData.oppName[rowIdx]?.[colIdx] ?? "";
                            const oppVal = heatmapData.oppPoints[rowIdx]?.[colIdx] ?? null;
                            const safResult = result === "T" ? "D" : result;
                            const label = formatResult(value, safResult ?? "");
                            const bg = colorForValue(value, heatmapData.min, heatmapData.max);
                            const fg = textColorForValue(value, heatmapData.min, heatmapData.max);
                            return (
                              <td
                                key={`${team}-${week}`}
                                tabIndex={0}
                                className="min-w-[72px] cursor-pointer px-3 py-3 text-center align-middle font-medium outline-none transition"
                                style={{ background: bg, color: fg }}
                                onMouseEnter={(evt) =>
                                  setHover({
                                    x: evt.clientX,
                                    y: evt.clientY,
                                    team,
                                    week: String(week),
                                    value,
                                    result: result ?? "",
                                    oppName: opp ?? "",
                                    oppValue: oppVal,
                                  })
                                }
                                onMouseMove={(evt) =>
                                  setHover((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          x: evt.clientX,
                                          y: evt.clientY,
                                        }
                                      : prev
                                  )
                                }
                                onMouseLeave={() => setHover(null)}
                                onFocus={(evt) => {
                                  const rect = (evt.target as HTMLElement).getBoundingClientRect();
                                  setHover({
                                    x: rect.left + rect.width / 2,
                                    y: rect.top,
                                    team,
                                    week: String(week),
                                    value,
                                    result: result ?? "",
                                    oppName: opp ?? "",
                                    oppValue: oppVal,
                                  });
                                }}
                                onBlur={() => setHover(null)}
                              >
                                {label}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hover && (
                  <div
                    ref={tooltipRef}
                    className="pointer-events-none fixed z-50 max-w-xs rounded-xl border border-border bg-card/95 px-4 py-3 text-sm shadow-xl"
                    style={{ left: hover.x, top: hover.y }}
                  >
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Week {hover.week}</p>
                    <p className="mt-1 text-sm font-semibold text-card-foreground">{hover.team}</p>
                    <p className="text-sm">
                      {hover.value != null ? `${hover.value} categories` : "–"}
                      {hover.result ? ` · ${hover.result}` : ""}
                    </p>
                    {hover.oppName && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        vs {hover.oppName}
                        {hover.oppValue != null ? ` · ${hover.oppValue} cats` : ""}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDiff(hover.value, hover.oppValue)}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Category Radar Breakdown</h2>
                <p className="text-sm text-muted-foreground">
                  Compare each team’s cumulative production (filled radar) against category win percentage (outline).
                </p>
              </div>
              
            </div>
            {radarError && (
              <p className="text-sm text-red-400">{radarError}</p>
            )}
            {!radarData && !radarError && (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={idx} className="h-72 animate-pulse rounded-xl border border-border bg-accent/30" />
                ))}
              </div>
            )}
            {radarData && (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {radarData.datasets.map((dataset) => (
                  <Card key={dataset.key} className="flex flex-col">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-lg font-semibold leading-tight">
                        {dataset.name}
                      </CardTitle>
                      <CardDescription>Record: {dataset.record}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1">
                      <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart data={dataset.data} outerRadius="98%">
                            <PolarGrid stroke="rgba(255,255,255,0.1)" />
                            <PolarAngleAxis
                              dataKey="label"
                              tick={{ fill: "#8fa3bf", fontSize: 11 }}
                            />
                            <PolarRadiusAxis
                              angle={90}
                              tick={{ fill: "#8fa3bf", fontSize: 10 }}
                              tickFormatter={(v) => `${Math.round(v * 100)}%`}
                              axisLine={false}
                              tickLine={false}
                              domain={[0, 1]}
                            />
                            <RadarTooltip
                              cursor={{ stroke: "rgba(255,255,255,0.15)" }}
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const datum = payload[0].payload as RadarDatum;
                                return (
                                  <div className="rounded-md border border-border bg-card/95 px-3 py-2 text-xs text-card-foreground shadow-lg">
                                    <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                                      {datum.label}
                                    </span>
                                    <span className="block text-sm font-semibold text-card-foreground">
                                      Total: {datum.total.toFixed(2)}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                      Wins {datum.wins} · Losses {datum.losses}
                                      {datum.ties ? ` · Ties ${datum.ties}` : ""}
                                    </span>
                                    <span className="mt-1 block text-xs">
                                      Win %: {(datum.winPct * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                );
                              }}
                            />
                            <Legend
                              verticalAlign="bottom"
                              align="center"
                              iconType="circle"
                              wrapperStyle={{ paddingTop: "2rem" }}
                              content={(props) => (
                                <RadarLegendContent
                                  payload={props?.payload?.map((item: any) => ({
                                    value: item?.value,
                                    color: item?.color,
                                  }))}
                                />
                              )}
                            />
                            <Radar
                              name="Totals"
                              dataKey="totalScaled"
                              stroke="#a7f3d0"
                              fillOpacity={0}
                            />
                            <Radar
                              name="Win %"
                              dataKey="winPct"
                              stroke="#60a5fa"
                              fill="#60a5fa"
                              fillOpacity={0.2}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Advanced Season Analytics</h2>
                <p className="text-sm text-muted-foreground">
                  Explore inequality, consistency, efficiency, and roster strategy across the league.
                </p>
              </div>
              
            </div>
            {analyticsError && (
              <p className="text-sm text-red-400">{analyticsError}</p>
            )}

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold">Win Contribution Tree</CardTitle>
                <CardDescription>
                  Inspect how each team accumulates category wins. Switch teams to compare footprints.
                </CardDescription>
                {contributionTeams.length > 1 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {contributionTeams.map((team) => {
                      const isActive = team.teamKey === selectedContributionTeam;
                      return (
                        <button
                          key={team.teamKey}
                          onClick={() => setSelectedContributionTeam(team.teamKey)}
                          className={`rounded-full border px-3 py-1 text-sm transition ${
                            isActive
                              ? "border-foreground bg-foreground text-background"
                              : "border-border bg-accent text-muted-foreground hover:border-foreground/40"
                          }`}
                        >
                          {team.teamName}
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {!analytics && !analyticsError && (
                  <div className="h-80 animate-pulse rounded-xl border border-border bg-accent/30" />
                )}
                {analytics && selectedContribution ? (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <Treemap
                        data={selectedContribution.categories.length
                          ? selectedContribution.categories
                          : [{ name: "No data", size: 1, value: 0, fill: TREEMAP_FALLBACK }]}
                        dataKey="size"
                        isAnimationActive={false}
                        stroke="transparent"
                        fill="transparent"
                        content={({ x, y, width, height, depth, name, payload, fill }) => {
                          if (!width || !height || width <= 0 || height <= 0 || depth === 0) return null;
                          const showLabel = width > 48 && height > 24;
                          const color = fill ?? payload?.fill ?? TREEMAP_FALLBACK;
                          const gap = 1;
                          const innerX = x + gap;
                          const innerY = y + gap;
                          const innerWidth = Math.max(0, width - gap * 2);
                          const innerHeight = Math.max(0, height - gap * 2);
                          return (
                            <g>
                              <rect
                                x={innerX}
                                y={innerY}
                                width={innerWidth}
                                height={innerHeight}
                                fill={color}
                                stroke="transparent"
                                rx={16}
                                ry={16}
                              />
                              {showLabel ? (
                                <text
                                  x={innerX + innerWidth / 2}
                                  y={innerY + innerHeight / 2}
                                  fill="#ffffff"
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  fontSize={12}
                                >
                                  {name}
                                </text>
                              ) : null}
                            </g>
                          );
                        }}
                      >
                        {selectedContribution.categories.length
                          ? selectedContribution.categories.map((cat) => (
                              <Cell key={cat.name} fill={cat.fill} stroke="transparent" />
                            ))
                          : <Cell fill={TREEMAP_FALLBACK} stroke="transparent" />}
                        <RechartsTooltip
                          cursor={{ fill: "rgba(0,0,0,0.2)" }}
                          wrapperStyle={{ color: "#ffffff" }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const entry = payload[0];
                            const node = entry?.payload || {};
                            const actual = typeof node.value === "number"
                              ? node.value
                              : Number(entry?.value ?? 0);
                            const name = node.name || entry?.name;
                            return (
                              <div
                                className="pointer-events-none rounded-xl border border-border bg-card/95 px-3 py-2 text-xs shadow-xl"
                                style={{ color: "#ffffff" }}
                              >
                                <p style={{ color: "#ffffff" }}>{name}</p>
                                <p style={{ color: "#ffffff" }}>{actual.toFixed(2)} win eq</p>
                              </div>
                            );
                          }}
                        />
                      </Treemap>
                    </ResponsiveContainer>
                  </div>
                ) : analytics && !selectedContribution ? (
                  <p className="text-sm text-muted-foreground">No contribution data available.</p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold">Roster Moves vs Win %</CardTitle>
                <CardDescription>
                  Scatterplot of total moves against season win percentage.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!analytics && !analyticsError && !fallbackRosterMoves && (
                  <div className="h-80 animate-pulse rounded-xl border border-border bg-accent/30" />
                )}
                {rosterMovesData.length ? (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 10, right: 10, bottom: 16, left: 10 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                        <XAxis
                          type="number"
                          dataKey="moves"
                          name="Moves"
                          stroke="#6b7280"
                          tick={{ fill: "#6b7280", fontSize: 10 }}
                          domain={[0, (dataMax) => Math.max(dataMax ?? 0, 5)]}
                        />
                        <YAxis
                          type="number"
                          dataKey="winPct"
                          name="Win %"
                          stroke="#6b7280"
                          tick={{ fill: "#6b7280", fontSize: 10 }}
                          domain={[0, 1]}
                          tickFormatter={(v) => `${Math.round(v * 100)}%`}
                        />
                        <RechartsTooltip
                          cursor={{ stroke: "rgba(255,255,255,0.25)" }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const point = payload[0]?.payload;
                            if (!point) return null;
                            return (
                              <div className="pointer-events-none rounded-xl border border-border bg-card/95 px-3 py-2 text-xs text-card-foreground shadow-xl">
                                <p className="font-medium text-foreground">{point.teamName}</p>
                                <p className="text-muted-foreground">Moves: {point.moves}</p>
                                <p className="text-muted-foreground">Win %: {(point.winPct * 100).toFixed(1)}%</p>
                              </div>
                            );
                          }}
                        />
                        <Scatter data={rosterMovesData} shape="circle">
                          {rosterMovesData.map((entry, idx) => (
                            <Cell
                              key={entry.teamKey}
                              fill={SCATTER_COLORS[idx % SCATTER_COLORS.length]}
                            />
                          ))}
                        </Scatter>
                        <Legend
                          verticalAlign="bottom"
                          align="center"
                          wrapperStyle={{ paddingTop: 12 }}
                          content={() => (
                            <div className="flex flex-wrap justify-center gap-3 pt-3 text-xs text-muted-foreground">
                              {rosterMovesData.map((entry, idx) => (
                                <div key={entry.teamKey} className="flex items-center gap-2">
                                  <span
                                    className="inline-block h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: SCATTER_COLORS[idx % SCATTER_COLORS.length] }}
                                  />
                                  <span>{entry.teamName}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                ) : (analytics || fallbackRosterMoves) ? (
                  <p className="text-sm text-muted-foreground">No roster movement data reported.</p>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-2">
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg font-semibold">Sharpe Ratio Highlights</CardTitle>
                  <CardDescription>
                    Top team-category combinations ranked by consistency-adjusted margin.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!analytics && !analyticsError && (
                    <div className="h-64 animate-pulse rounded-xl border border-border bg-accent/30" />
                  )}
                  {analytics && (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={sharpeHighlights} layout="vertical" margin={{ top: 8, right: 12, bottom: 24 }}>
                          <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                          <XAxis type="number" stroke="#6b7280" tick={{ fill: "#6b7280", fontSize: 10 }} />
                          <YAxis
                            type="category"
                            dataKey={(d) => `${d.teamName} · ${d.label}`}
                            stroke="#6b7280"
                            width={240}
                            interval={0}
                            tick={{ fill: "#9ca3af", fontSize: 11 }}
                          />
                          <RechartsTooltip
                            cursor={{ fill: "rgba(0,0,0,0.2)" }}
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const bar = payload[0]?.payload;
                              if (!bar) return null;
                              const tone = textColorForValue(bar.sharpe ?? 0, sharpeRange.min, sharpeRange.max);
                              return (
                                <div className="pointer-events-none rounded-xl border border-border bg-card/95 px-3 py-2 text-xs text-card-foreground shadow-xl">
                                  <p className="font-medium" style={{ color: tone }}>{bar.teamName}</p>
                                  <p className="text-xs text-muted-foreground">{bar.label}</p>
                                  <p className="text-xs" style={{ color: tone }}>Sharpe: {bar.sharpe?.toFixed(2) ?? "0.00"}</p>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="sharpe">
                            {sharpeHighlights.map((entry) => (
                              <Cell
                                key={`${entry.teamKey}-${entry.statId}`}
                                fill={entry.sharpe != null && entry.sharpe < 0 ? NEGATIVE_SOLID : POSITIVE_SOLID}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg font-semibold">Category EBITDA</CardTitle>
                  <CardDescription>
                    Actual win equivalents minus expected share based on stat volume.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!analytics && !analyticsError && (
                    <div className="h-64 animate-pulse rounded-xl border border-border bg-accent/30" />
                  )}
                  {analytics && ebitdaTotals.length ? (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={ebitdaTotals} margin={{ top: 8, right: 12, bottom: 40 }}>
                          <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                          <XAxis
                            dataKey="teamName"
                            stroke="#6b7280"
                            interval={0}
                            angle={-25}
                            textAnchor="end"
                            height={70}
                            tick={{ fill: "#9ca3af", fontSize: 10 }}
                          />
                          <YAxis stroke="#6b7280" tick={{ fill: "#6b7280", fontSize: 10 }} />
                          <RechartsTooltip
                            cursor={{ fill: "rgba(0,0,0,0.2)" }}
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const bar = payload[0]?.payload;
                              if (!bar) return null;
                              const tone = textColorForValue(bar.total, ebitdaRange.min, ebitdaRange.max);
                              return (
                                <div className="pointer-events-none rounded-xl border border-border bg-card/95 px-3 py-2 text-xs text-card-foreground shadow-xl">
                                  <p className="font-medium" style={{ color: tone }}>{bar.teamName}</p>
                                  <p className="text-xs" style={{ color: tone }}>Total delta: {bar.total.toFixed(2)}</p>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="total">
                            {ebitdaTotals.map((entry) => (
                              <Cell
                                key={entry.teamKey}
                                fill={entry.total < 0 ? NEGATIVE_SOLID : POSITIVE_SOLID}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : analytics ? (
                    <p className="text-sm text-muted-foreground">No EBITDA variance to display.</p>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
