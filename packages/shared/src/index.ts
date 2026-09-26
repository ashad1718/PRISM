export const GAMMA_BASE = "https://gamma-api.polymarket.com";

export const LMSR_B_DEFAULT = 1_000_000;

export type GammaMarket = {
  id: string;
  question?: string;
  conditionId?: string;
  slug?: string;
  endDate?: string;
  endDateIso?: string;
  closed?: boolean;
  active?: boolean;
  outcomes?: string;
  outcomePrices?: string;
  volume?: string;
  liquidity?: string;
};

export type GammaEvent = {
  id: string;
  title?: string;
  slug?: string;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
  markets?: GammaMarket[];
};

export type CuratedMarket = {
  polymarketId: string;
  question: string;
  endTs: number;
  priceYesBps: number;
  lmsr_b?: number;  // LMSR bonding curve parameter (default: 1_000_000)
  closed: boolean;
  winningOutcome: 0 | 1 | null;
  aiScore?: number;  // AI curation score 0-100 (default: null = auto-accept)
  aiReason?: string; // AI explanation for the score
  aiTitle?: string;  // AI-generated title (max 200 chars)
  aiTags?: string[]; // AI-generated tags
  aiSummary?: string; // AI-generated summary (max 500 chars)
  source?: "polymarket" | "prism";
  yesPrice?: number;
  noPrice?: number;
  raw: GammaMarket | any;
};

