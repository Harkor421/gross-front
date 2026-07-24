import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Gross income, the token that files an income statement.
 * Trading fees are the gross. 50% goes to DEX boosts and marketing (the
 * growth wallet), 50% goes to holders as $1 drops of ETH every 5 minutes,
 * biggest bag first. Holder payouts are the bottom line. Live over
 * WebSocket (gross-back); demo offline.
 */

// patched after Railway domain exists
const WS_URL = import.meta.env.VITE_WS_URL || "wss://GROSS-BACK-URL-TBD";
const STATIC_CA = import.meta.env.VITE_CA || "";
const BUY_BASE = (import.meta.env.VITE_BUY_URL || "https://www.noxa.fun").replace(/\/$/, "");
const EXPLORER = (import.meta.env.VITE_EXPLORER || "https://robinhoodchain.blockscout.com").replace(/\/$/, "");
const TICKER = (import.meta.env.VITE_TICKER || "GROSS").toUpperCase();
const TAGLINE = "Half the fees go to growth, half go to you. Gross in, split in two, straight on-chain.";

export default function App() {
  const [wsStatus, setWsStatus] = useState("connecting");
  const [demo, setDemo] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef({ tries: 0, timer: null });
  const demoTimerRef = useRef(null);

  const [mint, setMint] = useState(STATIC_CA);
  const [holders, setHolders] = useState([]);
  const [holderCount, setHolderCount] = useState(null);
  const [eligibleCount, setEligibleCount] = useState(null);
  const [cycle, setCycle] = useState(null); // cycle_state message from the dispenser
  const [payments, setPayments] = useState([]);
  const [copied, setCopied] = useState(false);
  const [lookup, setLookup] = useState("");
  const [toasts, setToasts] = useState([]);
  const nowTick = useNow(1000);
  const toastId = useRef(0);

  const connected = wsStatus === "connected";

  function pushToast(t) {
    const id = ++toastId.current;
    setToasts((p) => [...p, { id, ...t }].slice(-4));
    if (t.sound) playChaChing();
    const life = t.big ? 8000 : 5200;
    setTimeout(() => setToasts((p) => p.map((x) => (x.id === id ? { ...x, leaving: true } : x))), life - 380);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), life);
  }

  /* ------------------------------- sound -------------------------------- */
  const [soundOn, setSoundOn] = useState(() => {
    try { return localStorage.getItem("gross-sound") !== "off"; } catch { return true; }
  });
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;
  const audioRef = useRef(null);
  function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioRef.current) audioRef.current = new AC();
    if (audioRef.current.state === "suspended") audioRef.current.resume().catch(() => {});
    return audioRef.current;
  }
  // browsers keep audio locked until a user gesture, unlock on the first tap
  useEffect(() => {
    const unlock = () => {
      if (soundOnRef.current) ensureAudio();
      window.removeEventListener("pointerdown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);
  function toggleSound() {
    setSoundOn((v) => {
      const next = !v;
      try { localStorage.setItem("gross-sound", next ? "on" : "off"); } catch {}
      if (next) ensureAudio();
      return next;
    });
  }
  // cash-register chime, synthesized: C6-E6-G6 triangle arpeggio, fast decay
  function playChaChing() {
    if (!soundOnRef.current) return;
    const ctx = ensureAudio();
    if (!ctx || ctx.state !== "running") return;
    const t0 = ctx.currentTime;
    for (const [freq, dt] of [[1046.5, 0], [1318.5, 0.09], [1568, 0.18]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + dt);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + dt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + dt);
      osc.stop(t0 + dt + 0.4);
    }
  }

  /* ------------------------------ websocket ----------------------------- */
  useEffect(() => {
    connectWS();
    demoTimerRef.current = setTimeout(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) enterDemo();
    }, 1200);
    return () => {
      try {
        wsRef.current?.close(1000, "shutdown");
        clearTimeout(reconnectRef.current.timer);
        clearTimeout(demoTimerRef.current);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connectWS() {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    let sock;
    try {
      sock = new WebSocket(WS_URL);
    } catch {
      return scheduleReconnect();
    }
    wsRef.current = sock;
    sock.addEventListener("open", () => {
      setWsStatus("connected");
      setDemo(false);
      reconnectRef.current.tries = 0;
    });
    sock.addEventListener("message", (ev) => {
      try {
        handleMessage(JSON.parse(ev.data));
      } catch {}
    });
    sock.addEventListener("close", () => {
      setWsStatus("disconnected");
      scheduleReconnect();
    });
    sock.addEventListener("error", () => {
      try {
        sock.close();
      } catch {}
    });
  }
  function scheduleReconnect() {
    const n = (reconnectRef.current.tries = (reconnectRef.current.tries || 0) + 1);
    reconnectRef.current.timer = setTimeout(connectWS, Math.min(1000 * 2 ** (n - 1), 10000));
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case "service_status":
        if (msg.ca && !STATIC_CA) setMint(msg.ca);
        return;
      case "holders_update": {
        setHolders(Array.isArray(msg.holders) ? msg.holders : []);
        if (Number.isFinite(msg.totalHolders)) setHolderCount(msg.totalHolders);
        if (Number.isFinite(msg.eligibleHolders)) setEligibleCount(msg.eligibleHolders);
        if (msg.mint && !STATIC_CA) setMint(msg.mint);
        return;
      }
      case "cycle_state":
        setCycle(msg);
        return;
      case "distribution_result":
        if (msg.count > 0)
          pushToast({
            big: msg.count >= 10,
            sound: true,
            title: `$${fmtNum(msg.totalUsd)} TO HOLDERS`,
            body: `${msg.count} holder${msg.count === 1 ? "" : "s"} got their dollar${msg.ranOut ? ", then the pot ran dry" : ""}. The bottom line just grew.`,
          });
        return;
      case "payments_update":
        if (Array.isArray(msg.payments) && msg.payments.length)
          setPayments((prev) => [...prev, ...msg.payments].slice(-200));
        return;
      case "growth_sweep": {
        // 50% of gross swept to the growth wallet: a BOOST line item
        const item = { kind: "boost", usd: msg.usd, eth: msg.eth, sig: msg.sig, ts: msg.ts || Date.now() };
        setPayments((prev) => [...prev, item].slice(-200));
        if (Number.isFinite(msg.growthUsdTotal))
          setCycle((prev) =>
            prev
              ? {
                  ...prev,
                  growthEthTotal: Number.isFinite(msg.growthEthTotal) ? msg.growthEthTotal : prev.growthEthTotal,
                  growthUsdTotal: msg.growthUsdTotal,
                  grossUsdTotal: (prev.paidUsdTotal ?? 0) + msg.growthUsdTotal,
                }
              : prev
          );
        if (msg.usd > 0)
          pushToast({
            title: `$${fmtNum(msg.usd)} TO GROWTH`,
            body: "Boost budget funded. DEX boosts and marketing, paid straight from fees.",
          });
        return;
      }
      default:
        return;
    }
  }

  /* ------------------------------ demo mode ----------------------------- */
  const demoRef = useRef({ potEth: 0.0052, ethUsd: 3600, nextPayTs: 0, paidUsd: 8214, payouts: 8214, growthUsd: 7930, cycleN: 0 });
  function demoState(d) {
    return {
      type: "cycle_state",
      potEth: d.potEth,
      potUsd: d.potEth * d.ethUsd,
      ethUsd: d.ethUsd,
      payoutUsd: 1,
      payEveryMs: 300000,
      nextPayTs: d.nextPayTs,
      coverage: Math.floor(d.potEth * d.ethUsd),
      eligibleHolders: 20,
      minEligiblePct: 0,
      paidUsdTotal: d.paidUsd,
      paidEthTotal: d.paidUsd / d.ethUsd,
      payoutsTotal: d.payouts,
      growthPct: 50,
      growthEthTotal: d.growthUsd / d.ethUsd,
      growthUsdTotal: d.growthUsd,
      grossUsdTotal: d.paidUsd + d.growthUsd,
      mcapUsd: 92_500,
      running: true,
      dryRun: true,
      ts: Date.now(),
    };
  }
  function enterDemo() {
    setDemo(true);
    const d = demoRef.current;
    d.nextPayTs = Date.now() + 45_000;
    const hs = makeDemoHolders();
    setHolders(hs);
    setHolderCount(1187);
    setEligibleCount(hs.length);
    setCycle(demoState(d));
    const seed = hs.slice(0, 8).map((h, i) => ({
      to: h.owner,
      usd: 1,
      eth: 1 / d.ethUsd,
      rank: h.rank,
      sig: `demo-${i}`,
      ts: Date.now() - (8 - i) * 45000,
    }));
    seed.splice(5, 0, { kind: "boost", usd: 42, eth: 42 / d.ethUsd, sig: "demo-boost-0", ts: Date.now() - 3 * 45000 });
    setPayments(seed);
  }
  useEffect(() => {
    if (!demo) return;
    const id = setInterval(() => {
      const d = demoRef.current;
      d.potEth += 0.00012 + Math.random() * 0.0004; // fees trickling in
      if (Date.now() >= d.nextPayTs) {
        d.nextPayTs = Date.now() + 45_000; // fast cycle so the preview stays alive
        const hs = holdersRef.current;
        const count = Math.min(Math.floor(d.potEth * d.ethUsd), hs.length);
        if (count > 0) {
          d.potEth -= count / d.ethUsd;
          d.paidUsd += count;
          d.payouts += count;
          demoBurst(count);
          pushToast({
            sound: true,
            title: `$${count} TO HOLDERS`,
            body: `${count} holders got their dollar${count < hs.length ? ", then the pot ran dry" : ""}. The bottom line just grew.`,
          });
        }
        // every few cycles the other half sweeps to the growth wallet
        d.cycleN += 1;
        if (d.cycleN % 3 === 0) {
          const sweep = Math.round(18 + Math.random() * 42);
          d.growthUsd += sweep;
          setPayments((prev) =>
            [...prev, { kind: "boost", usd: sweep, eth: sweep / d.ethUsd, sig: `sim-boost-${Date.now().toString(16)}`, ts: Date.now() }].slice(-200)
          );
          pushToast({
            title: `$${sweep} TO GROWTH`,
            body: "Boost budget funded. DEX boosts and marketing, paid straight from fees.",
          });
        }
      }
      setCycle(demoState(d));
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);
  const holdersRef = useRef([]);
  holdersRef.current = holders;
  function demoBurst(count) {
    const d = demoRef.current;
    const pays = holdersRef.current.slice(0, count).map((h) => ({
      to: h.owner,
      usd: 1,
      eth: 1 / d.ethUsd,
      rank: h.rank,
      sig: `sim-${Date.now().toString(16)}-${h.owner.slice(2, 6)}`,
      ts: Date.now(),
    }));
    setHolders((prev) => prev.map((h) => (h.rank <= count ? { ...h, paidUsd: (h.paidUsd || 0) + 1 } : h)));
    setPayments((prev) => [...prev, ...pays].slice(-200));
  }

  /* ------------------------------- derived ------------------------------ */
  const displayCA = mint || "";
  const buyUrl = displayCA ? `${BUY_BASE}/token/${displayCA}` : BUY_BASE;
  const live = Boolean(cycle?.running);
  const potEth = cycle?.potEth ?? null;
  const potUsd = cycle?.potUsd ?? null;
  const payoutUsd = cycle?.payoutUsd ?? 1;
  const coverage = cycle?.coverage ?? null;
  const paidUsd = cycle?.paidUsdTotal ?? 0;
  const payoutsTotal = cycle?.payoutsTotal ?? 0;
  const growthUsd = cycle?.growthUsdTotal ?? 0;
  const growthPct = cycle?.growthPct ?? 50;
  const grossUsd = cycle?.grossUsdTotal ?? paidUsd + growthUsd;
  const paySecs = cycle?.nextPayTs ? Math.max(0, Math.ceil((cycle.nextPayTs - nowTick) / 1000)) : null;
  const minPct = cycle?.minEligiblePct ?? 0;
  const paidAnim = useCountUp(paidUsd, 900);
  const growthAnim = useCountUp(growthUsd, 900);
  const grossAnim = useCountUp(grossUsd, 900);
  // "holders" the human way: eligible wallets (contracts and pools don't count)
  const holdersAnim = useCountUp(eligibleCount ?? 0, 900);
  const payoutsAnim = useCountUp(payoutsTotal, 900);
  const feed = useMemo(() => [...payments].slice(-40).reverse(), [payments]);
  const lookupResult = useMemo(() => {
    const q = lookup.trim().toLowerCase();
    if (!q) return null;
    return holders.find((h) => h.owner.toLowerCase() === q) || null;
  }, [lookup, holders]);
  // the rendered line: filter as you type, cap the DOM, never hide the count
  const filteredLine = useMemo(() => {
    const q = lookup.trim().toLowerCase();
    if (!q) return holders;
    return holders.filter((h) => h.owner.toLowerCase().includes(q));
  }, [lookup, holders]);
  const visibleLine = filteredLine.slice(0, 300);
  const hiddenLine = filteredLine.length - visibleLine.length;

  const copyCA = async () => {
    if (!displayCA) return;
    try {
      await navigator.clipboard.writeText(displayCA);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  /* -------------------------------- render ------------------------------ */
  return (
    <div className="wrap">
      {/* black ticker bar, terms of the deal on repeat */}
      <div className="tape" aria-hidden="true">
        <div className="tape-track">
          {[0, 1].map((rep) => (
            <span key={rep} className="tape-group">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="tape-item">
                  HOLD ${TICKER}, GET THE BOTTOM LINE <i className="tape-dot">$</i> FEES SPLIT 50/50 <i className="tape-dot">$</i> HALF TO GROWTH, HALF TO YOU <i className="tape-dot">$</i> NO CLAIMING <i className="tape-dot">$</i>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <header className="nav">
        <a className="brand" href="#top">
          <Mark size={34} className="brand-mark" />
          <span className="brand-name">Gross <em>income</em></span>
        </a>
        <nav className="nav-r">
          <button className="sound-btn" onClick={toggleSound} aria-label={soundOn ? "Mute payout sound" : "Unmute payout sound"} title={soundOn ? "payout sound: on" : "payout sound: off"}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 9v6h4l5 4.5v-15L8 9H4Z" fill="currentColor" />
              {soundOn ? (
                <>
                  <path d="M16 9c1.3 1 1.3 5 0 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M18.6 6.6c2.4 2.2 2.4 8.6 0 10.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </>
              ) : (
                <path d="M16.5 9.5 21 14.5M21 9.5l-4.5 5" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
              )}
            </svg>
          </button>
          <a className="nav-link" href="#split">Where it goes</a>
          <a className="nav-link" href="#items">Line items</a>
          <a className="nav-link" href="#spot">The line</a>
          <a className="btn chunky" href={buyUrl} target="_blank" rel="noreferrer">GET ${TICKER}</a>
        </nav>
      </header>

      <main className="page" id="top">
        {/* hero: pitch left, live income statement right */}
        <section className="hero">
          <div className="hero-l">
            <Reveal><span className="eyebrow">the token that files an income statement</span></Reveal>
            <Reveal delay={0.08}><h1 className="mega">
              <span className="mega-line">GROSS IN.</span>
              <span className="mega-line hot">SPLIT IN TWO.</span>
              <span className="mega-line">PAID OUT.</span>
            </h1></Reveal>
            <Reveal delay={0.14}><p className="tagline">{TAGLINE}</p></Reveal>
            <Reveal delay={0.2}><p className="hero-sub">
              <strong>Gross income</strong> keeps one set of books. Trading fees are the
              gross. <strong>{fmtNum(growthPct)}%</strong> buys DEX boosts and marketing from the
              growth wallet. The other half pays holders <strong>$1 in ETH every 5
              minutes</strong>, biggest bag first, until the pot runs dry. Holder payouts
              are <strong>the bottom line</strong>. No staking. No claiming.
            </p></Reveal>
            <Reveal delay={0.26} className="hero-cta">
              <a className="btn chunky big" href={buyUrl} target="_blank" rel="noreferrer">GET ${TICKER}</a>
              <a className="btn hollow" href="#split">where every fee goes</a>
            </Reveal>
            {displayCA && (
              <Reveal delay={0.3}><button className={`ca ${copied ? "copied" : ""}`} onClick={copyCA}>
                <span className="ca-tag">CA</span>
                <span className="ca-val">{displayCA}</span>
                <span className="ca-copy">{copied ? "copied!" : "copy"}</span>
              </button></Reveal>
            )}
            <Reveal delay={0.34} className="stamps">
              <span className="stamp green">PAID</span>
              <span className="stamp">SPLIT 50/50</span>
              <span className="stamp">AUDITED BY NOBODY</span>
            </Reveal>
          </div>

          <Reveal delay={0.15}>
          <aside className="statement" id="statement">
            <span className="st-stamp stamp green">SPLIT 50/50</span>
            <div className="st-head">
              <span className="st-title">Income statement</span>
              <span className={`led ${live ? "on" : ""}`}>{live ? "● LIVE" : demo ? "● PREVIEW" : "○ FILING"}</span>
            </div>
            <div className="st-period">all time, USD, settled in ETH on-chain</div>
            <div className="st-rows">
              <div className="ir">
                <span>Gross fees</span><span className="ir-dots" /><b>${fmtNum(grossAnim)}</b>
              </div>
              <div className="ir less">
                <span>Less: growth and marketing ({fmtNum(growthPct)}%)</span><span className="ir-dots" /><b>(${fmtNum(growthAnim)})</b>
              </div>
              <div className="ir bottom">
                <span>Net to holders, the bottom line</span><span className="ir-dots" /><b>${fmtNum(paidAnim)}</b>
              </div>
            </div>
            <div className="st-now">
              <div className="dr">
                <span>Current pot</span>
                <b>{potEth == null ? "..." : `${fmtQty(potEth)} ETH ($${fmtNum(potUsd)})`}</b>
              </div>
              <div className="dr">
                <span>Covers this drop</span>
                <b>{coverage == null ? "..." : `${Math.min(coverage, eligibleCount ?? coverage).toLocaleString()} of ${(eligibleCount ?? 0).toLocaleString()} holders`}</b>
              </div>
              <div className="dr">
                <span>Payout</span>
                <b>${fmtNum(payoutUsd)} per holder</b>
              </div>
            </div>
            <div className="st-timer">
              <span className="dt-label">next $1 drop in</span>
              <span className={`dt-clock ${paySecs != null && paySecs <= 10 ? "soon" : ""}`}>{paySecs == null ? "--:--" : fmtClock(paySecs)}</span>
            </div>
            <p className="st-note">
              {live
                ? `Paid top down by bag size. ${minPct > 0 ? `Hold at least ${minPct}% of $${TICKER} and you're in the line.` : `Any bag counts, every holder is in the line.`}`
                : `The books open the moment $${TICKER} trades. Get your spot in line.`}
            </p>
          </aside>
          </Reveal>
        </section>

        {/* stat strip */}
        <section className="stats">
          <Reveal><div className="stat"><b>{eligibleCount == null ? "..." : Math.round(holdersAnim).toLocaleString()}</b><span>holders</span></div></Reveal>
          <Reveal delay={0.06}><div className="stat"><b>{payoutsTotal ? Math.round(payoutsAnim).toLocaleString() : "..."}</b><span>holders paid</span></div></Reveal>
          <Reveal delay={0.12}><div className="stat"><b className="pos">{paidUsd ? `$${fmtNum(paidAnim)}` : "..."}</b><span>to holders</span></div></Reveal>
          <Reveal delay={0.18}><div className="stat"><b className="neg">{growthUsd ? `$${fmtNum(growthAnim)}` : "..."}</b><span>to growth</span></div></Reveal>
        </section>

        {/* the split, animated */}
        <section className="split" id="split">
          <Reveal><h2 className="h2"><span className="kick">ITEM 01</span>WHERE EVERY FEE GOES</h2></Reveal>
          <Reveal delay={0.1} className="sdfig-wrap"><SplitDiagram ticker={TICKER} /></Reveal>
          <Reveal className="math" delay={0.15}>gross fees x 50% = growth wallet · gross fees x 50% = $1 drops every 5 minutes · biggest bag first · no claiming</Reveal>
        </section>

        {/* line items feed: payments + BOOST sweeps */}
        <section className="paid" id="items">
          <Reveal className="paid-head">
            <h2 className="h2"><span className="kick">ITEM 02</span>LINE ITEMS</h2>
            <div className="paid-total">
              <span className="pt-num">${fmtNum(paidAnim)}</span>
              <span className="pt-l">{payoutsTotal > 0 ? `net to holders, ${payoutsTotal.toLocaleString()} payouts posted, $${fmtNum(growthAnim)} to growth` : "the ledger starts at launch"}</span>
            </div>
          </Reveal>
          <Reveal delay={0.1} className="receipt">
            <div className="feed">
              {feed.length ? feed.map((p, i) => (
                p.kind === "boost" ? (
                  <div className="f-row boost" key={`${p.sig}-${i}`}>
                    <span className="f-tag boost">BOOST</span>
                    <span className="f-amt">${fmtNum(p.usd)}</span>
                    <span className="f-dim">→</span>
                    <span className="f-to plain">growth wallet</span>
                    <span className="f-note">DEX boosts + marketing</span>
                    <span className="f-eth">{fmtQty(p.eth)} ETH</span>
                    <span className="f-time">{fmtTime(p.ts)}</span>
                    {isSim(p.sig) ? (
                      <span className="f-tx sim">sim</span>
                    ) : (
                      <a className="f-tx" href={`${EXPLORER}/tx/${encodeURIComponent(p.sig)}`} target="_blank" rel="noreferrer">tx ↗</a>
                    )}
                  </div>
                ) : (
                  <div className="f-row" key={`${p.sig}-${i}`}>
                    <span className="f-tag">PAID</span>
                    <span className="f-amt">${fmtNum(p.usd ?? 1)}</span>
                    <span className="f-dim">→</span>
                    <a className="f-to" href={`${EXPLORER}/address/${p.to}`} target="_blank" rel="noreferrer">
                      {shortAddr(p.to)}
                    </a>
                    {p.rank != null && <span className="f-rank">#{p.rank}</span>}
                    <span className="f-eth">{fmtQty(p.eth)} ETH</span>
                    <span className="f-time">{fmtTime(p.ts)}</span>
                    {isSim(p.sig) ? (
                      <span className="f-tx sim">sim</span>
                    ) : (
                      <a className="f-tx" href={`${EXPLORER}/tx/${encodeURIComponent(p.sig)}`} target="_blank" rel="noreferrer">tx ↗</a>
                    )}
                  </div>
                )
              )) : (
                <div className="f-empty">{connected ? "First line item posts after launch…" : "Opening the books…"}</div>
              )}
            </div>
          </Reveal>
        </section>

        {/* the line: every holder ranked, scroll it, find yourself */}
        <section className="spot" id="spot">
          <Reveal>
          <h2 className="h2"><span className="kick">ITEM 03</span>THE LINE</h2>
          <p className="spot-sub">Every holder is in line, any bag counts. Sorted by bag size, paid top down. Scroll the line or search your wallet.</p>
          <div className="checker">
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="0xYourWallet…"
              spellCheck={false}
            />
            {lookup && (
              <button className="checker-x" onClick={() => setLookup("")} aria-label="Clear">×</button>
            )}
          </div>
          {lookup.trim() && (
            <SpotResult holder={lookupResult} query={lookup.trim()} coverage={coverage} payoutUsd={payoutUsd} minPct={minPct} />
          )}
          <div className="line-list">
            {visibleLine.length ? (
              <>
                {visibleLine.map((h) => (
                  <div className="l-row" key={h.owner}>
                    <span className={`l-rank ${coverage != null && h.rank <= coverage ? "in" : ""}`}>#{h.rank}</span>
                    <a className="l-addr" href={`${EXPLORER}/address/${h.owner}`} target="_blank" rel="noreferrer">{shortAddr(h.owner)}</a>
                    <span className="l-pct">{(h.percentage ?? 0).toFixed(2)}%</span>
                    <span className="l-paid">${fmtNum(h.paidUsd || 0)}</span>
                  </div>
                ))}
                {hiddenLine > 0 && <div className="l-more">+ {hiddenLine.toLocaleString()} more in line</div>}
              </>
            ) : (
              <div className="f-empty">
                {lookup.trim() ? "No wallet in the line matches that." : connected ? "The line forms as wallets pick up $" + TICKER + "…" : "Opening the books…"}
              </div>
            )}
          </div>
          <p className="line-legend">rank · wallet · % of supply · $ collected. Green rank = this drop reaches that spot.</p>
          </Reveal>
        </section>
      </main>

      <footer className="foot">
        <Mark size={40} className="foot-mark" />
        <p>© 2026 Gross income. Gross income, not financial advice. Fees move, figures update, the risk stays yours.</p>
      </footer>

      {/* toasts */}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div className={`toast ${t.big ? "big" : ""} ${t.leaving ? "out" : ""}`} key={t.id}>
            <span className="toast-mark" aria-hidden="true">$</span>
            <div>
              <div className="toast-t">{t.title}</div>
              <div className="toast-b">{t.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ pieces --------------------------------- */
/* blur-fade reveal on scroll (Magic UI-style BlurFade, no deps) */
function Reveal({ className = "", delay = 0, children, ...rest }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -36px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`rev ${inView ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}s` }} {...rest}>
      {children}
    </div>
  );
}

/* the mark: a green dollar on a ledger page, same drawing as public/logo.svg */
function Mark({ size = 28, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <rect width="120" height="120" rx="22" fill="#faf8f2" />
      <rect x="6" y="6" width="108" height="108" rx="17" fill="none" stroke="#1a1c18" strokeWidth="4" />
      <line x1="24" y1="32" x2="96" y2="32" stroke="#ddd8c9" strokeWidth="3" />
      <line x1="24" y1="48" x2="96" y2="48" stroke="#ddd8c9" strokeWidth="3" />
      <text x="60" y="84" fontFamily="Georgia, 'Times New Roman', serif" fontSize="62" fontWeight="bold" textAnchor="middle" fill="#0e7a3b">$</text>
      <line x1="32" y1="95" x2="88" y2="95" stroke="#0e7a3b" strokeWidth="4" />
      <line x1="32" y1="102" x2="88" y2="102" stroke="#0e7a3b" strokeWidth="2.5" />
    </svg>
  );
}

/* the mechanic in one animated scene: fees stream into the splitter and
   fork 50/50 into the GROWTH and HOLDERS lanes. Timings live in CSS sd-*. */
function SplitDiagram({ ticker = "GROSS" }) {
  return (
    <svg
      className="sdfig"
      viewBox="0 0 960 430"
      role="img"
      aria-label={`Trades of $${ticker} generate fees. Every fee is split 50/50: half to the growth wallet for DEX boosts and marketing, half to holders as $1 drops every 5 minutes, biggest bag first.`}
    >
      {/* lanes */}
      <path className="sd-dash" d="M 210 215 L 396 215" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <path className="sd-dash lane-g" d="M 564 196 C 640 182, 664 140, 736 114" fill="none" stroke="var(--stamp)" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <path className="sd-dash lane-h" d="M 564 234 C 640 248, 664 292, 736 316" fill="none" stroke="var(--ledger)" strokeWidth="2" strokeLinecap="round" opacity="0.7" />

      {/* fees source */}
      <g className="sd-box">
        <rect x="40" y="170" width="170" height="92" rx="3" fill="#fffefb" stroke="var(--ink)" strokeWidth="2.5" />
        <text className="sd-title" x="125" y="206" textAnchor="middle" fontSize="19">TRADING FEES</text>
        <text className="sd-small" x="125" y="230" textAnchor="middle" fontSize="11.5">every buy, every sell</text>
        <text className="sd-small" x="125" y="248" textAnchor="middle" fontSize="11.5">the gross, in ETH</text>
      </g>

      {/* the splitter */}
      <g className="sd-box">
        <rect x="402" y="168" width="160" height="96" rx="3" fill="#fffefb" stroke="var(--ink)" strokeWidth="2.5" />
        <rect x="408" y="174" width="148" height="84" rx="2" fill="none" stroke="var(--ink)" strokeWidth="1" opacity="0.35" />
        <text className="sd-title" x="482" y="204" textAnchor="middle" fontSize="18">THE SPLIT</text>
        <text className="sd-big" x="482" y="242" textAnchor="middle" fontSize="26">50 / 50</text>
      </g>

      {/* lane % chips */}
      <g className="sd-chip">
        <rect x="622" y="136" width="44" height="24" rx="3" fill="#fffefb" stroke="var(--stamp)" strokeWidth="1.5" />
        <text className="sd-mono" x="644" y="152" textAnchor="middle" fontSize="12" fill="var(--stamp)">50%</text>
      </g>
      <g className="sd-chip">
        <rect x="622" y="268" width="44" height="24" rx="3" fill="#fffefb" stroke="var(--ledger)" strokeWidth="1.5" />
        <text className="sd-mono" x="644" y="284" textAnchor="middle" fontSize="12" fill="var(--ledger)">50%</text>
      </g>

      {/* growth lane */}
      <g className="sd-box sd-gbox">
        <rect x="740" y="62" width="190" height="100" rx="3" fill="#fffefb" stroke="var(--stamp)" strokeWidth="2.5" />
        <text className="sd-title" x="835" y="94" textAnchor="middle" fontSize="18" fill="var(--stamp)">GROWTH</text>
        <text className="sd-small" x="835" y="118" textAnchor="middle" fontSize="11.5">DEX boosts</text>
        <text className="sd-small" x="835" y="136" textAnchor="middle" fontSize="11.5">marketing</text>
        <text className="sd-small" x="835" y="154" textAnchor="middle" fontSize="10.5" opacity="0.7">the growth wallet</text>
      </g>

      {/* holders lane */}
      <g className="sd-box sd-hbox">
        <rect x="740" y="268" width="190" height="100" rx="3" fill="#fffefb" stroke="var(--ledger)" strokeWidth="2.5" />
        <text className="sd-title" x="835" y="300" textAnchor="middle" fontSize="18" fill="var(--ledger)">HOLDERS</text>
        <text className="sd-small" x="835" y="324" textAnchor="middle" fontSize="11.5">$1 every 5 minutes</text>
        <text className="sd-small" x="835" y="342" textAnchor="middle" fontSize="11.5">biggest bag first</text>
        <text className="sd-small" x="835" y="360" textAnchor="middle" fontSize="10.5" opacity="0.7">the bottom line</text>
      </g>

      {/* fee dollars in flight */}
      {["sd-in1", "sd-in2", "sd-in3"].map((c) => (
        <g key={c} className={`sd-coin ${c}`} transform="translate(214,215)">
          <circle r="12" fill="var(--ledger)" stroke="var(--ledger-deep)" strokeWidth="2" />
          <text className="sd-mono" y="4.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fffefb">$</text>
        </g>
      ))}
      {["sd-up1", "sd-up2"].map((c) => (
        <g key={c} className={`sd-coin ${c}`} transform="translate(564,196)">
          <circle r="12" fill="var(--stamp)" stroke="var(--stamp-deep)" strokeWidth="2" />
          <text className="sd-mono" y="4.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fffefb">$</text>
        </g>
      ))}
      {["sd-dn1", "sd-dn2"].map((c) => (
        <g key={c} className={`sd-coin ${c}`} transform="translate(564,234)">
          <circle r="12" fill="var(--ledger)" stroke="var(--ledger-deep)" strokeWidth="2" />
          <text className="sd-mono" y="4.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fffefb">$</text>
        </g>
      ))}
    </svg>
  );
}

function SpotResult({ holder, query, coverage, payoutUsd, minPct }) {
  if (!holder) {
    return (
      <div className="spot-res miss">
        <b>{query.length > 16 ? shortAddr(query) : query}</b> isn't in the line yet.{" "}
        {minPct > 0
          ? `It holds less than ${minPct}% of the supply. Top up and the next drop includes you automatically.`
          : `Any bag counts: grab some and the next drop includes you automatically.`}
      </div>
    );
  }
  const covered = coverage != null && holder.rank <= coverage;
  return (
    <div className="spot-res">
      <div className="spot-grid">
        <div>
          <span className="sg-l">spot in line</span>
          <span className="sg-v">#{holder.rank}</span>
        </div>
        <div>
          <span className="sg-l">holds</span>
          <span className="sg-v">{holder.percentage?.toFixed(2)}%</span>
        </div>
        <div>
          <span className="sg-l">next drop</span>
          <span className={`sg-v ${covered ? "hi" : ""}`}>
            {coverage == null ? "..." : covered ? `$${fmtNum(payoutUsd)} incoming` : "pot's short"}
          </span>
        </div>
        <div>
          <span className="sg-l">collected so far</span>
          <span className="sg-v hi">${fmtNum(holder.paidUsd || 0)}</span>
        </div>
      </div>
      {!covered && coverage != null && (
        <p className="spot-note">
          The pot covers {coverage.toLocaleString()} spot{coverage === 1 ? "" : "s"} right now. About{" "}
          <b>${fmtNum((holder.rank - coverage) * payoutUsd)}</b> more in fees and the line reaches you.
        </p>
      )}
    </div>
  );
}

/* ------------------------------- hooks --------------------------------- */
function useNow(ms) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}
function useCountUp(target, duration = 800) {
  const [val, setVal] = useState(typeof target === "number" ? target : 0);
  const fromRef = useRef(typeof target === "number" ? target : 0);
  const rafRef = useRef(0);
  useEffect(() => {
    if (typeof target !== "number") return;
    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      const e = 1 - Math.pow(1 - t, 3);
      setVal(from + (to - from) * e);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return val;
}

/* ------------------------------- utils --------------------------------- */
function shortAddr(s) {
  return s && s.length > 12 ? `${s.slice(0, 5)}…${s.slice(-4)}` : s || "...";
}
function isSim(sig) {
  const s = String(sig || "");
  return s.startsWith("demo") || s.startsWith("sim") || s.startsWith("0xSIM") || s.startsWith("sent-");
}
function fmtNum(n) {
  const v = Number(n || 0);
  if (!isFinite(v)) return "0";
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
  if (Math.abs(v) >= 10) return v.toFixed(0);
  return v.toFixed(2);
}
function fmtQty(n) {
  const v = Number(n || 0);
  if (!isFinite(v) || v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (a >= 1000) return Math.round(v).toLocaleString();
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(3);
  return v.toFixed(5);
}
function fmtClock(t) {
  const s = Math.max(0, Math.floor(t));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
function fmtTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function makeDemoHolders() {
  const addr = () => "0x" + Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  const rows = [];
  const N = 20;
  for (let i = 0; i < N; i++) {
    const pct = Math.max(0.12, Number((8.5 * Math.pow(0.87, i) + Math.random() * 0.4).toFixed(2)));
    rows.push({ owner: addr(), percentage: pct });
  }
  rows.sort((a, b) => b.percentage - a.percentage);
  return rows.map((r, i) => ({ ...r, rank: i + 1, amount: r.percentage, paidUsd: Math.max(0, 400 - i * 21), paidCount: 0 }));
}
