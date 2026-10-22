// ─────────────────────────────────────────────────────────────
// SH STOCK · UI
// ─────────────────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const byCode = Object.fromEntries(STOCKS.map(s => [s.code, s]));
const SECTORS = [...new Set(STOCKS.map(s => s.sector))].sort();
window.NEWS = window.NEWS || {};
const hasNews = code => !!NEWS[code];
// 종목별 상세 파일(app/detail/<코드>.js: 1년 주가·뉴스·공시)은 종목을 열 때만 불러온다
const DETAIL_STATE = {};
const detailFile = code => "detail/" + code.replace(/[^A-Za-z0-9_-]/g, "_") + ".js";
function loadDetail(code) {
  if (DETAIL_STATE[code]) return DETAIL_STATE[code];
  return (DETAIL_STATE[code] = new Promise(res => {
    const sc = document.createElement("script");
    sc.src = detailFile(code) + "?v=" + encodeURIComponent(DATA_ASOF);
    sc.onload = () => {
      const d = window.DETAIL && window.DETAIL[code], s = byCode[code];
      if (d && s) { s.hist = d.hist; NEWS[code] = { news: d.news || [], disc: d.disc || [] }; }
      res(!!d);
    };
    sc.onerror = () => res(false);
    document.body.appendChild(sc);
  }));
}
function neededDetails() {
  if (state.view === "buy") return [state.buy];
  if (state.view === "sell") return [state.sell];
  if (state.view === "my" && state.myTab === "cmp") return state.cmp;
  return [];
}
function ensureDetails() {
  const miss = neededDetails().filter(c => c && byCode[c] && !byCode[c].hist && !DETAIL_STATE[c]);
  if (miss.length) Promise.all(miss.map(loadDetail)).then(() => render());
}

const store = {
  get(k, d) { try { const v = localStorage.getItem("sh_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sh_" + k, JSON.stringify(v)); } catch {} },
};
const SCR_DEFAULT = { market: "all", sector: "", perMax: "", roeMin: "", divMin: "", scoreMin: "", capMin: "", upMin: "" };
const state = {
  view: "home", buy: null, sell: null, mode: "similar", period: "3M",
  homeMkt: "all", altMkt: "all", briefMkt: "KR", scr: { ...SCR_DEFAULT },
  myTab: "cmp", calScope: "mine", perfMkt: "all", perfBase: null,
  watch: new Set(store.get("watch", [])),
  cmp: store.get("cmp", []).filter(c => byCode[c]),
};