export function parseArrayField<T = string>(value: T[] | string | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isMarketTradeable(market: any): boolean {
  if (!market) return false;
  if (market.source === "prism" || (market.source !== "polymarket" && market.pubkey)) {
    return true;
  }
  const raw = market.raw || market;
  const tokenIds = parseArrayField<string>(raw.clobTokenIds || market.clobTokenIds);

  const active = raw.active !== undefined ? Boolean(raw.active) : (market.active !== undefined ? Boolean(market.active) : true);
  const closed = raw.closed !== undefined ? Boolean(raw.closed) : (market.closed !== undefined ? Boolean(market.closed) : false);
  const acceptingOrders = raw.acceptingOrders !== undefined ? Boolean(raw.acceptingOrders) : (market.acceptingOrders !== undefined ? Boolean(market.acceptingOrders) : true);

  return (
    active === true &&
    closed !== true &&
    acceptingOrders === true &&
    tokenIds.length >= 2 &&
    Boolean(tokenIds[0]) &&
    Boolean(tokenIds[1])
  );
}

export function getMarketOutcomeTokenIds(market: any): { yesTokenId: string | null; noTokenId: string | null } {
  if (!market) return { yesTokenId: null, noTokenId: null };
  const raw = market.raw || market;
  const outcomes = parseArrayField<string>(raw.outcomes || market.outcomes);
  const tokenIds = parseArrayField<string>(raw.clobTokenIds || market.clobTokenIds);

  if (tokenIds.length < 2) {
    return { yesTokenId: tokenIds[0] || null, noTokenId: tokenIds[1] || null };
  }

  const yesIndex = outcomes.findIndex((o) => typeof o === "string" && o.toLowerCase() === "yes");
  const noIndex = outcomes.findIndex((o) => typeof o === "string" && o.toLowerCase() === "no");

  const yesTokenId = yesIndex >= 0 ? tokenIds[yesIndex] : tokenIds[0];
  const noTokenId = noIndex >= 0 ? tokenIds[noIndex] : tokenIds[1];

  return { yesTokenId: yesTokenId || null, noTokenId: noTokenId || null };
}

function parseJsonArray(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseEndTs(market: GammaMarket, event?: GammaEvent): number {
  const raw = market.endDateIso || market.endDate || event?.endDate;
  if (!raw) {
    // Default: 7 days from now if API omits end date
    return Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    return Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  }
  return Math.floor(ms / 1000);
}

function parsePrices(market: GammaMarket): { yesBps: number; winning: 0 | 1 | null; yesPrice?: number; noPrice?: number } {
  const prices = parseJsonArray(market.outcomePrices).map(Number);
  const outcomes = parseJsonArray(market.outcomes).map((o) => o.toLowerCase());

  let yesBps = 5000;
  let yesPrice: number | undefined = undefined;
  let noPrice: number | undefined = undefined;

  if (prices.length >= 1 && Number.isFinite(prices[0])) {
    yesPrice = prices[0];
    yesBps = Math.min(9999, Math.max(1, Math.round(yesPrice * 10_000)));
  }
  if (prices.length >= 2 && Number.isFinite(prices[1])) {
    noPrice = prices[1];
  } else if (yesPrice !== undefined) {
    noPrice = 1 - yesPrice;
  }

  let winning: 0 | 1 | null = null;
  if (market.closed && prices.length >= 2) {
    if (prices[0] >= 0.99) winning = 0;
    else if (prices[1] >= 0.99) winning = 1;
    else if (outcomes[0]?.includes("yes") && prices[0] > prices[1]) winning = 0;
    else if (prices[1] > prices[0]) winning = 1;
  }

  return { yesBps, winning, yesPrice, noPrice };
}

function parseLmsrB(market: GammaMarket): number {
  // Derive LMSR b parameter from Gamma market liquidity
  let liquidity = 0;
  if (market.liquidity && Number.isFinite(Number(market.liquidity))) {
    liquidity = Math.max(1, Number(market.liquidity));
  }
  // Scale: larger liquidity → larger b (deeper market)
  // b = 1_000_000 * (liquidity / 1_000_000 + 1), capped at 10_000_000
  const b = 1_000_000 * Math.min(10, liquidity / 1_000_000 + 1);
  return Math.round(b);
}

// TODO(AI): Connect this to the upcoming Snowflake/Cortex AI pipeline.
// For now, return null/default to avoid fabricating AI analysis.
function parseAiScore(market: GammaMarket): { score: number; reason: string } | null {
  return null;
}

function parseAiEnrichment(market: GammaMarket): { title: string; tags: string[]; summary: string } {
  return { title: "", tags: [], summary: "" };
}

export function normalizeMarket(market: GammaMarket, event?: GammaEvent): CuratedMarket | null {
  const id = market.id || market.conditionId || market.slug;
  if (!id) return null;

  const question = (market.question || event?.title || "Untitled market").slice(0, 200);
  const { yesBps, winning, yesPrice, noPrice } = parsePrices(market);
  const lmsr_b = parseLmsrB(market);

  return {
    polymarketId: String(id).slice(0, 64),
    question,
    endTs: parseEndTs(market, event),
    priceYesBps: yesBps,
    yesPrice,
    noPrice,
    lmsr_b,
    closed: Boolean(market.closed),
    winningOutcome: winning,
    aiScore: undefined,
    aiReason: undefined,
    aiTitle: undefined,
    aiTags: undefined,
    aiSummary: undefined,
    source: "polymarket",
    raw: market,
  };
}

export async function fetchActiveEvents(limit = 25): Promise<GammaEvent[]> {
  const url = `${GAMMA_BASE}/events?active=true&closed=false&limit=${limit}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Gamma API ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as GammaEvent[];
}

export async function fetchMarketBySlug(slug: string): Promise<GammaMarket | null> {
  const url = `${GAMMA_BASE}/markets?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = (await res.json()) as GammaMarket[];
  return Array.isArray(data) ? data[0] ?? null : null;
}

export async function collectBinaryMarkets(limitEvents = 25): Promise<CuratedMarket[]> {
  const events = await fetchActiveEvents(limitEvents);
  const out: CuratedMarket[] = [];

  for (const event of events) {
    for (const market of event.markets ?? []) {
      const outcomes = parseJsonArray(market.outcomes).map((o) => o.toLowerCase());
      const isBinary =
        outcomes.length === 2 &&
        ((outcomes.includes("yes") && outcomes.includes("no")) || outcomes.length === 2);
      if (!isBinary) continue;
      const normalized = normalizeMarket(market, event);
      if (normalized && !normalized.closed) out.push(normalized);
    }
  }

  return out;
}

export async function fetchActiveGammaMarkets(limit = 100): Promise<GammaMarket[]> {
  const url = `${GAMMA_BASE}/markets?active=true&closed=false&limit=${limit}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Gamma API ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as GammaMarket[];
}

export async function collectActiveBinaryMarkets(limit = 100): Promise<CuratedMarket[]> {
  const markets = await fetchActiveGammaMarkets(limit);
  const out: CuratedMarket[] = [];

  for (const market of markets) {
    const outcomes = parseJsonArray(market.outcomes).map((o) => o.toLowerCase());
    const isBinary =
      outcomes.length === 2 &&
      ((outcomes.includes("yes") && outcomes.includes("no")) || outcomes.length === 2);
    if (!isBinary) continue;
    const normalized = normalizeMarket(market);
    if (normalized && !normalized.closed) out.push(normalized);
  }

  return out;
}

/** Offline/dev path when Gamma is unreachable. */
export function marketsFromFixtures(raw: GammaMarket[]): CuratedMarket[] {
  return raw
    .map((m) => normalizeMarket(m))
    .filter((m): m is CuratedMarket => Boolean(m && !m.closed));
}

export type MarketStatus = "open" | "frozen" | "resolved";

export type StoredMarket = CuratedMarket & {
  pubkey?: string;
  status: MarketStatus;
  createdAt: string;
};

export function calculateLmsrPrices(b: number, yesSupply: number, noSupply: number) {
  const maxQ = Math.max(yesSupply / b, noSupply / b);
  const eYes = Math.exp((yesSupply / b) - maxQ);
  const eNo = Math.exp((noSupply / b) - maxQ);
  
  const pYes = eYes / (eYes + eNo);
  const pNo = eNo / (eYes + eNo);
  
  return {
    yesPrice: pYes,
    noPrice: pNo
  };
}

function lmsrCost(b: number, yes: number, no: number): number {
    const maxQ = Math.max(yes / b, no / b);
    return b * (maxQ + Math.log(Math.exp(yes / b - maxQ) + Math.exp(no / b - maxQ)));
}

export function calculateLmsrCost(
  b: number,
  currentYes: number,
  currentNo: number,
  shareAmount: number,
  outcome: 0 | 1,
  side: "buy" | "sell"
): number {
  const oldYes = currentYes;
  const oldNo = currentNo;
  let newYes = oldYes;
  let newNo = oldNo;

  if (side === "buy") {
    if (outcome === 0) newYes += shareAmount;
    else newNo += shareAmount;
    
    const cost = lmsrCost(b, newYes, newNo) - lmsrCost(b, oldYes, oldNo);
    return Math.max(0, Math.round(cost));
  } else {
    if (outcome === 0) newYes -= shareAmount;
    else newNo -= shareAmount;
    
    const proceeds = lmsrCost(b, oldYes, oldNo) - lmsrCost(b, newYes, newNo);
    return Math.max(0, Math.round(proceeds));
  }
}
