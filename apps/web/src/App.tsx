import React, { useCallback, useEffect, useMemo, useState, Component, ErrorInfo, ReactNode } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { BN, Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { type StoredMarket, calculateLmsrCost, calculateLmsrPrices, isMarketTradeable, getMarketOutcomeTokenIds } from "@prism/shared";
import confetti from "canvas-confetti";
import {
  TrendingUp,
  Sparkles,
  Activity,
  Search,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Coins,
  Lock,
  Award,
  Filter,
  Layers,
  ArrowLeft,
  DollarSign,
  ShieldCheck,
  ChevronRight,
  Info,
  Globe
} from "lucide-react";

import idl from "./idl/prism.json";
import AdminPage from "./AdminPage";
import TransactionHistoryPage from "./TransactionHistoryPage";
import MarketActivity from "./MarketActivity";
import CommentSection from "./CommentSection";
import LandingPage from "./LandingPage";
import LandingContent from "./LandingContent";
import { GradientWave } from "./GradientWave";
import PRISMBackground from "./PRISMBackground";

const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID || (idl as any).address
);
const USDC_MINT = new PublicKey(
  import.meta.env.VITE_USDC_MINT || "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
);

function configPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("config_v3")], PROGRAM_ID);
}

function marketPda(polymarketId: string) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(polymarketId)],
    PROGRAM_ID
  );
}

function vaultPda(market: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    PROGRAM_ID
  );
}