/* ── formatters ── */
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const won = n => Math.round(n).toLocaleString("ko-KR");
const cap = eok => eok >= 10000 ? (eok / 10000).toLocaleString("ko-KR", { maximumFractionDigits: eok >= 1e6 ? 0 : 1 }) + "조" : won(eok) + "억";
const pc = (v, d = 1) => v == null ? "-" : (v > 0 ? "+" : "") + v.toFixed(d) + "%";
const ud = v => v > 0 ? "up" : v < 0 ? "down" : "flat";
const arrow = v => v > 0 ? "▲" : v < 0 ? "▼" : "";
const x = (v, unit = "", d = 1) => v == null ? "-" : v.toFixed(d) + unit;
const money = Engine.money;
const krwHint = s => s.cur === "USD" ? `≈ ${won(s.price * USDKRW)}원` : "";
const mktBadge = s => `<span class="badge ${s.market === "US" ? "b-us" : "b-kr"}">${s.market === "US" ? "미국" : "국내"}</span>`;
const perTxt = s => s.per > 0 ? s.per.toFixed(1) + "배" : "적자";
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
function scoreColor(t) { return t >= 68 ? ["var(--up-soft)", "var(--up)"] : t >= 58 ? ["var(--brand-soft)", "var(--brand)"] : t >= 45 ? ["var(--line-2)", "var(--t2)"] : ["var(--down-soft)", "var(--down)"]; }
const sbadge = t => { const [bg, fg] = scoreColor(t); return `<div class="sbadge num" style="background:${bg};color:${fg}">${t}</div>`; };
const riskBadge = s => `<span class="badge risk r${Engine.riskTier(s)}">위험 ${Engine.riskLabel(s)}</span>`;
const seg = (items, cur, act, cls = "") => `<div class="seg ${cls}">${items.map(([v, l]) => `<button data-act="${act}" data-arg="${v}" class="${cur === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
const CMP_COLORS = ["#F37321", "#1E64D8", "#12A26B", "#8B5CF6"];
const ICON = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  swap: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z"/>',
  cmp: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/>',
  note: '<path d="M4 4h12l4 4v12H4z"/><path d="M8 12h8M8 16h5"/>',
};
const ic = (k, sz = 18) => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 1800); }
async function copyText(t, msg) {
  try { await navigator.clipboard.writeText(t); }
  catch { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  toast(msg);
}

/* ── components ── */
function series(s, period) {
  if (period === "1D") period = "1M";
  if (!s.hist) return [s.price, s.price];
  const len = Math.min({ "1M": 21, "3M": 63, "6M": 126, "1Y": 250 }[period], s.hist.length);
  const d = s.hist.slice(-len);
  d[d.length - 1] = s.price;
  return d;
}
const MA_COLORS = { 20: "#F5A623", 60: "#12A26B", 120: "#8B5CF6" };
function chartSVG(s, period) {
  const d = series(s, period);
  const t = Engine.tech(s), off = s.hist.length - d.length;
  const mas = t ? [[20, t.m20], [60, t.m60], [120, t.m120]].map(([n, a]) => [n, a.slice(off)]) : [];
  const allV = d.concat(...mas.map(([, a]) => a.filter(v => v != null)));
  const lo = Math.min(...allV), hi = Math.max(...allV), W = 400, H = 150, pad = 8;
  const X = i => (i / (d.length - 1)) * W, Y = v => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const line = d.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const r = (d[d.length - 1] / d[0] - 1) * 100;
  const col = r >= 0 ? "#E5322D" : "#1E64D8";
  const yb = Y(d[0]).toFixed(1);
  return {
    r, lo, hi,
    svg: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".18"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <line x1="0" x2="${W}" y1="${yb}" y2="${yb}" stroke="#C3CBD6" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
      <path d="${line}L${W},${H}L0,${H}Z" fill="url(#ga)"/>
      ${mas.map(([n, a]) => { let p = "", st = false; a.forEach((v, i) => { if (v == null) return; p += `${st ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; st = true; }); return p ? `<path d="${p}" fill="none" stroke="${MA_COLORS[n]}" stroke-width="1.2" stroke-opacity=".9" vector-effect="non-scaling-stroke"/>` : ""; }).join("")}
      <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>`
  };
}
// 여러 종목 수익률 비교 (시작점 = 100)
function overlaySVG(list, period) {
  const ds = list.map(s => { const d = series(s, period); return d.map(v => v / d[0] * 100); });
  const all = ds.flat(), lo = Math.min(...all), hi = Math.max(...all), W = 400, H = 160, pad = 8;
  const Y = v => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const paths = ds.map((d, k) => `<path d="${d.map((v, i) => `${i ? "L" : "M"}${(i / (d.length - 1) * W).toFixed(1)},${Y(v).toFixed(1)}`).join("")}" fill="none" stroke="${CMP_COLORS[k]}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${Y(100)}" y2="${Y(100)}" stroke="#C3CBD6" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>${paths}</svg>`;
}

function gauge(t) {
  const C = 2 * Math.PI * 46, [, fg] = scoreColor(t);
  return `<div class="gauge"><svg viewBox="0 0 108 108"><circle cx="54" cy="54" r="46" fill="none" stroke="#EEF1F5" stroke-width="10"/>
    <circle cx="54" cy="54" r="46" fill="none" stroke="${fg}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C * t / 100} ${C}"/></svg>
    <div class="gauge-n"><div><b class="num" style="color:${fg}">${t}</b><span>종합점수</span></div></div></div>`;
}

function radar(fs) {
  const keys = Object.keys(Engine.WEIGHTS), cx = 120, cy = 98, R = 70;
  const pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / keys.length; return [cx + Math.cos(a) * R * v / 100, cy + Math.sin(a) * R * v / 100]; };
  const poly = vals => keys.map((k, i) => pt(i, vals[k]).map(n => n.toFixed(1)).join(",")).join(" ");
  let g = "";
  for (const lv of [25, 50, 75, 100]) g += `<polygon points="${poly(Object.fromEntries(keys.map(k => [k, lv])))}" fill="none" stroke="#E6EAF0"/>`;
  keys.forEach((k, i) => { const [ex, ey] = pt(i, 100), [lx, ly] = pt(i, 124); g += `<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="#E6EAF0"/><text x="${lx}" y="${ly + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="#4B5563">${Engine.FACTOR_LABEL[k]}</text>`; });
  [].concat(fs).forEach((f, j, arr) => {
    const col = arr.length > 1 ? CMP_COLORS[j] : "#F37321";
    g += `<polygon points="${poly(f)}" fill="${col}" fill-opacity="${arr.length > 1 ? .08 : .18}" stroke="${col}" stroke-width="2"/>`;
    if (arr.length === 1) keys.forEach((k, i) => { const [px, py] = pt(i, f[k]); g += `<circle cx="${px}" cy="${py}" r="3" fill="${col}"/>`; });
  });
  return `<svg width="240" height="196" viewBox="0 0 240 196">${g}</svg>`;
}

function searchBox(id, ph, chips = true) {
  const popular = ["005930", "000660", "NVDA", "AAPL", "TSLA", "012450", "PLTR", "105560"].filter(c => byCode[c]);
  return `<div class="search noprint"><div class="search-box">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A94A3" stroke-width="2.2" stroke-linecap="round">${ICON.search}</svg>
      <input id="${id}" placeholder="${ph}" autocomplete="off"></div>
      <div class="sugg" id="${id}-sg"></div></div>
    ${chips ? `<div class="chips noprint">${popular.map(c => `<button class="chip" data-act="pick" data-arg="${c}" data-target="${id}">${byCode[c].name}</button>`).join("")}</div>` : ""}`;
}

function bindSearch(id, onPick) {
  const inp = $("#" + id), sg = $("#" + id + "-sg");
  if (!inp) return;
  let list = [], act = 0;
  const draw = () => {
    sg.innerHTML = list.length ? list.map((s, i) => `<div class="sugg-i ${i === act ? "act" : ""}" data-code="${s.code}"><div><b>${s.name}</b><small>${s.code} · ${s.exch} · ${s.sector}</small></div><span class="num ${ud(s.chg)}">${money(s, s.price)}</span></div>`).join("")
      : `<div class="sugg-i" style="cursor:default;color:var(--t3)">검색 결과가 없습니다 (국내·미국 ${STOCKS.length}종목)</div>`;
    sg.classList.toggle("on", inp.value.trim().length > 0);
  };
  inp.addEventListener("input", () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { list = []; return draw(); }
    const hit = s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().startsWith(q) || s.en.toLowerCase().includes(q) || s.industry.toLowerCase().includes(q);
    const exact = s => s.name.toLowerCase() === q || s.code.toLowerCase() === q;
    list = STOCKS.filter(hit).sort((a, b) => exact(b) - exact(a) || b.mcap - a.mcap).slice(0, 8);
    act = 0; draw();
  });
  inp.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { act = Math.min(act + 1, list.length - 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { act = Math.max(act - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === "Enter" && list[act]) onPick(list[act].code);
    else if (e.key === "Escape") sg.classList.remove("on");
  });
  inp.addEventListener("blur", () => setTimeout(() => sg.classList.remove("on"), 150));
  sg.addEventListener("mousedown", e => { const it = e.target.closest("[data-code]"); if (it) onPick(it.dataset.code); });
}
const PICKERS = {
  "q-buy": c => { state.buy = c; render(); window.scrollTo(0, 0); },
  "q-sell": c => { state.sell = c; render(); window.scrollTo(0, 0); },
  "q-cmp": c => addCompare(c),
};

const disclaimer = `<div class="disc"><b>투자 유의사항</b> · 본 화면의 점수·추천·뉴스 요약은 공개 데이터(Yahoo Finance·네이버 증권, ${DATA_ASOF} 수집)에 룰 기반 지표를 적용한 참고 정보이며 투자 권유가 아닙니다. 데이터는 실시간이 아니고 오류가 있을 수 있습니다. 투자 판단과 결과의 책임은 투자자 본인에게 있습니다.</div>`;

function stockRow(s, i) {
  return `<div class="row" data-act="buy" data-arg="${s.code}">
    ${i != null ? `<div class="rank">${i + 1}</div>` : ""}
    <div class="row-main"><b>${s.name}</b><span>${s.market === "US" ? "미국" : "국내"} · ${s.sector} · 시총 ${cap(s.mcap)} · PER ${perTxt(s)}</span></div>
    <div class="row-r"><b class="num" data-lp="${s.code}">${money(s, s.price)}</b><span class="num ${ud(s.chg)}" data-lc="${s.code}">${pc(s.chg)}</span></div>
    ${Engine.isThin(s) ? `<div class="sbadge thin" title="데이터 부족">부족</div>` : sbadge(Engine.score(s).total)}</div>`;
}

/* ── 데이터 검증 결과 ── */
function verifyCard() {
  if (typeof VERIFY === "undefined") return `<div class="vcard warn"><b>데이터 교차검증 기록 없음</b><span>tools/verify_data.py 를 실행하세요</span></div>`;
  const v = VERIFY, stale = v.asof !== DATA_ASOF, ok = !stale && v.issues === 0;
  return `<div class="vcard ${ok ? "" : "warn"}">
    <b>${stale ? "검증이 최신 데이터와 다릅니다" : ok ? "✓ 데이터 교차검증 통과" : `데이터 교차검증 경고 ${v.issues}건`}</b>
    <span>현재가 ${v.n}종목을 다른 출처와 대조 · 오차 중앙값 ${v.median}% · 최대 ${v.max}% · ${v.checked} 검증</span>
    ${v.items.length ? `<details><summary>경고 내용 보기</summary>${v.items.map(t => `<div>${esc(t)}</div>`).join("")}</details>` : ""}
  </div>`;
}

/* ── 전일 시장 분석 ── */
function briefCard() {
  const mk = state.briefMkt, b = Engine.marketBrief(mk);
  const idx = MARKET.filter(m => mk === "KR" ? /KOSPI|KOSDAQ/.test(m.name) : /S&P|NASDAQ/.test(m.name));
  const fx = MARKET.find(m => m.name === "USD/KRW");
  const moodCls = b.mood === "강세" ? "up" : b.mood === "약세" ? "down" : "flat";
  return `<section class="brief">
    <div class="brief-h"><div><b>전일 시장 분석</b><span>${mk === "KR" ? "국내 정규장 마감" : "미국 정규장 마감"} · ${DATA_ASOF} 수집</span></div>
      ${seg([["KR", "국내"], ["US", "미국"]], mk, "briefmkt", "seg-dark")}</div>
    <div class="idx">${idx.map(m => `<div><span>${m.name}</span><b class="num">${m.value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</b><em class="num ${ud(m.chg)}">${pc(m.chg, 2)}</em></div>`).join("")}
      ${fx ? `<div><span>원/달러</span><b class="num">${fx.value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}</b><em class="num ${ud(fx.chg)}">${pc(fx.chg, 2)}</em></div>` : ""}</div>
    <p class="brief-sum">${mk === "KR" ? "국내" : "미국"} 시장은 <b class="${moodCls}">${b.mood}</b>. 분석 대상 ${b.n}종목 중 상승 <b class="up">${b.up}</b> · 하락 <b class="down">${b.dn}</b>, 평균 <b class="${ud(b.avgChg)}">${pc(b.avgChg)}</b>.
      가장 강한 업종은 <b>${b.best.sector}</b>(${pc(b.best.d1)}), 가장 약한 업종은 <b>${b.worst.sector}</b>(${pc(b.worst.d1)})입니다.</p>
    <div class="brief-t">매수 가망 업종 TOP 3</div>
    ${b.top.map((o, i) => `<div class="sec-card">
      <div class="sec-card-h"><i>${i + 1}</i><b>${o.sector}</b>
        <span class="chipline"><em class="${ud(o.d1)}">전일 ${pc(o.d1)}</em><em class="${ud(o.m1)}">1개월 ${pc(o.m1)}</em><em>평균 ${o.sc.toFixed(0)}점</em></span></div>
      <ul>${o.why.map(w => `<li>${w}</li>`).join("")}</ul>
      <div class="picks">${o.picks.map(s => `<div class="pick" data-act="buy" data-arg="${s.code}"><b>${s.name}</b><span class="num"><i class="lp" data-lp="${s.code}">${money(s, s.price)}</i> <em class="${ud(s.chg)}" data-lc="${s.code}">${pc(s.chg)}</em></span>${sbadge(Engine.score(s).total)}</div>`).join("")}</div>
    </div>`).join("")}
    <p class="note" style="color:rgba(255,255,255,.55)">업종 선정: 전일 등락 25% · 상승 종목 비율 15% · 1개월 추세 20% · 평균 종합점수 40% (룰 기반, 투자 권유 아님)</p>
  </section>`;
}

/* ── 홈 ── */
function viewHome() {
  const pool = Engine.ranked().filter(o => state.homeMkt === "all" || o.s.market === state.homeMkt);
  const secs = [...new Set(pool.map(o => o.s.sector))].map(sec => {
    const g = pool.filter(o => o.s.sector === sec).map(o => o.s);
    return { sec, n: g.length, r: g.reduce((a, s) => a + s.r1m, 0) / g.length };
  }).sort((a, b) => b.r - a.r);
  const heatCol = r => { const a = Math.min(Math.abs(r) / 10, 1) * .75 + .25; return r >= 0 ? `rgba(229,50,45,${a})` : `rgba(30,100,216,${a})`; };
  return `
  ${briefCard()}
  <div class="hero hero-sm">
    <div class="hero-btns" style="margin-top:0">
      <button class="hero-btn pri" data-act="go" data-arg="buy"><b>매수 분석</b><span>종목 추천 사유 보기</span></button>
      <button class="hero-btn" data-act="go" data-arg="sell"><b>매도·교체</b><span>대체 매수 종목 추천</span></button>
    </div>
  </div>
  ${seg([["all", "전체"], ["KR", "국내"], ["US", "미국"]], state.homeMkt, "homemkt")}
  <div class="card" style="margin-top:12px">
    <div class="card-h"><div class="card-t">종합점수 TOP 10</div><div class="card-s">${pool.length}종목 중</div></div>
    ${pool.slice(0, 10).map((o, i) => stockRow(o.s, i)).join("")}
  </div>
  ${homeEventsCard()}
  ${perfHomeCard()}
  ${verifyCard()}
  <div class="card">
    <div class="card-h"><div class="card-t">섹터 1개월 수익률</div><div class="card-s">종목 단순평균</div></div>
    <div class="heat">${secs.map(o => `<div style="background:${heatCol(o.r)}"><b>${o.sec} <em>${o.n}</em></b><span class="num">${pc(o.r)}</span></div>`).join("")}</div>
  </div>
  ${disclaimer}`;
}

/* ── 매수 분석 ── */
function headPrice(s) {
  const prev = s.price / (1 + s.chg / 100);
  const live = LIVE && s.liveAt ? `<span class="live-tag ${s.liveStatus === "OPEN" ? "on" : ""}">${s.liveStatus === "OPEN" ? "실시간" : "장 마감"} ${s.liveAt.slice(11, 16)}</span>` : "";
  return `<div class="price num ${ud(s.chg)}">${s.cur === "USD" ? "$" + s.price.toLocaleString("en-US", { minimumFractionDigits: 2 }) : won(s.price) + "<small>원</small>"}${live}</div>
    <div class="pchg num ${ud(s.chg)}">${arrow(s.chg)} ${s.cur === "USD" ? "$" + Math.abs(s.price - prev).toFixed(2) : won(Math.abs(s.price - prev))} (${pc(s.chg, 2)}) <span class="flat" style="font-weight:500">${krwHint(s)}</span></div>`;
}

/* ── 오늘 분봉 차트 (실시간 서버 사용 시) ── */
const INTRA = {};
function loadIntraday(code, force) {
  const it = INTRA[code];
  if (it && (it.loading || (!force && Date.now() - it.at < 60000))) return;
  INTRA[code] = { ...(it || {}), loading: true };
  fetch("api/intraday?code=" + encodeURIComponent(code), { cache: "no-store" }).then(r => r.json()).then(d => {
    INTRA[code] = { at: Date.now(), data: d.points ? d : { points: [] } };
  }).catch(() => { INTRA[code] = { at: Date.now(), data: { points: [] } }; })
    .then(() => { if (state.view === "buy" && state.buy === code && state.period === "1D") render(); });
}
function intradayChart(s) {
  const it = INTRA[s.code];
  if (!it || !it.data) { loadIntraday(s.code); return `<div class="chart chart-loading">오늘 시세 불러오는 중…</div>`; }
  const pts = it.data.points || [];
  if (pts.length < 2) return `<div class="chart chart-loading">오늘 분봉 데이터가 없습니다 (장 시작 전이거나 휴장)</div>`;
  const d = pts.map(p => p[1]), prev = it.data.prev || s.price / (1 + s.chg / 100);
  const lo = Math.min(...d, prev), hi = Math.max(...d, prev), W = 400, H = 150, pad = 8;
  const X = i => (i / (d.length - 1)) * W, Y = v => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const line = d.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const col = d[d.length - 1] >= prev ? "#E5322D" : "#1E64D8", yb = Y(prev).toFixed(1);
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="gi" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".18"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <line x1="0" x2="${W}" y1="${yb}" y2="${yb}" stroke="#C3CBD6" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
      <path d="${line}L${W},${H}L0,${H}Z" fill="url(#gi)"/>
      <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div>
    <div class="chart-foot num"><span>${pts[0][0]} ~ ${pts[pts.length - 1][0]}${s.market === "US" ? " (한국시간)" : ""} · 점선 = 전일 종가</span><span>고가 ${money(s, Math.max(...d))} · 저가 ${money(s, Math.min(...d))}</span></div>`;
}

function stockHead(s) {
  const c = s.hist && state.period !== "1D" ? chartSVG(s, state.period) : null, on = state.watch.has(s.code);
  return `<div class="card">
    <div class="sh"><div><div class="sh-name">${s.name}</div>
      <div class="sh-meta"><span>${s.code}</span>${mktBadge(s)}<span class="badge">${s.exch}</span><span class="badge">${s.sector}</span>${riskBadge(s)}</div>
      <div class="sh-sub">${esc(s.en)}${s.industry ? " · " + s.industry : ""}</div>
      ${evChips(s)}</div>
      <button class="star noprint ${on ? "on" : ""}" data-act="star" data-arg="${s.code}" aria-label="관심종목"><svg width="18" height="18" viewBox="0 0 24 24" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round">${ICON.star}</svg></button></div>
    <div data-lph="${s.code}">${headPrice(s)}</div>
    <div style="margin-top:14px" class="noprint">${seg((LIVE ? [["1D", "오늘"]] : []).concat([["1M", "1개월"], ["3M", "3개월"], ["6M", "6개월"], ["1Y", "1년"]]), state.period, "period")}</div>
    ${state.period === "1D" ? intradayChart(s) : c ? `<div class="chart">${c.svg}</div>
    <div class="ma-legend"><span><i style="background:${c.r >= 0 ? "#E5322D" : "#1E64D8"}"></i>주가</span>${[20, 60, 120].map(n => `<span><i style="background:${MA_COLORS[n]}"></i>${n}일선</span>`).join("")}</div>
    <div class="chart-foot num"><span>기간 수익률 <b class="${ud(c.r)}">${pc(c.r)}</b></span><span>최고 ${money(s, Math.max(...series(s, state.period)))} · 최저 ${money(s, Math.min(...series(s, state.period)))}</span></div>`
      : `<div class="chart chart-loading">차트 불러오는 중…</div>`}
  </div>`;
}

function newsCard(s) {
  if (!hasNews(s.code)) return `<div class="card"><div class="card-h"><div class="card-t">공시 · 뉴스</div></div><div class="empty-note">불러오는 중…</div></div>`;
  const d = Engine.newsDigest(s.code);
  const toneCls = { "긍정 우세": "g-buy", "부정 우세": "g-caution", "중립": "g-neutral" }[d.tone];
  const allLink = s.market === "KR" ? `https://finance.naver.com/item/news.naver?code=${s.code}` : `https://finance.yahoo.com/quote/${encodeURIComponent(s.yf)}/news`;
  const discLink = s.market === "KR" ? `https://finance.naver.com/item/news_notice.naver?code=${s.code}` : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(s.code)}&owner=include&count=40`;
  return `<div class="card">
    <div class="card-h"><div class="card-t">공시 · 뉴스</div><div class="card-s">${NEWS_ASOF} 수집</div></div>
    ${d.n ? `<div class="digest"><span class="grade ${toneCls}">${d.tone}</span><div><b>${d.topics.length ? "주요 이슈: " + d.topics.join(" · ") : "특정 이슈 키워드 없음"}</b><span>뉴스·공시 ${d.n}건 키워드 분석 · 긍정 ${d.pos} / 부정 ${d.neg}</span></div></div>` : `<div class="empty-note">수집된 뉴스·공시가 없습니다</div>`}
    ${d.news.length ? `<div class="rs-group">뉴스</div>${d.news.map(n => `<a class="news" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(n.t)}</b><span>${esc(n.src)} · ${esc(n.dt)}</span></a>`).join("")}` : ""}
    ${s.market === "KR" && d.disc.length ? `<div class="rs-group">공시</div>${d.disc.map(n => `<div class="news"><b><i class="dtag">${Engine.discTag(n.t)}</i>${esc(n.t)}</b><span>${esc(n.dt)}</span></div>`).join("")}` : ""}
    <div class="news-links noprint"><a href="${allLink}" target="_blank" rel="noopener noreferrer">뉴스 더보기 ›</a><a href="${discLink}" target="_blank" rel="noopener noreferrer">${s.market === "KR" ? "전체 공시" : "SEC 공시(EDGAR)"} ›</a></div>
    <p class="note">요약은 제목·본문 키워드 분류이며 기사 내용의 정확한 해석이 아닙니다. 원문을 확인하세요.</p>
  </div>`;
}

function viewBuy() {
  let h = `<div class="sec-title noprint">매수 분석</div><div class="sec-sub noprint">종목명·코드·영문명으로 검색하면 추천 사유와 리스크를 분석합니다</div>${searchBox("q-buy", "예: 삼성전자, 005930, NVDA, 애플")}`;
  const s = byCode[state.buy];
  if (!s) return h + `<div class="empty"><div class="ic">${ic("search", 26)}</div><b>분석할 종목을 검색하세요</b><p>국내·미국 ${STOCKS.length}종목의 핵심 지표와<br>5개 팩터 점수로 매수 근거를 제시합니다</p></div>` + disclaimer;

  const { f, total } = Engine.score(s), g = Engine.grade(total), rs = Engine.buyReasons(s);
  const up = Engine.upsideOf(s), pos = Engine.rangePos(s), sp = Engine.sectorPer(s);
  const item = (cls, ico, r) => `<div class="rs"><div class="rs-ic ${cls}">${ico}</div><div><b>${r.t}</b><p>${r.d}</p></div></div>`;
  const inCmp = state.cmp.includes(s.code);

  h += stockHead(s);
  h += `<div class="actions noprint">
    <button data-act="copy" data-arg="${s.code}">${ic("copy")}<span>요약 복사</span></button>
    <button data-act="cmpadd" data-arg="${s.code}" class="${inCmp ? "on" : ""}">${ic("cmp")}<span>${inCmp ? "비교 중" : "비교 담기"}</span></button>
    <button data-act="print">${ic("print")}<span>인쇄·PDF</span></button>
    <button data-act="sell" data-arg="${s.code}">${ic("swap")}<span>교체 추천</span></button>
  </div>
  <div class="card">
    <div class="card-h"><div class="card-t">AI 투자의견</div><div class="card-s">${Engine.rankOf(s) ? `${Engine.ranked().length}종목 중 ${Engine.rankOf(s)}위` : "순위 제외 · 데이터 부족"}</div></div>
    ${Engine.isThin(s) ? `<div class="thin-note">재무·컨센서스 데이터가 부족해(PBR·ROE·성장률·목표가·선행PER 중 3개 미만) 점수 신뢰도가 낮습니다. 추천 순위·업종 대표 종목에서 제외됩니다.</div>` : ""}
    <div class="score-wrap">${gauge(total)}<div><span class="grade ${g.cls}">${g.label}</span><div class="grade-desc">${g.desc}</div></div></div>
    <div class="radar">${radar(f)}</div>
    ${Object.keys(Engine.WEIGHTS).map(k => `<div class="fbar"><span class="lbl">${Engine.FACTOR_LABEL[k]}</span><div class="trk"><div class="fil" style="width:${f[k]}%"></div></div><span class="v num">${Math.round(f[k])}</span></div>`).join("")}
  </div>
  <div class="card">
    <div class="card-h"><div class="card-t">추천 사유</div><div class="card-s">지표 기반 자동 생성</div></div>
    <div class="rs-group">강점 ${rs.pros.length}</div>
    ${rs.pros.length ? rs.pros.map(r => item("p", "✓", r)).join("") : `<div class="empty-note">뚜렷한 강점 요인이 확인되지 않습니다</div>`}
    <div class="rs-group">리스크 ${rs.cons.length}</div>
    ${rs.cons.length ? rs.cons.map(r => item("c", "!", r)).join("") : `<div class="empty-note">주요 리스크 요인이 확인되지 않습니다</div>`}
  </div>
  ${techCard(s)}
  ${flowCard(s)}
  ${newsCard(s)}
  <div class="card">
    <div class="card-h"><div class="card-t">투자 지표</div><div class="card-s">${DATA_ASOF}</div></div>
    <div class="mgrid num">
      <div class="m"><span>시가총액</span><b>${cap(s.mcap)}</b>${s.cur === "USD" ? "<em>원화 환산</em>" : ""}</div>
      <div class="m"><span>현재 PER</span><b>${perTxt(s)}</b><em>섹터 ${sp.toFixed(1)}배</em></div>
      <div class="m"><span>선행 PER</span><b>${x(s.fper, "배")}</b></div>
      <div class="m"><span>PBR</span><b>${x(s.pbr, "배", 2)}</b></div>
      <div class="m"><span>ROE</span><b>${x(s.roe, "%")}</b></div>
      <div class="m"><span>EPS 증가율</span><b class="${ud(s.epsG)}">${pc(s.epsG)}</b><em>분기 YoY</em></div>
      <div class="m"><span>매출 증가율</span><b class="${ud(s.revG)}">${pc(s.revG)}</b><em>분기 YoY</em></div>
      <div class="m"><span>영업이익률</span><b>${x(s.opm, "%")}</b>${s.opm == null && s.sector === "금융" ? "<em>금융업</em>" : ""}</div>
      <div class="m"><span>부채/자본(D/E)</span><b>${x(s.debt, "%", 0)}</b></div>
      <div class="m"><span>배당수익률</span><b>${x(s.div, "%", 2)}</b></div>
      ${s.market === "KR" ? `<div class="m"><span>외국인 소진율</span><b>${x(s.foreign, "%")}</b></div>` : `<div class="m"><span>베타</span><b>${x(s.beta, "", 2)}</b></div>`}
      <div class="m"><span>연 변동성</span><b>${x(s.vol, "%")}</b><em>위험 ${Engine.riskLabel(s)}</em></div>
    </div>
  </div>
  <div class="card">
    <div class="card-h"><div class="card-t">애널리스트 컨센서스</div><div class="card-s">${s.nAnalyst}명 커버</div></div>
    <div class="cons">
      <div><span>평균 목표주가</span><b class="num">${s.target ? money(s, s.target) : "-"}</b><em class="num ${ud(up)}">${up == null ? "" : "현재가 대비 " + pc(up)}</em></div>
      <div><span>투자의견</span><b>${Engine.recLabel(s.rec)}</b><em class="num">${s.rec ? s.rec.toFixed(2) + " / 5 (1=강력매수)" : ""}</em></div>
    </div>
    ${s.rec ? `<div class="recbar"><div class="recbar-dot" style="left:${(s.rec - 1) / 4 * 100}%"></div></div><div class="recbar-l"><span>강력매수</span><span>매수</span><span>중립</span><span>매도</span><span>강력매도</span></div>` : ""}
  </div>
  <div class="card">
    <div class="card-h"><div class="card-t">최근 수익률</div></div>
    <div class="ret num">${[["1개월", s.r1m], ["3개월", s.r3m], ["6개월", s.r6m], ["1년", s.r1y]].map(([l, v]) => `<div><span>${l}</span><b class="${ud(v)}">${pc(v)}</b></div>`).join("")}</div>
    <div class="range"><div class="range-h"><span>52주 가격 범위</span><span>현재 위치 ${(pos * 100).toFixed(0)}%</span></div>
      <div class="range-trk"><div class="range-dot" style="left:${Math.max(0, Math.min(100, pos * 100))}%"></div></div>
      <div class="range-f num"><span class="down">${money(s, s.lo52)}</span><span class="up">${money(s, s.hi52)}</span></div></div>
  </div>
  ${disclaimer}`;
  return h;
}

/* ── 매도·교체 ── */
function viewSell() {
  let h = `<div class="sec-title">매도 · 교체 추천</div><div class="sec-sub">매도할 종목을 입력하면 매도 점검과 대체 매수 종목을 추천합니다</div>${searchBox("q-sell", "매도할 종목명 또는 코드")}`;
  const s = byCode[state.sell];
  if (!s) return h + `<div class="empty"><div class="ic">${ic("swap", 26)}</div><b>매도할 종목을 검색하세요</b><p>매도 근거를 점검하고, 같은 섹터 또는<br>분산 관점의 대체 매수 종목을 제안합니다</p></div>` + disclaimer;

  const base = Engine.score(s), chk = Engine.sellCheck(s);
  const alts = Engine.alternatives(s, state.mode, { market: state.altMkt });
  const vcol = { "g-buy": "var(--up-soft)", "g-neutral": "var(--line-2)", "g-caution": "var(--down-soft)" }[chk.verdict.cls];
  h += `<div class="card">
    <div class="mini"><div><div class="sh-name" style="font-size:17px">${s.name} ${mktBadge(s)} <span class="badge">${s.sector}</span></div>
      <div class="sh-meta num">${money(s, s.price)} <span class="${ud(s.chg)}">${pc(s.chg)}</span> · 시총 ${cap(s.mcap)} · PER ${perTxt(s)}</div></div>${sbadge(base.total)}</div>
  </div>
  <div class="card">
    <div class="card-h"><div class="card-t">매도 점검</div><div class="card-s">종합점수 ${base.total}점 · ${Engine.rankOf(s) ? Engine.rankOf(s) + "위" : "순위 제외(데이터 부족)"}</div></div>
    <div class="verdict ${chk.verdict.cls}" style="background:${vcol}"><b>${chk.verdict.t}</b><span style="font-size:12px">매도 근거 ${chk.sell.length} · 보유 근거 ${chk.hold.length}</span></div>
    ${chk.sell.map(t => `<div class="chk"><i class="s">↓</i><span>${t}</span></div>`).join("")}
    ${chk.hold.map(t => `<div class="chk"><i class="h">↑</i><span>${t}</span></div>`).join("")}
    ${!chk.sell.length && !chk.hold.length ? `<div class="empty-note">특이 신호 없음 — 포트폴리오 비중 기준으로 판단하세요</div>` : ""}
  </div>
  <div class="card-h" style="margin:18px 2px 10px"><div class="card-t">대체 매수 추천</div><div class="card-s">탭하면 상세 분석</div></div>
  ${seg([["similar", "동일 섹터"], ["diversify", "분산 투자"], ["best", "전체 상위"]], state.mode, "mode", "seg-navy")}
  <div style="margin-top:8px">${seg([["all", "국내+미국"], ["KR", "국내"], ["US", "미국"]], state.altMkt, "altmkt")}</div>
  <div class="sec-sub" style="margin:10px 2px">${{ similar: `${s.sector} 섹터에서 지표가 더 나은 종목 (동일 업종·시장 우선)`, diversify: `${s.sector} 외 섹터에서 변동성이 낮고 점수가 높은 종목`, best: "섹터와 무관하게 종합점수가 높은 종목" }[state.mode]}</div>`;

  if (!alts.length) h += `<div class="card empty-note">조건에 맞는 대체 종목이 없습니다. 시장 필터를 조정하세요.</div>`;
  alts.forEach((a, i) => {
    const t = a.s, up = Engine.upsideOf(t), su = Engine.upsideOf(s);
    const cell = (l, from, to, fmt, better) => `<div><span>${l}</span><b class="${better ? "better" : ""}">${fmt(to)}</b><em>${fmt(from)}→</em></div>`;
    const perF = v => v > 0 ? v.toFixed(1) : "적자";
    h += `<div class="alt ${i === 0 ? "top" : ""}" data-act="buy" data-arg="${t.code}">
      <div class="alt-h"><div class="alt-rank">${i + 1}</div>
        <div class="row-main"><b>${t.name}</b><span>${t.market === "US" ? "미국" : "국내"} · ${t.industry || t.sector} · <span data-lp="${t.code}">${money(t, t.price)}</span> <span class="${ud(t.chg)}" data-lc="${t.code}">${pc(t.chg)}</span></span></div>
        ${sbadge(a.sc.total)}</div>
      <div class="alt-tags">
        <span class="tag ${a.delta < 0 ? "n" : ""}">매도 종목 대비 ${a.delta >= 0 ? "+" : ""}${a.delta}점</span>
        ${a.why.map(w => `<span class="tag">${w}</span>`).join("")}
        <span class="tag n">위험 ${Engine.riskLabel(t)}</span>
      </div>
      <div class="cmp num">
        ${cell("PER", s.per, t.per, perF, t.per > 0 && (!(s.per > 0) || t.per < s.per))}
        ${cell("ROE", s.roe, t.roe, v => v == null ? "-" : v.toFixed(1), t.roe > s.roe)}
        ${cell("3M 수익률", s.r3m, t.r3m, v => pc(v, 0), t.r3m > s.r3m)}
        ${cell("업사이드", su, up, v => v == null ? "-" : pc(v, 0), up != null && (su == null || up > su))}
      </div>
      ${a.reasons.length ? `<div class="alt-why">${a.reasons.map(r => `<div><b>${r.t}</b> — ${r.d}</div>`).join("")}</div>` : ""}
    </div>`;
  });
  return h + disclaimer;
}

/* ── 조건검색 ── */
const PRESETS = [
  ["저평가 우량", { perMax: 15, roeMin: 12 }],
  ["고배당", { divMin: 3.5 }],
  ["컨센서스 상향여력", { upMin: 20, scoreMin: 55 }],
  ["대형 우량", { capMin: 50, scoreMin: 60 }],
  ["고득점", { scoreMin: 68 }],
];
function viewScreener() {
  const c = state.scr;
  const num = (k, l, ph) => `<label class="fld"><span>${l}</span><input type="number" inputmode="decimal" data-scr="${k}" value="${c[k]}" placeholder="${ph}"></label>`;
  return `<div class="sec-title">조건검색</div><div class="sec-sub">지표 조건으로 ${STOCKS.length}종목을 걸러 종합점수 순으로 보여줍니다</div>
  <div class="chips">${PRESETS.map(([l], i) => `<button class="chip" data-act="preset" data-arg="${i}">${l}</button>`).join("")}<button class="chip" data-act="preset" data-arg="reset">초기화</button></div>
  <div class="card">
    ${seg([["all", "전체"], ["KR", "국내"], ["US", "미국"]], c.market, "scrmkt")}
    <label class="fld" style="margin-top:12px"><span>섹터</span><select data-scr="sector"><option value="">전체 섹터</option>${SECTORS.map(v => `<option ${c.sector === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <div class="fgrid">
      ${num("perMax", "PER 이하", "예: 15")}${num("roeMin", "ROE 이상(%)", "예: 10")}${num("divMin", "배당 이상(%)", "예: 3")}
      ${num("upMin", "업사이드 이상(%)", "예: 15")}${num("capMin", "시총 이상(조)", "예: 10")}${num("scoreMin", "점수 이상", "예: 60")}
    </div>
  </div>
  <div id="scr-res"></div>`;
}
function renderScreenerResults() {
  const c = state.scr, n = k => c[k] === "" ? 0 : +c[k];
  const res = Engine.screen({ market: c.market, sector: c.sector, perMax: n("perMax"), roeMin: n("roeMin"), divMin: n("divMin"),
    scoreMin: n("scoreMin"), capMin: n("capMin"), upMin: n("upMin") });
  $("#scr-res").innerHTML = `<div class="card">
    <div class="card-h"><div class="card-t">검색 결과 ${res.length}종목</div><div class="card-s">${res.length > 50 ? "상위 50개 표시" : "종합점수 순"}</div></div>
    ${res.length ? res.slice(0, 50).map((o, i) => stockRow(o.s, i)).join("") : `<div class="empty-note">조건에 맞는 종목이 없습니다</div>`}
  </div>${disclaimer}`;
}

/* ── MY: 종목 비교 ── */
function addCompare(code) {
  if (state.cmp.includes(code)) { toast(`${byCode[code].name}은(는) 이미 비교함에 있습니다`); return; }
  if (state.cmp.length >= 4) { toast("비교는 최대 4종목까지 가능합니다"); return; }
  state.cmp.push(code); store.set("cmp", state.cmp);
  toast(`${byCode[code].name} 비교함에 추가 (${state.cmp.length}/4)`);
  render();
}
const CMP_ROWS = [
  ["가격·규모"],
  ["현재가", s => s.price, (v, s) => money(s, v)],
  ["등락률", s => s.chg, v => pc(v, 2), null, true],
  ["시가총액", s => s.mcap, cap, "high"],
  ["AI 평가"],
  ["종합점수", s => Engine.score(s).total, v => v + "점", "high"],
  ["투자의견", s => Engine.score(s).total, v => Engine.grade(v).label],
  ...Object.keys(Engine.WEIGHTS).map(k => [Engine.FACTOR_LABEL[k], s => Math.round(Engine.score(s).f[k]), v => v, "high"]),
  ["밸류에이션"],
  ["PER", s => s.per > 0 ? s.per : null, v => v.toFixed(1) + "배", "low"],
  ["선행 PER", s => s.fper, v => v.toFixed(1) + "배", "low"],
  ["PBR", s => s.pbr, v => v.toFixed(2) + "배", "low"],
  ["배당수익률", s => s.div, v => v.toFixed(2) + "%", "high"],
  ["수익성·성장"],
  ["ROE", s => s.roe, v => v.toFixed(1) + "%", "high"],
  ["영업이익률", s => s.opm, v => v.toFixed(1) + "%", "high"],
  ["EPS 증가율", s => s.epsG, v => pc(v), "high"],
  ["매출 증가율", s => s.revG, v => pc(v), "high"],
  ["부채/자본", s => s.debt, v => v.toFixed(0) + "%", "low"],
  ["주가·위험"],
  ["1개월", s => s.r1m, v => pc(v), "high", true],
  ["3개월", s => s.r3m, v => pc(v), "high", true],
  ["1년", s => s.r1y, v => pc(v), "high", true],
  ["연 변동성", s => s.vol, v => v.toFixed(1) + "%", "low"],
  ["위험등급", s => Engine.riskTier(s), (v, s) => Engine.riskLabel(s), "low"],
  ["컨센서스"],
  ["목표가 업사이드", s => Engine.upsideOf(s), v => pc(v), "high", true],
  ["투자의견(1~5)", s => s.rec, v => v.toFixed(2) + " " + Engine.recLabel(v), "low"],
  ["뉴스 톤", s => hasNews(s.code) ? Engine.newsDigest(s.code).tone : null, v => v],
];
function compareConclusion(list) {
  const best = (fn, dir = "high") => { const v = list.map(s => [s, fn(s)]).filter(([, v]) => v != null && isFinite(v)); if (v.length < 2) return null; v.sort((a, b) => dir === "high" ? b[1] - a[1] : a[1] - b[1]); return v[0][0]; };
  const lines = [];
  const top = best(s => Engine.score(s).total);
  if (top) lines.push(`종합점수는 <b>${top.name}</b>(${Engine.score(top).total}점)가 가장 높습니다.`);
  const fac = Object.keys(Engine.WEIGHTS).map(k => { const b = best(s => Engine.score(s).f[k]); return b ? `${Engine.FACTOR_LABEL[k]} ${b.name}` : null; }).filter(Boolean);
  if (fac.length) lines.push(`팩터별 우위: ${fac.join(" · ")}`);
  const cheap = best(s => s.per > 0 ? s.per : null, "low"), safe = best(s => s.vol, "low"), up = best(s => Engine.upsideOf(s));
  if (cheap) lines.push(`PER 기준 가장 저평가: ${cheap.name}(${cheap.per.toFixed(1)}배)`);
  if (safe) lines.push(`변동성이 가장 낮은 종목: ${safe.name}(연 ${safe.vol}%)`);
  if (up) lines.push(`목표가 상승여력 최대: ${up.name}(${pc(Engine.upsideOf(up))})`);
  return lines;
}
function viewCompare() {
  const list = state.cmp.map(c => byCode[c]);
  let h = searchBox("q-cmp", `비교할 종목 추가 (${list.length}/4)`, false);
  if (list.length) h += `<div class="chips">${list.map((s, i) => `<span class="chip cchip" style="border-color:${CMP_COLORS[i]};color:${CMP_COLORS[i]}"><i style="background:${CMP_COLORS[i]}"></i>${s.name}<button data-act="cmpdel" data-arg="${s.code}" aria-label="삭제">✕</button></span>`).join("")}<button class="chip" data-act="cmpclear">전체 비우기</button></div>`;
  if (list.length < 2) return h + `<div class="empty"><div class="ic">${ic("cmp", 26)}</div><b>${list.length ? "1종목 더 추가하세요" : "비교할 종목을 담으세요"}</b><p>위 검색창이나 매수 분석 화면의 '비교 담기'로<br>2~4종목을 나란히 비교할 수 있습니다</p></div>`;

  const cols = `grid-template-columns:88px repeat(${list.length},1fr)`;
  const table = CMP_ROWS.map(([label, fn, fmt, dir, colored]) => {
    if (!fn) return `<div class="ct-sec">${label}</div>`;
    const vals = list.map(fn);
    const nums = vals.filter(v => typeof v === "number" && isFinite(v));
    const bestV = dir && nums.length > 1 && new Set(nums).size > 1 ? (dir === "high" ? Math.max(...nums) : Math.min(...nums)) : null;
    return `<div class="ct-row" style="${cols}"><span class="ct-l">${label}</span>${vals.map((v, i) => {
      const txt = v == null || (typeof v === "number" && !isFinite(v)) ? "-" : fmt(v, list[i]);
      return `<b class="num ${v === bestV ? "best" : ""} ${colored && typeof v === "number" ? ud(v) : ""}">${txt}</b>`;
    }).join("")}</div>`;
  }).join("");

  h += `<div class="card">
    <div class="card-h"><div class="card-t">비교 결론</div><button class="card-s link noprint" data-act="cmpcopy">요약 복사</button></div>
    <ul class="concl">${compareConclusion(list).map(l => `<li>${l}</li>`).join("")}</ul>
  </div>
  <div class="card">
    <div class="card-h"><div class="card-t">수익률 비교</div><div class="card-s">시작점 = 100</div></div>
    <div class="noprint">${seg([["1M", "1개월"], ["3M", "3개월"], ["6M", "6개월"], ["1Y", "1년"]], state.period, "period")}</div>
    ${list.every(s => s.hist) ? `<div class="chart" style="height:160px">${overlaySVG(list, state.period)}</div>` : `<div class="chart chart-loading" style="height:160px">차트 불러오는 중…</div>`}
    <div class="legend">${list.map((s, i) => { const d = series(s, state.period); const r = (d[d.length - 1] / d[0] - 1) * 100; return `<span><i style="background:${CMP_COLORS[i]}"></i>${s.name} <b class="num ${ud(r)}">${pc(r)}</b></span>`; }).join("")}</div>
  </div>
  <div class="card">
    <div class="card-h"><div class="card-t">팩터 비교</div></div>
    <div class="radar">${radar(list.map(s => Engine.score(s).f))}</div>
  </div>
  <div class="card ctab">
    <div class="ct-row ct-head" style="${cols}"><span></span>${list.map((s, i) => `<b data-act="buy" data-arg="${s.code}" style="color:${CMP_COLORS[i]}">${s.name}<em>${s.market === "US" ? "미국" : "국내"}·${s.sector}</em></b>`).join("")}</div>
    ${table}
    <p class="note">주황색 굵은 글씨 = 해당 항목 우위 종목</p>
  </div>${disclaimer}`;
  return h;
}
function compareText() {
  const list = state.cmp.map(c => byCode[c]);
  const L = [`[종목 비교] ${DATA_ASOF} 기준`, ...list.map(s => `- ${s.name}: ${money(s, s.price)} | 점수 ${Engine.score(s).total} | PER ${perTxt(s)} | ROE ${x(s.roe, "%")} | 1Y ${pc(s.r1y)} | 업사이드 ${pc(Engine.upsideOf(s))}`),
    "", ...compareConclusion(list).map(l => "· " + l.replace(/<\/?b>/g, "")), "", "※ 공개 데이터 기반 참고자료이며 투자 권유가 아닙니다."];
  return L.join("\n");
}

/* ── MY ── */
function viewWatch() {
  const list = [...state.watch].map(c => byCode[c]).filter(Boolean);
  if (!list.length) return `<div class="empty"><div class="ic">${ic("star", 26)}</div><b>관심종목이 없습니다</b><p>매수 분석에서 종목을 검색한 뒤<br>☆ 버튼으로 추가할 수 있어요</p></div>`;
  return `<div class="card">${list.map(s => stockRow(s)).join("")}</div>`;
}
function viewMy() {
  const n = v => v ? " " + v : "";
  const tabs = [["cmp", "종목 비교" + n(state.cmp.length)],
    ["cal", "일정"], ["perf", "추천 성과"], ["watch", "관심종목" + n(state.watch.size)]];
  if (!["cmp", "cal", "perf", "watch"].includes(state.myTab)) state.myTab = "cmp";
  const body = { cmp: viewCompare, cal: viewCalendar, perf: viewPerf, watch: viewWatch }[state.myTab]();
  return `<div class="sec-title noprint">MY 업무</div><div class="tabs noprint">${tabs.map(([v, l]) => `<button data-act="myt" data-arg="${v}" class="${state.myTab === v ? "on" : ""}">${l}</button>`).join("")}</div>${body}`;
}

/* ── 일정 (실적 발표·배당락) ── */
function evChips(s) {
  const ev = Engine.events([s], 60);
  return ev.length ? `<div class="ev-chips">${ev.map(e => `<span class="evc ${e.dday <= 7 ? "soon" : ""}">${e.type} ${e.date.slice(5).replace("-", "/")}${e.est ? "(추정)" : ""} · D-${e.dday}</span>`).join("")}</div>` : "";
}
function myCodes() {
  return [...state.watch].filter(c => byCode[c]);
}
function evRow(e) {
  return `<div class="row" data-act="buy" data-arg="${e.s.code}"><div class="ev-d ${e.dday <= 7 ? "soon" : ""}"><b>${e.dday ? "D-" + e.dday : "오늘"}</b><span>${e.date.slice(5).replace("-", "/")}</span></div>
    <div class="row-main"><b>${e.s.name}</b><span>${e.type}${e.est ? " (예정일 추정)" : ""} · ${e.s.market === "US" ? "미국" : "국내"} · ${e.s.sector}</span></div>${sbadge(Engine.score(e.s).total)}</div>`;
}
function homeEventsCard() {
  const mine = myCodes().map(c => byCode[c]);
  const ev = mine.length ? Engine.events(mine, 14) : Engine.events([...STOCKS].sort((a, b) => b.mcap - a.mcap).slice(0, 60), 7);
  if (!ev.length) return "";
  return `<div class="card"><div class="card-h"><div class="card-t">다가오는 일정</div><button class="card-s link" data-act="myt" data-arg="cal">전체 보기 ›</button></div>
    <div class="card-s" style="margin:-6px 0 4px">${mine.length ? "관심종목 · 14일 이내" : "시총 상위 60종목 · 7일 이내 (관심종목을 추가하면 관심종목 기준)"}</div>
    ${ev.slice(0, 5).map(evRow).join("")}</div>`;
}
function viewCalendar() {
  const list = state.calScope === "mine" ? myCodes().map(c => byCode[c]) : STOCKS;
  const ev = Engine.events(list, 30).slice(0, 200);
  const groups = {};
  ev.forEach(e => (groups[e.date] = groups[e.date] || []).push(e));
  return `${seg([["mine", "관심종목"], ["all", `전체 ${STOCKS.length}종목`]], state.calScope, "calscope")}
    <div class="sec-sub" style="margin:10px 2px">향후 30일 실적 발표·배당락 일정 · 출처 Yahoo Finance (회사 확정 공시 전에는 추정일일 수 있음)</div>
    ${!ev.length ? `<div class="card empty-note">${state.calScope === "mine" && !list.length ? "관심종목이 없습니다. '전체'를 선택하거나 매수 분석에서 ☆로 종목을 추가하세요." : "30일 이내 일정이 없습니다."}</div>`
      : Object.entries(groups).map(([d, es]) => `<div class="card"><div class="card-h"><div class="card-t">${d} (${"일월화수목금토"[new Date(d + "T00:00:00").getDay()]})</div><div class="card-s">${es[0].dday ? "D-" + es[0].dday : "오늘"} · ${es.length}건</div></div>${es.map(evRow).join("")}</div>`).join("")}`;
}

/* ── 기술적 분석 · 수급 ── */
function techCard(s) {
  const t = Engine.tech(s);
  if (!t) return "";
  const cls = v => /정배열|상승|골든/.test(v) ? "up" : /역배열|하락|데드/.test(v) ? "down" : "";
  const maCell = n => { const v = t.ma[n]; return v ? `<div><span>${n}일선</span><b class="num">${money(s, v)}</b><em class="num ${ud(s.price - v)}">현재가 ${pc((s.price / v - 1) * 100)}</em></div>` : `<div><span>${n}일선</span><b>-</b></div>`; };
  return `<div class="card"><div class="card-h"><div class="card-t">기술적 분석</div><div class="card-s">일봉 · 최근 1년</div></div>
    <div class="tech-grid">
      <div><span>이동평균 배열</span><b class="${cls(t.align)}">${t.align}</b></div>
      <div><span>크로스 신호</span><b class="${t.cross ? cls(t.cross.type) : ""}">${t.cross ? t.cross.type : "없음"}</b><em>${t.cross ? (t.cross.ago ? t.cross.ago + "거래일 전" : "오늘") : "최근 15거래일"}</em></div>
      <div><span>RSI(14)</span><b class="${t.rsi >= 70 ? "up" : t.rsi <= 30 ? "down" : ""}">${t.rsi.toFixed(0)}</b><em>${t.rsi >= 70 ? "과매수" : t.rsi <= 30 ? "과매도" : "중립"}</em></div>
    </div>
    <div class="rsi"><div class="rsi-trk"><i style="left:${Math.max(0, Math.min(100, t.rsi))}%"></i></div>
      <div class="rsi-l"><span style="left:0">0</span><span style="left:30%">30 과매도</span><span style="left:70%">과매수 70</span><span style="left:100%">100</span></div></div>
    <div class="ma-grid">${[20, 60, 120].map(maCell).join("")}</div>
    <p class="note">골든크로스 = 20일선이 60일선을 위로 돌파(데드크로스는 반대). 정배열 = 주가 > 20일 > 60일 > 120일선. 기술적 신호는 후행 지표입니다.</p></div>`;
}
function flowCard(s) {
  const f = s.flow;
  if (!f) return "";
  const c = v => `<b class="num ${ud(v)}">${Engine.flowTxt(v)}</b>`;
  const fp = Engine.flowPct(s);
  return `<div class="card"><div class="card-h"><div class="card-t">수급 · 외국인/기관</div><div class="card-s">${f.date ? `${f.date.slice(0, 4)}-${f.date.slice(4, 6)}-${f.date.slice(6)}` : ""} 기준 순매수</div></div>
    <div class="ftab"><span></span><span>1일</span><span>5일</span><span>20일</span>
      <span class="fl">외국인</span>${c(f.f1)}${c(f.f5)}${c(f.f20)}
      <span class="fl">기관</span>${c(f.o1)}${c(f.o5)}${c(f.o20)}</div>
    <div class="fsum">${f.fstreak ? `<span class="${f.fstreak > 0 ? "up" : "down"}">외국인 ${Math.abs(f.fstreak)}일 연속 ${f.fstreak > 0 ? "순매수" : "순매도"}</span>` : ""}
      <span>20일 외국인+기관 = 시총의 <b class="${ud(fp)}">${fp == null ? "-" : (fp > 0 ? "+" : "") + fp.toFixed(2) + "%"}</b></span>
      ${s.foreign != null ? `<span>외국인 소진율 ${s.foreign}%</span>` : ""}</div>
    <p class="note">금액 = 일별 순매수 수량 × 당일 종가(근사치) · 출처 네이버 증권 · 종합점수 모멘텀에 20% 반영</p></div>`;
}
function techSummary(s) {
  const t = Engine.tech(s), f = s.flow, out = [];
  if (t) out.push(`기술: ${t.align}${t.cross ? ` · ${t.cross.type}(${t.cross.ago}거래일 전)` : ""} · RSI ${t.rsi.toFixed(0)}`);
  if (f) out.push(`수급(5일): 외국인 ${Engine.flowTxt(f.f5)} · 기관 ${Engine.flowTxt(f.o5)}${f.fstreak ? ` · 외국인 ${Math.abs(f.fstreak)}일 연속 ${f.fstreak > 0 ? "순매수" : "순매도"}` : ""}`);
  const ev = Engine.events([s], 30);
  if (ev.length) out.push(`일정: ${ev.map(e => `${e.type} ${e.date}`).join(", ")}`);
  return out.length ? ["", "■ 기술·수급·일정", ...out.map(l => "- " + l)] : [];
}

/* ── 추천 성과 추적 ── */
// 매일 저장한 스냅샷(app/history/날짜.js)을 같은 규칙으로 다시 채점 → 그때 추천 종목의 이후 수익률을 계산
const PERF = { loaded: {}, loading: false };
const perfCache = {};
const snapDates = () => typeof SNAP_DATES !== "undefined" ? SNAP_DATES : [];
const baseCandidates = () => snapDates().filter(d => d < DATA_ASOF.slice(0, 10));
function loadSnap(d) {
  return new Promise(res => {
    if (window.SNAPS && window.SNAPS[d]) return res(window.SNAPS[d]);
    const sc = document.createElement("script");
    sc.src = `history/${d}.js?t=${Date.now()}`;
    sc.onload = () => res(window.SNAPS && window.SNAPS[d]);
    sc.onerror = () => res(null);
    document.body.appendChild(sc);
  });
}
function defaultBase() {
  const c = baseCandidates();
  if (!c.length) return null;
  const target = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);  // 약 1개월 전
  const older = c.filter(d => d <= target);
  return older.length ? older[older.length - 1] : c[0];
}
async function loadPerfSnaps() {
  const d = defaultBase();
  if (!d || PERF.loaded[d] || PERF.loading) return;
  PERF.loading = true;
  await loadSnap(d);
  PERF.loaded[d] = true; PERF.loading = false;
  if (state.view === "home" || (state.view === "my" && state.myTab === "perf")) render();
}
function perfCompute(d, mkt) {
  const key = d + "|" + mkt;
  if (perfCache[key]) return perfCache[key];
  const snap = window.SNAPS && window.SNAPS[d];
  if (!snap) return null;
  const snapStocks = snap.stocks || (snap._rows = snap._rows || snap.rows.map(r => Object.fromEntries(snap.keys.map((k, i) => [k, r[i]]))));
  const E = makeEngine(snapStocks);
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const rows = E.ranked().filter(o => (mkt === "all" || o.s.market === mkt) && byCode[o.s.code] && o.s.price > 0)
    .map(o => ({ code: o.s.code, name: o.s.name, score: o.sc.total, sector: o.s.sector, market: o.s.market, ret: (byCode[o.s.code].price / o.s.price - 1) * 100 }));
  if (rows.length < 10) return null;
  const top = rows.slice(0, 10), univ = mean(rows.map(r => r.ret)), size = Math.ceil(rows.length / 5);
  const quint = [0, 1, 2, 3, 4].map(i => { const g = rows.slice(i * size, (i + 1) * size); return { lo: Math.min(...g.map(r => r.score)), hi: Math.max(...g.map(r => r.score)), ret: mean(g.map(r => r.ret)) }; });
  const idx = {};
  for (const m of snap.market || []) { const cur = MARKET.find(x => x.name === m.name); if (cur && m.name !== "USD/KRW" && (mkt === "all" || (mkt === "KR") === /KOS/.test(m.name))) idx[m.name] = (cur.value / m.value - 1) * 100; }
  const sectors = (mkt === "all" ? ["KR", "US"] : [mkt]).map(mk => {
    const mrows = rows.filter(r => r.market === mk);
    return { mk, avg: mean(mrows.map(r => r.ret)), top: E.marketBrief(mk).top.map(o => ({ sector: o.sector, ret: mean(mrows.filter(r => r.sector === o.sector).map(r => r.ret)) })) };
  });
  const days = Math.round((new Date(DATA_ASOF.slice(0, 10)) - new Date(d)) / 864e5);
  return (perfCache[key] = { d, days, top, topAvg: mean(top.map(r => r.ret)), univ, hit: top.filter(r => r.ret > univ).length, quint, idx, sectors, n: rows.length });
}
function perfHomeCard() {
  const dates = snapDates(), base = defaultBase();
  if (!dates.length) return "";
  const head = `<div class="card-h"><div class="card-t">추천 성과 추적</div><span class="card-s link">자세히 ›</span></div>`;
  if (!base) return `<div class="card perf-mini" data-act="myt" data-arg="perf">${head}<p class="pm-txt">기록 ${dates.length}일차 (${dates[0]} 시작). 다음 갱신부터 "그때 추천한 종목이 실제로 올랐는지"를 집계합니다.</p></div>`;
  const r = perfCompute(base, "all");
  if (!r) return `<div class="card perf-mini">${head}<p class="pm-txt">기록 불러오는 중…</p></div>`;
  const ex = r.topAvg - r.univ;
  return `<div class="card perf-mini" data-act="myt" data-arg="perf">${head}
    <p class="pm-txt">${r.d} (${r.days}일 전) 종합점수 TOP 10의 이후 수익률</p>
    <div class="pm-grid"><div><span>TOP 10 평균</span><b class="num ${ud(r.topAvg)}">${pc(r.topAvg)}</b></div><div><span>전체 ${r.n}종목</span><b class="num ${ud(r.univ)}">${pc(r.univ)}</b></div><div><span>초과 수익</span><b class="num ${ud(ex)}">${ex > 0 ? "+" : ""}${ex.toFixed(1)}%p</b></div></div></div>`;
}
function viewPerf() {
  const dates = snapDates(), cands = baseCandidates();
  const intro = `<div class="sec-sub" style="margin:0 2px 12px">매일 자동 갱신 때 저장한 그날의 데이터로 <b>그날의 점수를 다시 계산</b>하고, 그때 추천한 종목이 지금까지 실제로 얼마나 움직였는지 비교합니다.</div>`;
  if (!cands.length) return intro + `<div class="card"><div class="card-h"><div class="card-t">기록 ${dates.length}일차</div><div class="card-s">${dates[0] || "-"} 시작</div></div>
    <p class="pm-txt">아직 비교할 과거 기록이 없습니다. 자동 갱신이 하루 이상 쌓이면 이 화면에 다음이 표시됩니다.</p>
    <ul class="concl"><li>종합점수 TOP 10의 이후 수익률 — 전체 평균·지수 대비</li><li>점수 구간(5분위)별 수익률 — 점수가 높을수록 실제로 더 올랐는지</li><li>그날 '매수 가망 업종 TOP 3'의 이후 성과</li></ul>
    <p class="note">기간이 짧을수록 우연의 영향이 큽니다. 최소 1~3개월 이상 쌓인 뒤 판단하세요.</p></div>`;
  const base = state.perfBase && cands.includes(state.perfBase) ? state.perfBase : defaultBase();
  if (!(window.SNAPS && window.SNAPS[base])) {
    loadSnap(base).then(() => { PERF.loaded[base] = true; if (state.myTab === "perf") render(); });
    return intro + `<div class="card empty-note">${base} 기록 불러오는 중…</div>`;
  }
  const r = perfCompute(base, state.perfMkt);
  if (!r) return intro + `<div class="card empty-note">비교 가능한 종목이 부족합니다.</div>`;
  const ex = r.topAvg - r.univ, qmax = Math.max(...r.quint.map(q => Math.abs(q.ret)), 0.1);
  const qlabel = i => ["상위 20%", "20~40%", "40~60%", "60~80%", "하위 20%"][i];
  return intro + `
  <div class="perf-ctl"><label class="fld"><span>기준일 (그날의 추천)</span><select data-perfbase>${[...cands].reverse().map(d => `<option ${d === base ? "selected" : ""}>${d}</option>`).join("")}</select></label>
    ${seg([["all", "전체"], ["KR", "국내"], ["US", "미국"]], state.perfMkt, "perfmkt")}</div>
  <div class="card">
    <div class="card-h"><div class="card-t">종합점수 TOP 10 성과</div><div class="card-s">${r.d} → ${DATA_ASOF.slice(0, 10)} (${r.days}일)</div></div>
    <div class="pm-grid"><div><span>TOP 10 평균</span><b class="num ${ud(r.topAvg)}">${pc(r.topAvg)}</b></div><div><span>전체 ${r.n}종목</span><b class="num ${ud(r.univ)}">${pc(r.univ)}</b></div><div><span>초과 수익</span><b class="num ${ud(ex)}">${ex > 0 ? "+" : ""}${ex.toFixed(1)}%p</b></div></div>
    <div class="pm-sub">전체 평균을 이긴 종목 <b>${r.hit}/10</b>${Object.keys(r.idx).length ? " · 지수 " + Object.entries(r.idx).map(([k, v]) => `${k} <b class="${ud(v)}">${pc(v)}</b>`).join(" · ") : ""}</div>
    ${r.top.map((t, i) => `<div class="row" data-act="buy" data-arg="${t.code}"><div class="rank">${i + 1}</div><div class="row-main"><b>${t.name}</b><span>${t.market === "US" ? "미국" : "국내"} · ${t.sector} · 당시 ${t.score}점</span></div><div class="row-r"><b class="num ${ud(t.ret)}">${pc(t.ret)}</b></div></div>`).join("")}
  </div>
  <div class="card">
    <div class="card-h"><div class="card-t">점수 구간별 수익률</div><div class="card-s">5분위 · 동일가중</div></div>
    <div class="quint">${r.quint.map((q, i) => `<div class="qrow"><span>${qlabel(i)}<em>${q.lo}~${q.hi}점</em></span><div class="qbar"><i class="${q.ret >= 0 ? "pos" : "neg"}" style="width:${Math.abs(q.ret) / qmax * 50}%"></i></div><b class="num ${ud(q.ret)}">${pc(q.ret)}</b></div>`).join("")}</div>
    <p class="note">${r.quint[0].ret > r.quint[4].ret ? "현재까지는 점수가 높은 구간의 수익률이 더 높습니다." : "현재까지는 점수가 높은 구간이 더 높은 수익을 내지 못했습니다."} 기간이 짧으면 우연의 영향이 큽니다.</p>
  </div>
  <div class="card">
    <div class="card-h"><div class="card-t">그날의 매수 가망 업종 성과</div></div>
    ${r.sectors.map(g => `<div class="rs-group">${g.mk === "KR" ? "국내" : "미국"} · 시장 평균 ${pc(g.avg)}</div>${g.top.map((t, i) => `<div class="row" style="cursor:default"><div class="rank">${i + 1}</div><div class="row-main"><b>${t.sector}</b></div><div class="row-r"><b class="num ${ud(t.ret)}">${pc(t.ret)}</b><span class="num ${ud(t.ret - g.avg)}">평균 대비 ${t.ret - g.avg > 0 ? "+" : ""}${(t.ret - g.avg).toFixed(1)}%p</span></div></div>`).join("")}`).join("")}
  </div>
  <p class="note" style="padding:0 4px">수익률 = 기준일 종가 → 최신 종가, 현지 통화 기준, 배당·수수료·세금 미반영. 점수 규칙을 바꾸면 과거 기록도 새 규칙으로 다시 계산됩니다. 과거 성과가 미래 수익을 보장하지 않습니다.</p>`;
}

/* ── 상담 요약 ── */
function summaryText(s) {
  const { total } = Engine.score(s), g = Engine.grade(total), rs = Engine.buyReasons(s), up = Engine.upsideOf(s);
  const nd = hasNews(s.code) ? Engine.newsDigest(s.code) : null;
  const L = [
    `[종목 상담 요약] ${DATA_ASOF} 기준`,
    `${s.name}(${s.code}·${s.exch}) ${money(s, s.price)} (${pc(s.chg, 2)})`,
    `종합점수 ${total}점 · ${g.label} · 위험 ${Engine.riskLabel(s)}`,
    ``,
    `■ 핵심지표`,
    `시총 ${cap(s.mcap)} | PER ${perTxt(s)} | PBR ${x(s.pbr, "배", 2)} | ROE ${x(s.roe, "%")} | 배당 ${x(s.div, "%", 2)}${s.foreign != null ? ` | 외국인 ${s.foreign}%` : ""}`,
    `수익률 1M ${pc(s.r1m)} · 3M ${pc(s.r3m)} · 1Y ${pc(s.r1y)}`,
    s.target ? `목표가 ${money(s, s.target)} (${pc(up)}) · 의견 ${Engine.recLabel(s.rec)} (${s.nAnalyst}명)` : "",
    ``,
    `■ 투자 포인트`, ...(rs.pros.length ? rs.pros.map(r => `- ${r.t}: ${r.d}`) : ["- 뚜렷한 강점 없음"]),
    ``,
    `■ 리스크`, ...(rs.cons.length ? rs.cons.map(r => `- ${r.t}: ${r.d}`) : ["- 특이 리스크 없음"]),
    ...techSummary(s),
    ...(nd && nd.n ? [``, `■ 최근 뉴스·공시 (${nd.tone}${nd.topics.length ? ", " + nd.topics.join("·") : ""})`, ...nd.news.slice(0, 3).map(n => `- ${n.t}`)] : []),
    ``,
    `※ 본 자료는 공개 데이터 기반 참고자료로 투자 권유가 아니며, 투자 결과의 책임은 투자자 본인에게 있습니다. 과거 수익률이 미래 수익을 보장하지 않습니다.`,
  ];
  return L.filter((l, i) => l !== "" || L[i - 1] !== "").join("\n");
}

/* ── 실시간 시세 (tools/live_server.py 로 열었을 때만 동작) ── */
let LIVE = false, liveTime = null;
async function liveInit() {
  try {
    const r = await fetch("api/ping", { cache: "no-store" });
    if (!r.ok || !(await r.json()).ok) return;
  } catch { return; }
  LIVE = true;
  render();
  liveTick();
  setInterval(() => { if (!document.hidden) liveTick(); }, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) liveTick(); });
}
async function liveTick() {
  const codes = new Set();
  document.querySelectorAll(`#v-${state.view} [data-lp], #v-${state.view} [data-lph]`).forEach(e => codes.add(e.dataset.lp || e.dataset.lph));
  if (state.view === "sell" && state.sell) codes.add(state.sell);
  const list = [...codes].filter(c => byCode[c]).slice(0, 100);
  if (list.length) {
    try {
      const d = await (await fetch("api/quotes?codes=" + encodeURIComponent(list.join(",")), { cache: "no-store" })).json();
      for (const [c, q] of Object.entries(d.quotes || {})) {
        const s = byCode[c];
        if (!s || q.price == null) continue;
        s.price = q.price;
        if (q.chg != null) s.chg = q.chg;
        s.liveAt = q.time; s.liveStatus = q.status;
      }
      liveTime = d.time;
      applyLive();
      if (state.view === "buy" && state.period === "1D" && state.buy) loadIntraday(state.buy, true);
    } catch { liveTime = null; }
  }
  liveBadge();
}
function applyLive() {
  document.querySelectorAll("[data-lp]").forEach(e => { const s = byCode[e.dataset.lp]; if (s) e.textContent = money(s, s.price); });
  document.querySelectorAll("[data-lc]").forEach(e => { const s = byCode[e.dataset.lc]; if (!s) return; e.textContent = pc(s.chg); e.classList.remove("up", "down", "flat"); e.classList.add(ud(s.chg)); });
  document.querySelectorAll("[data-lph]").forEach(e => { const s = byCode[e.dataset.lph]; if (s) e.innerHTML = headPrice(s); });
}
function liveBadge() {
  const el = $("#asof");
  el.innerHTML = `${liveTime ? `<b class="live-dot">● 실시간 ${liveTime}</b>` : `<b class="stale">시세 연결 끊김</b>`}<br>점수 ${DATA_ASOF.slice(5)} 기준`;
}

/* ── router / render ── */
const VIEWS = { home: viewHome, buy: viewBuy, sell: viewSell, screen: viewScreener, my: viewMy };
function render() {
  $("#v-" + state.view).innerHTML = VIEWS[state.view]();
  for (const id of Object.keys(PICKERS)) bindSearch(id, PICKERS[id]);
  if (state.view === "screen") renderScreenerResults();
  ensureDetails();
  if (LIVE) { applyLive(); clearTimeout(window._liveSoon); window._liveSoon = setTimeout(liveTick, 300); }
  const tray = $("#tray");
  tray.innerHTML = state.cmp.length && state.view !== "my" ? `<button data-act="myt" data-arg="cmp">${ic("cmp", 16)} 비교함 ${state.cmp.length}/4 · 비교하기 ›</button>` : "";
}
function go(v) {
  state.view = v;
  document.querySelectorAll(".view").forEach(e => e.classList.toggle("on", e.id === "v-" + v));
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.arg === v));
  render(); window.scrollTo(0, 0);
}

const ACTIONS = {
  go: a => go(a),
  buy: a => { state.buy = a; go("buy"); },
  sell: a => { state.sell = a; go("sell"); },
  star: a => {
    state.watch.has(a) ? state.watch.delete(a) : state.watch.add(a);
    store.set("watch", [...state.watch]);
    toast(state.watch.has(a) ? `${byCode[a].name} 관심종목 추가` : `${byCode[a].name} 관심종목 해제`);
    render();
  },
  period: a => { state.period = a; render(); },
  mode: a => { state.mode = a; render(); },
  homemkt: a => { state.homeMkt = a; render(); },
  briefmkt: a => { state.briefMkt = a; render(); },
  altmkt: a => { state.altMkt = a; render(); },
  scrmkt: a => { state.scr.market = a; render(); },
  preset: a => { state.scr = a === "reset" ? { ...SCR_DEFAULT } : { ...SCR_DEFAULT, market: state.scr.market, ...PRESETS[+a][1] }; render(); },
  pick: (a, el) => PICKERS[el.dataset.target](a),
  copy: a => copyText(summaryText(byCode[a]), "상담 요약을 복사했습니다"),
  print: () => window.print(),
  cmpadd: a => state.cmp.includes(a) ? (state.myTab = "cmp", go("my")) : addCompare(a),
  cmpdel: a => { state.cmp = state.cmp.filter(c => c !== a); store.set("cmp", state.cmp); render(); },
  cmpclear: () => { state.cmp = []; store.set("cmp", state.cmp); render(); },
  cmpcopy: () => copyText(compareText(), "비교 요약을 복사했습니다"),
  myt: a => { state.myTab = a; state.view === "my" ? render() : go("my"); },
  calscope: a => { state.calScope = a; render(); },
  perfmkt: a => { state.perfMkt = a; render(); },
  perfbase: a => { state.perfBase = a; render(); },
  sheetclose: () => $("#sheet").classList.remove("on"),
};
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el || !ACTIONS[el.dataset.act]) return;
  e.stopPropagation();
  ACTIONS[el.dataset.act](el.dataset.arg, el);
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.perfbase !== undefined) { state.perfBase = t.value; render(); return; }
  if (t.dataset.scr) { state.scr[t.dataset.scr] = t.value; renderScreenerResults(); }
});
document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.scr && t.type === "number") { state.scr[t.dataset.scr] = t.value; renderScreenerResults(); }
});

// 데이터 신선도: 마지막 수집 후 36시간 이상이면 경고
(() => {
  const age = (Date.now() - new Date(DATA_ASOF.replace(" ", "T"))) / 36e5;
  $("#asof").innerHTML = `${DATA_ASOF} 기준${age > 36 ? ` <b class="stale">· ${Math.floor(age / 24)}일 전 데이터</b>` : ""}`;
})();
$("#ticker").innerHTML = MARKET.map(m => `<div class="tk"><b>${m.name}</b><span class="v num">${m.value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span class="c num ${ud(m.chg)}">${pc(m.chg, 2)}</span></div>`).join("");
render();
loadPerfSnaps();
liveInit();