function positionPda(market: PublicKey, user: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), user.toBuffer()],
    PROGRAM_ID
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "24px", color: "#e11d48", background: "#fff1f2", borderRadius: "12px", border: "1px solid #fecdd3" }}>
          <h3 style={{ margin: "0 0 10px 0", display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertTriangle size={20} /> Section Load Error
          </h3>
          <p style={{ fontSize: "0.9rem", color: "#64748b" }}>An error occurred rendering this section. Please try refreshing.</p>
          <details style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", color: "#e11d48", marginTop: "10px" }}>
            {this.state.error && this.state.error.toString()}
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [markets, setMarkets] = useState<StoredMarket[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<"ALL" | "POLYMARKET" | "PRISM">("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentRoute, setCurrentRoute] = useState(window.location.hash);
  const [shares, setShares] = useState("10");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [position, setPosition] = useState<{ yes: number; no: number } | null>(null);
  const [tradeOutcome, setTradeOutcome] = useState<0 | 1>(0);
  const [showTechDetails, setShowTechDetails] = useState(false);
  
  const [onChainState, setOnChainState] = useState<{
    yesSupply: number;
    noSupply: number;
    lmsrB: number;
    aiResolutionConfidence: number;
    winningOutcome: number | null;
    status: string;
    usdcMint?: string;
  } | null>(null);
  
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    const handleHash = () => setCurrentRoute(window.location.hash);
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const loadMarkets = useCallback(async () => {
    try {
      const response = await fetch(`https://api.002014.xyz/markets.json?utm_source=chatgpt.com&t=${Date.now()}`, { cache: "no-store" });
      const data = await response.json();
      if (!data) {
        setMarkets([]);
        return;
      }
      const dataObj: Record<string, StoredMarket> = Array.isArray(data)
        ? Object.fromEntries(
            data.map((m: any) => [
              m.polymarket_id || m.polymarketId,
              {
                polymarketId: m.polymarket_id || m.polymarketId,
                question: m.question,
                endTs: Number(m.end_ts || m.endTs),
                priceYesBps: Number(m.price_yes_bps || m.priceYesBps),
                lmsr_b: m.lmsr_b || 1_000_000,
                closed: Boolean(m.closed),
                winningOutcome: m.winning_outcome ?? m.winningOutcome ?? null,
                status: m.status || (m.closed ? "resolved" : "open"),
                createdAt: m.created_at || m.createdAt,
                pubkey: m.pubkey,
                aiScore: m.ai_score ?? m.aiScore,
                aiReason: m.ai_reason ?? m.aiReason,
                aiTitle: m.ai_title ?? m.aiTitle,
                aiTags: m.ai_tags ?? m.aiTags,
                aiSummary: m.ai_summary ?? m.aiSummary,
                source: m.source || "polymarket",
                raw: m.raw || m,
              },
            ])
          )
        : data;
      const list = Object.values(dataObj).sort((a, b) => b.endTs - a.endTs);
      setMarkets(list);
      if (list[0]) {
        setSelected((prev) => prev || (list[0].source === "prism" && list[0].pubkey ? list[0].pubkey : list[0].polymarketId));
      }
    } catch (err) {
      console.error("Failed to load markets", err);
      setMarkets([]);
    }
  }, []);

  useEffect(() => {
    loadMarkets();
    const t = setInterval(loadMarkets, 15_000);
    return () => clearInterval(t);
  }, [loadMarkets]);

  const active = useMemo(
    () => markets.find((m) => (m.source === "prism" && m.pubkey ? m.pubkey : m.polymarketId) === selected) ?? null,
    [markets, selected]
  );

  const program = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;
    const provider = new AnchorProvider(
      connection,
      wallet as unknown as AnchorProvider["wallet"],
      { commitment: "confirmed" }
    );
    return new Program(idl as never, provider);
  }, [connection, wallet]);

  const refreshMarketData = useCallback(async () => {
    if (!active) {
      setOnChainState(null);
      return;
    }
    try {
      const marketKey = active.pubkey ? new PublicKey(active.pubkey) : marketPda(active.polymarketId)[0];
      const accountInfo = await connection.getAccountInfo(marketKey);
      if (accountInfo && program) {
        const decoded: any = await (program.account as any).market.fetch(marketKey);
        setOnChainState({
          yesSupply: Number(decoded.yesSupply || 0),
          noSupply: Number(decoded.noSupply || 0),
          lmsrB: Number(decoded.lmsrB || 1_000_000),
          aiResolutionConfidence: Number(decoded.aiResolutionConfidence ?? 100),
          winningOutcome: decoded.winningOutcome !== null && decoded.winningOutcome !== undefined ? Number(decoded.winningOutcome) : null,
          status: Object.keys(decoded.status || {})[0]?.toLowerCase() || active.status,
          usdcMint: decoded.usdcMint?.toString(),
        });
      } else {
        setOnChainState({
          yesSupply: 0,
          noSupply: 0,
          lmsrB: active.lmsr_b || 1_000_000,
          aiResolutionConfidence: 100,
          winningOutcome: active.winningOutcome,
          status: active.status,
          usdcMint: USDC_MINT.toBase58(),
        });
      }
    } catch {
      setOnChainState(null);
    }
  }, [active, connection, program]);

  const refreshPosition = useCallback(async () => {
    if (!wallet.publicKey || !active) {
      setPosition(null);
      return;
    }
    try {
      const marketKey = active.pubkey ? new PublicKey(active.pubkey) : marketPda(active.polymarketId)[0];
      const [posKey] = positionPda(marketKey, wallet.publicKey);
      const info = await connection.getAccountInfo(posKey);
      if (!info || !program) {
        setPosition({ yes: 0, no: 0 });
        return;
      }
      const decoded = await (program.account as any).position.fetch(posKey);
      setPosition({
        yes: Number(decoded.yesShares),
        no: Number(decoded.noShares),
      });
    } catch {
      setPosition({ yes: 0, no: 0 });
    }
  }, [wallet.publicKey, active, connection, program]);

  useEffect(() => {
    refreshPosition();
    refreshMarketData();
  }, [refreshPosition, refreshMarketData]);

  async function trade(side: "buy" | "sell", outcome: 0 | 1) {
    if (!active) return;
    if (!wallet.publicKey) {
      setMsg("Connect your wallet to trade on PRISM.");
      return;
    }
    if (active.source === "polymarket") {
      const { yesTokenId, noTokenId } = getMarketOutcomeTokenIds(active);
      const targetTokenId = outcome === 0 ? yesTokenId : noTokenId;
      setMsg(
        `Polymarket CLOB order submission is not currently connected on the PRISM backend. Outcome Token ID: ${
          targetTokenId || "N/A"
        }`
      );
      return;
    }
    if (!program) {
      setMsg("Connect your wallet to trade on PRISM.");
      return;
    }
    const shareAmount = Math.round(Number(shares) * 1_000_000);
    if (!Number.isFinite(shareAmount) || shareAmount <= 0) {
      setMsg("Please enter a valid share amount.");
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const marketKey = active.pubkey ? new PublicKey(active.pubkey) : marketPda(active.polymarketId)[0];
      const [vaultKey] = vaultPda(marketKey);
      const [positionKey] = positionPda(marketKey, wallet.publicKey);
      const marketUsdcMint = onChainState?.usdcMint ? new PublicKey(onChainState.usdcMint) : USDC_MINT;
      const userUsdc = getAssociatedTokenAddressSync(marketUsdcMint, wallet.publicKey);

      const method =
        side === "buy"
          ? program.methods.buy(outcome, new BN(shareAmount))
          : program.methods.sell(outcome, new BN(shareAmount));

      let builder = method.accounts({
        user: wallet.publicKey,
        market: marketKey,
        position: positionKey,
        vault: vaultKey,
        userUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      });

      let ataInfo = null;
      try {
        ataInfo = await connection.getAccountInfo(userUsdc);
      } catch {
        // network check
      }
      if (!ataInfo) {
        const createAtaIx = createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          userUsdc,
          wallet.publicKey,
          marketUsdcMint
        );
        builder = builder.preInstructions([createAtaIx]);
      }

      const tx = await builder.rpc();
      setMsg(`${side.toUpperCase()} ${outcome === 0 ? "YES" : "NO"} confirmed! TX: ${tx.slice(0, 8)}...`);
      await refreshPosition();
      await refreshMarketData();
      setRefreshCounter((prev) => prev + 1);
    } catch (err: any) {
      console.error("Trade error:", err);
      let errorMsg = err?.message || String(err);
      if (err?.logs || (typeof err?.getLogs === "function")) {
        const logs = err?.logs || (err?.getLogs ? err.getLogs() : []);
        if (logs && logs.length > 0) {
          errorMsg += ` (Logs: ${logs.join(" | ")})`;
        }
      }
      setMsg(errorMsg);
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!program || !wallet.publicKey || !active) return;
    setBusy(true);
    setMsg(null);
    try {
      const marketKey = active.pubkey ? new PublicKey(active.pubkey) : marketPda(active.polymarketId)[0];
      const [vaultKey] = vaultPda(marketKey);
      const [positionKey] = positionPda(marketKey, wallet.publicKey);
      const marketUsdcMint = onChainState?.usdcMint ? new PublicKey(onChainState.usdcMint) : USDC_MINT;
      const userUsdc = getAssociatedTokenAddressSync(marketUsdcMint, wallet.publicKey);

      let builder = program.methods
        .redeem()
        .accounts({
          user: wallet.publicKey,
          market: marketKey,
          position: positionKey,
          vault: vaultKey,
          userUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      let ataInfo = null;
      try {
        ataInfo = await connection.getAccountInfo(userUsdc);
      } catch {
        // network check
      }
      if (!ataInfo) {
        const createAtaIx = createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          userUsdc,
          wallet.publicKey,
          marketUsdcMint
        );
        builder = builder.preInstructions([createAtaIx]);
      }

      const txSig = await builder.rpc();

      try {
        confetti({
          particleCount: 120,
          spread: 70,
          origin: { y: 0.6 }
        });
      } catch {
        // confetti fallback
      }

      setMsg(`Redeemed winning shares for USDC!|${winningShares.toFixed(2)}|${txSig}`);
      await refreshPosition();
      await refreshMarketData();
      setRefreshCounter((prev) => prev + 1);
    } catch (err: any) {
      console.error("Redeem error:", err);
      let errorMsg = err?.message || String(err);
      if (err?.logs || (typeof err?.getLogs === "function")) {
        const logs = err?.logs || (err?.getLogs ? err.getLogs() : []);
        if (logs && logs.length > 0) {
          errorMsg += ` (Logs: ${logs.join(" | ")})`;
        }
      }
      setMsg(errorMsg);
    } finally {
      setBusy(false);
    }
  }

  // Odds and probabilities calculations
  let yesPctNum = active ? (active.yesPrice ? active.yesPrice * 100 : active.priceYesBps / 100) : 50;
  let noPctNum = active ? (active.noPrice ? active.noPrice * 100 : 100 - (active.priceYesBps / 100)) : 50;

  if (onChainState && active?.source === "prism") {
    const prices = calculateLmsrPrices(onChainState.lmsrB, onChainState.yesSupply, onChainState.noSupply);
    yesPctNum = prices.yesPrice * 100;
    noPctNum = prices.noPrice * 100;
  }

  const yesPct = yesPctNum.toFixed(1);
  const noPct = noPctNum.toFixed(1);

  let currentStatus = onChainState?.status || active?.status || "open";
  const activeEndTs = Number((onChainState as any)?.endTs || (active as any)?.end_ts || active?.endTs || 0);
  if (currentStatus === "open" && activeEndTs > 0 && Date.now() / 1000 > activeEndTs) {
    currentStatus = "frozen";
  }
  // LMSR Cost estimate calculation
  const shareNum = Math.round((Number(shares) || 1) * 1_000_000);
  const estimatedBuyYesCost = onChainState
    ? calculateLmsrCost(onChainState.lmsrB, onChainState.yesSupply, onChainState.noSupply, shareNum, 0, "buy")
    : shareNum;
  const estimatedBuyNoCost = onChainState
    ? calculateLmsrCost(onChainState.lmsrB, onChainState.yesSupply, onChainState.noSupply, shareNum, 1, "buy")
    : shareNum;

  const selectedCostRaw = tradeOutcome === 0 ? estimatedBuyYesCost : estimatedBuyNoCost;
  const selectedCost = selectedCostRaw / 1_000_000;
  const expectedShares = Number(shares) || 1;
  const toWin = expectedShares;
  const avgPrice = expectedShares > 0 ? selectedCost / expectedShares : 0;
  const potentialProfit = toWin - selectedCost;
  const returnPercentage = selectedCost > 0 ? ((toWin - selectedCost) / selectedCost) * 100 : 0;

  const winningShares =
    currentStatus === "resolved"
      ? onChainState?.winningOutcome === 0
        ? (position?.yes || 0) / 1_000_000
        : onChainState?.winningOutcome === 1
        ? (position?.no || 0) / 1_000_000
        : 0
      : 0;

  const losingShares =
    currentStatus === "resolved"
      ? onChainState?.winningOutcome === 0
        ? (position?.no || 0) / 1_000_000
        : onChainState?.winningOutcome === 1
        ? (position?.yes || 0) / 1_000_000
        : 0
      : 0;

  const userYesShares = (position?.yes || 0) / 1_000_000;
  const userNoShares = (position?.no || 0) / 1_000_000;

  const estimatedYesValue = (userYesShares * yesPctNum) / 100;
  const estimatedNoValue = (userNoShares * noPctNum) / 100;

  const isRedeemable = currentStatus === "resolved" && (onChainState?.aiResolutionConfidence ?? 100) >= 60 && winningShares > 0;

  const handleRedeem = async () => {
    if (
      !confirm(
        `REDEEM WINNING SHARES\n\nWinning Shares: ${winningShares.toFixed(2)}\nExpected Payout: $${winningShares.toFixed(
          2
        )} USDC\n\nProceed to submit transaction?`
      )
    ) {
      return;
    }
    await redeem();
  };

  // Filtering Markets
  const visibleMarkets = useMemo(() => {
    return markets.filter((m) => {
      if (sourceFilter === "POLYMARKET" && m.source !== "polymarket") return false;
      if (sourceFilter === "PRISM" && m.source !== "prism") return false;

      if (categoryFilter !== "ALL") {
        const cat = categoryFilter.toLowerCase();
        const hasTag = m.aiTags?.some((t) => t.toLowerCase().includes(cat));
        const hasText = (m.question || "").toLowerCase().includes(cat) || (m.aiTitle || "").toLowerCase().includes(cat);
        if (!hasTag && !hasText) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const inQuestion = (m.question || "").toLowerCase().includes(q);
        const inTitle = (m.aiTitle || "").toLowerCase().includes(q);
        const inTags = m.aiTags?.some((t) => t.toLowerCase().includes(q));
        const inId = (m.polymarketId || "").toLowerCase().includes(q);
        if (!inQuestion && !inTitle && !inTags && !inId) return false;
      }

      return true;
    });
  }, [markets, sourceFilter, categoryFilter, searchQuery]);

  const handleGetStarted = () => {
    window.location.hash = "#/markets";
  };

  const handleNavigateAdmin = () => {
    window.location.hash = "#/admin";
  };

  const isLandingView =
    currentRoute === "" ||
    currentRoute === "#" ||
    currentRoute === "#/" ||
    currentRoute.startsWith("#/landing");

  if (currentRoute.startsWith("#/admin")) {
    return (
      <PRISMBackground>
        <header className="top-nav">
          <a href="#/landing" className="brand-container">
            <div className="brand-logo-icon">
              <TrendingUp size={22} color="#ffffff" />
            </div>
            <div className="brand-text-wrapper">
              <span className="brand-mark">PRISM</span>
              <span className="brand-subtitle">ADMIN CONTROLS</span>
            </div>
          </a>
          <div className="nav-links">
            <a href="#/landing" className="nav-item">
              <Globe size={16} /> Home
            </a>
            <a href="#/markets" className="nav-item">
              <TrendingUp size={16} /> Markets
            </a>
            <div className="wallet-wrapper">
              <WalletMultiButton />
            </div>
          </div>
        </header>
        <AdminPage />
      </PRISMBackground>
    );
  }

  if (currentRoute.startsWith("#/transactions")) {
    return (
      <PRISMBackground>
        <header className="top-nav">
          <a href="#/landing" className="brand-container">
            <div className="brand-logo-icon">
              <TrendingUp size={22} color="#ffffff" />
            </div>
            <div className="brand-text-wrapper">
              <span className="brand-mark">PRISM</span>
              <span className="brand-subtitle">TRANSACTION LOG</span>
            </div>
          </a>
          <div className="nav-links">
            <a href="#/landing" className="nav-item">
              <Globe size={16} /> Home
            </a>
            <a href="#/markets" className="nav-item">
              <TrendingUp size={16} /> Markets
            </a>
            <div className="wallet-wrapper">
              <WalletMultiButton />
            </div>
          </div>
        </header>
        <TransactionHistoryPage refreshTrigger={refreshCounter} />
      </PRISMBackground>
    );
  }

  if (isLandingView) {
    return (
      <PRISMBackground>
        <LandingPage>
          <LandingContent onGetStarted={handleGetStarted} marketCount={markets.length} />
        </LandingPage>
      </PRISMBackground>
    );
  }

  return (
    <PRISMBackground>
      {/* Top Navigation Bar for PRISM Application */}
      <header className="top-nav">
          <a href="#/landing" className="brand-container">
            <div className="brand-logo-icon">
              <TrendingUp size={22} color="#ffffff" />
            </div>
            <div className="brand-text-wrapper">
              <span className="brand-mark">PRISM</span>
              <span className="brand-subtitle">Prediction and Real-World Intelligence Settlement Market</span>
            </div>
          </a>

          <div className="nav-links">
            <a href="#/landing" className="nav-item active">
              <Globe size={16} /> Home
            </a>
            <a href="#/markets" className="nav-item">
              <TrendingUp size={16} /> Markets
            </a>
            <a href="#/transactions" className="nav-item">
              <Activity size={16} /> History
            </a>
            <a href="#/admin" className="nav-item">
              <ShieldCheck size={16} /> Admin Portal
            </a>
          </div>

          <div className="wallet-wrapper">
            <WalletMultiButton />
          </div>
        </header>

        {/* Existing PRISM Dashboard Workspace */}
        <main className="main-container existing-dashboard animate-fade-in">
          <div className="layout-grid">
            {/* Sidebar Rail */}
            <aside className="sidebar-rail">
              <div className="sidebar-header">
                <h2 className="sidebar-title">
                  <Layers size={18} color="var(--accent-cyan)" /> Markets ({visibleMarkets.length})
                </h2>
                <button type="button" className="refresh-btn" onClick={loadMarkets} title="Refresh Markets">
                  <RefreshCw size={14} /> Refresh
                </button>
              </div>

              {/* Search Box */}
              <div className="search-box">
                <Search className="search-icon" size={16} />
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search markets or topics..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Source Filter Pills */}
              <div className="filter-pills">
                <button
                  type="button"
                  className={`filter-pill ${sourceFilter === "ALL" ? "active" : ""}`}
                  onClick={() => setSourceFilter("ALL")}
                >
                  ALL
                </button>
                <button
                  type="button"
                  className={`filter-pill ${sourceFilter === "POLYMARKET" ? "active" : ""}`}
                  onClick={() => setSourceFilter("POLYMARKET")}
                >
                  POLYMARKET
                </button>
                <button
                  type="button"
                  className={`filter-pill ${sourceFilter === "PRISM" ? "active" : ""}`}
                  onClick={() => setSourceFilter("PRISM")}
                >
                  PRISM NATIVE
                </button>
              </div>

              {/* Category Filter Pills */}
              <div className="filter-pills" style={{ overflowX: "auto" }}>
                {["ALL", "CRYPTO", "POLITICS", "TECH", "SCIENCE"].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`filter-pill ${categoryFilter === cat ? "active" : ""}`}
                    onClick={() => setCategoryFilter(cat)}
                    style={{ fontSize: "0.7rem", padding: "0.25rem 0.4rem" }}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Markets List */}
              {visibleMarkets.length === 0 ? (
                <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--ink-muted)", fontSize: "0.88rem" }}>
                  No markets match your active filters.
                </div>
              ) : (
                <ul className="market-list-scroll">
                  {visibleMarkets.map((m) => {
                    const uniqueId = m.source === "prism" && m.pubkey ? m.pubkey : m.polymarketId;
                    const isSelected = uniqueId === selected;
                    const itemYesPct = (m.yesPrice ? m.yesPrice * 100 : m.priceYesBps / 100).toFixed(0);
                    const itemNoPct = (m.noPrice ? m.noPrice * 100 : 100 - m.priceYesBps / 100).toFixed(0);

                    return (
                      <li key={uniqueId}>
                        <button
                          type="button"
                          className={`market-item-card ${isSelected ? "active" : ""}`}
                          onClick={() => setSelected(uniqueId)}
                        >
                          <div className="market-item-meta">
                            <span className={`source-badge ${m.source === "prism" ? "prism" : ""}`}>
                              {m.source?.toUpperCase() || "POLYMARKET"}
                            </span>
                            <span className={`status-tag ${m.status}`}>{m.status}</span>
                          </div>

                          <div className="market-item-question">{m.aiTitle || m.question}</div>

                          <div className="market-item-odds">
                            <span className="mini-yes">YES {itemYesPct}%</span>
                            <span style={{ color: "var(--ink-muted)" }}>•</span>
                            <span className="mini-no">NO {itemNoPct}%</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            {/* Main Stage */}
            <section className="stage-card">
              <ErrorBoundary>
                {!active ? (
                  <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--ink-muted)" }}>
                    <TrendingUp size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
                    <h2>Select a Market</h2>
                    <p>Choose any prediction market from the left sidebar to view live LMSR prices & trade.</p>
                  </div>
                ) : (
                  <>
                    {/* Top Metadata Header */}
                    <div className="stage-eyebrow-row">
                      <div className="stage-eyebrow">
                        <Sparkles size={16} /> {active.source?.toUpperCase() || "POLYMARKET"} · SOLANA LMSR AMM
                      </div>

                      {active.aiScore !== undefined && active.aiScore !== null && (
                        <div className="ai-score-badge" title={active.aiReason || "AI Curation Score"}>
                          <Sparkles size={14} /> AI Score: {active.aiScore}/100
                        </div>
                      )}
                    </div>

                    {/* Market Title */}
                    <h1 className="stage-title">{active.aiTitle || active.question}</h1>

                    {/* AI Tags */}
                    {active.aiTags && active.aiTags.length > 0 && (
                      <div className="tags-row">
                        {active.aiTags.map((tag, idx) => (
                          <span key={idx} className="tag-chip">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* AI Summary Box */}
                    {active.aiSummary && (
                      <div className="ai-summary-card">
                        <h4>
                          <Sparkles size={14} /> AI Market Overview
                        </h4>
                        <p>{active.aiSummary}</p>
                      </div>
                    )}

                    {/* Expiration & Status Info */}
                    <div style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", display: "flex", gap: "1rem" }}>
                      <span>Ends: <strong>{new Date(active.endTs * 1000).toLocaleString()}</strong></span>
                      <span>Status: <strong style={{ textTransform: "uppercase", color: currentStatus === "open" ? "var(--yes-color)" : currentStatus === "frozen" ? "var(--amber-color)" : "var(--no-color)" }}>{currentStatus}</strong></span>
                    </div>

                    {/* Big Odds Gauge Card */}
                    <div className="odds-gauge-card">
                      <div className="odds-labels-row">
                        <span className="odds-yes-value">YES {yesPct}%</span>
                        <span className="odds-no-value">NO {noPct}%</span>
                      </div>

                      <div className="gauge-track">
                        <div className="gauge-fill-yes" style={{ width: `${yesPctNum}%` }} />
                      </div>
                    </div>

                    {/* Technical Details Toggle */}
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowTechDetails(!showTechDetails)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--ink-muted)",
                          fontSize: "0.8rem",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.4rem",
                          padding: 0
                        }}
                      >
                        <Info size={14} /> {showTechDetails ? "Hide On-Chain Technical Details" : "Show On-Chain Technical Details"}
                      </button>

                      {showTechDetails && (
                        <div className="tech-details-box" style={{ marginTop: "0.75rem" }}>
                          <div>
                            <strong>Market PDA:</strong> <code>{active.pubkey || marketPda(active.polymarketId)[0].toBase58()}</code>
                          </div>
                          <div>
                            <strong>Vault PDA:</strong> <code>{active.pubkey ? vaultPda(new PublicKey(active.pubkey))[0].toBase58() : vaultPda(marketPda(active.polymarketId)[0])[0].toBase58()}</code>
                          </div>
                          <div>
                            <strong>Config PDA:</strong> <code>{configPda()[0].toBase58()}</code>
                          </div>
                          <div>
                            <strong>USDC Mint:</strong> <code>{USDC_MINT.toBase58()}</code>
                          </div>
                          <div>
                            <strong>LMSR b parameter:</strong> <code>{onChainState?.lmsrB || active.lmsr_b || 1000000}</code>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Trade Widget Box */}
                    {(() => {
                      const tradeable = isMarketTradeable(active);
                      const { yesTokenId, noTokenId } = getMarketOutcomeTokenIds(active);
                      const activeTokenId = tradeOutcome === 0 ? yesTokenId : noTokenId;

                      if (currentStatus !== "open") return null;

                      if (!tradeable) {
                        return (
                          <div className="trade-card-box external-market-notice" style={{ padding: "1.5rem", textAlign: "center", color: "var(--ink-secondary)" }}>
                            <p style={{ marginBottom: 0 }}>
                              Trading is currently unavailable for this market.
                            </p>
                          </div>
                        );
                      }

                      return (
                        <div className="trade-card-box">
                          <div className="trade-outcome-toggle">
                            <button
                              type="button"
                              className={`outcome-btn yes-btn ${tradeOutcome === 0 ? "active" : ""}`}
                              onClick={() => setTradeOutcome(0)}
                            >
                              <CheckCircle2 size={18} /> YES {yesPct}%
                            </button>
                            <button
                              type="button"
                              className={`outcome-btn no-btn ${tradeOutcome === 1 ? "active" : ""}`}
                              onClick={() => setTradeOutcome(1)}
                            >
                              <AlertTriangle size={18} /> NO {noPct}%
                            </button>
                          </div>

                          <div className="amount-input-group">
                            <div className="amount-label-row">
                              <span>Share Amount</span>
                              <span>{active.source === "polymarket" ? "Polymarket Order" : "LMSR Collateralized"}</span>
                            </div>

                            <div className="input-with-presets">
                              <input
                                type="text"
                                className="amount-input"
                                value={shares}
                                onChange={(e) => setShares(e.target.value)}
                                inputMode="decimal"
                                placeholder="10"
                              />

                              <div className="preset-pills">
                                {["5", "10", "50", "100", "500"].map((val) => (
                                  <button
                                    key={val}
                                    type="button"
                                    className="preset-pill"
                                    onClick={() => setShares(val)}
                                  >
                                    {val}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Trade Summary Info */}
                          <div className="trade-summary-rows">
                            <div className="summary-row">
                              <span>Total Cost (USDC):</span>
                              <strong>${selectedCost.toFixed(2)} USDC</strong>
                            </div>
                            <div className="summary-row">
                              <span>Avg. Share Price:</span>
                              <strong>${avgPrice.toFixed(2)}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Payout on Win ($1/share):</span>
                              <strong>${toWin.toFixed(2)} USDC</strong>
                            </div>
                            <div className="summary-row highlight">
                              <span>Potential Profit:</span>
                              <strong>+${potentialProfit.toFixed(2)} USDC ({returnPercentage.toFixed(1)}%)</strong>
                            </div>
                            {active.source === "polymarket" && activeTokenId && (
                              <div className="summary-row" style={{ fontSize: "0.75rem", color: "var(--ink-muted)", marginTop: "4px" }}>
                                <span>CLOB Token ID:</span>
                                <code style={{ fontSize: "0.75rem" }}>{activeTokenId.slice(0, 16)}...</code>
                              </div>
                            )}
                          </div>

                          {/* Submit Trade Button */}
                          <button
                            type="button"
                            className={`submit-trade-btn ${tradeOutcome === 0 ? "buy-yes" : "buy-no"}`}
                            disabled={busy}
                            onClick={() => trade("buy", tradeOutcome)}
                          >
                            {busy ? (
                              <RefreshCw className="animate-spin" size={20} />
                            ) : (
                              <>
                                <Coins size={20} /> BUY {tradeOutcome === 0 ? "YES" : "NO"} SHARES
                              </>
                            )}
                          </button>

                          {/* Secondary Sell Actions */}
                          <div className="secondary-sell-btns">
                            <button
                              type="button"
                              className="sell-btn"
                              disabled={busy}
                              onClick={() => trade("sell", 0)}
                            >
                              Sell YES Position
                            </button>
                            <button
                              type="button"
                              className="sell-btn"
                              disabled={busy}
                              onClick={() => trade("sell", 1)}
                            >
                              Sell NO Position
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Frozen Banner */}
                    {currentStatus === "frozen" && (
                      <div style={{ padding: "20px", background: "var(--amber-bg)", border: "1px solid var(--amber-border)", borderRadius: "12px", textAlign: "center" }}>
                        <Lock size={28} color="var(--amber-color)" style={{ marginBottom: "8px" }} />
                        <h3 style={{ margin: "0 0 6px", color: "var(--amber-color)" }}>MARKET TRADING HALTED</h3>
                        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--ink-secondary)" }}>
                          This market reached its end date and is currently frozen awaiting oracle resolution.
                        </p>
                      </div>
                    )}

                    {/* Resolved Banner & Payout Redemption */}
                    {currentStatus === "resolved" && (
                      <div className="trade-card-box">
                        <h3 style={{ margin: 0, fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "8px" }}>
                          <Award size={20} color="var(--accent-cyan)" /> MARKET RESOLVED
                        </h3>

                        <div style={{ fontSize: "1.25rem", fontWeight: 700, color: onChainState?.winningOutcome === 0 ? "var(--yes-color)" : "var(--no-color)" }}>
                          {onChainState?.winningOutcome === 0 ? "✓ YES OUTCOME WON" : onChainState?.winningOutcome === 1 ? "✓ NO OUTCOME WON" : "RESOLVED"}
                        </div>

                        {msg && msg.startsWith("Redeemed winning shares") ? (
                          <div className="redeem-banner">
                            <CheckCircle2 size={32} color="var(--yes-color)" style={{ margin: "0 auto" }} />
                            <h4 style={{ margin: 0, color: "var(--yes-color)" }}>REDEEMED SUCCESSFULLY!</h4>
                            <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>
                              +${msg.split("|")[1] || "0.00"} USDC
                            </div>
                            <div style={{ fontSize: "0.78rem", color: "var(--ink-muted)", wordBreak: "break-all" }}>
                              TX Signature: {msg.split("|")[2] || msg}
                            </div>
                          </div>
                        ) : winningShares > 0 ? (
                          <div className="redeem-banner">
                            <Award size={32} color="var(--yes-color)" style={{ margin: "0 auto" }} />
                            <h4 style={{ margin: 0, color: "var(--yes-color)" }}>YOU HAVE WINNING SHARES!</h4>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem" }}>
                              <span>Winning Shares:</span>
                              <strong>{winningShares.toFixed(2)}</strong>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.1rem", fontWeight: 700, borderTop: "1px dashed var(--yes-color)", paddingTop: "8px" }}>
                              <span>Total Payout:</span>
                              <span style={{ color: "var(--yes-color)" }}>${winningShares.toFixed(2)} USDC</span>
                            </div>

                            <button
                              type="button"
                              className="redeem-btn"
                              disabled={busy || !isRedeemable}
                              onClick={handleRedeem}
                            >
                              {busy ? "Redeeming..." : "REDEEM WINNINGS TO WALLET"}
                            </button>

                            {!isRedeemable && (onChainState?.aiResolutionConfidence ?? 100) < 60 && (
                              <div style={{ fontSize: "0.8rem", color: "var(--no-color)", marginTop: "6px" }}>
                                Redemption locked: AI oracle confidence score below threshold (60%).
                              </div>
                            )}
                          </div>
                        ) : losingShares > 0 ? (
                          <div style={{ padding: "16px", background: "var(--no-bg)", border: "1px solid var(--no-border)", borderRadius: "12px", textAlign: "center" }}>
                            <AlertTriangle size={24} color="var(--no-color)" style={{ marginBottom: "6px" }} />
                            <div style={{ color: "var(--no-color)", fontWeight: 700 }}>POSITION DID NOT WIN</div>
                            <div style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", marginTop: "4px" }}>
                              Your shares burned upon market settlement.
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: "0.88rem", color: "var(--ink-muted)", fontStyle: "italic", textAlign: "center" }}>
                            No active shares remaining to redeem for this market.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Live Position Summary Card */}
                    {position && currentStatus !== "resolved" && active.source !== "polymarket" && (
                      <div className="position-card">
                        <h4 className="position-title">
                          <Coins size={16} color="var(--accent-cyan)" /> Your On-Chain Position
                        </h4>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem" }}>
                          <span>YES Shares:</span>
                          <strong>{userYesShares.toFixed(2)}</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem" }}>
                          <span>NO Shares:</span>
                          <strong>{userNoShares.toFixed(2)}</strong>
                        </div>
                        <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "8px", display: "flex", justifyContent: "space-between", fontSize: "0.88rem" }}>
                          <span>Estimated Value:</span>
                          <strong style={{ color: "var(--accent-cyan)" }}>${(estimatedYesValue + estimatedNoValue).toFixed(2)} USDC</strong>
                        </div>
                      </div>
                    )}

                    {/* System Notification Banner */}
                    {msg && currentStatus !== "resolved" && !msg.startsWith("Redeemed") && (
                      <div className="status-msg-banner">
                        {msg}
                      </div>
                    )}

                    {/* Recent Activity Feed */}
                    {active.source !== "polymarket" && (
                      <MarketActivity
                        market={active}
                        marketPda={active.pubkey || marketPda(active.polymarketId)[0].toBase58()}
                        refreshTrigger={refreshCounter}
                      />
                    )}

                    {/* Authenticated User Comment Section */}
                    {active && (() => {
                      console.log("[COMMENTS] MARKET OBJECT:", active);
                      return (
                        <CommentSection
                          marketId={active.polymarketId || active.pubkey || ""}
                        />
                      );
                    })()}
                  </>
                )}
              </ErrorBoundary>
            </section>
          </div>
        </main>
      </PRISMBackground>
    );
  }
