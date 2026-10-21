// ─────────────────────────────────────────────────────────────
// SH STOCK · UI
// ─────────────────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const byCode = Object.fromEntries(STOCKS.map(s => [s.code, s]));
const SECTORS = [...new Set(STOCKS.map(s => s.sector))].sort();
const HAS_NEWS = typeof NEWS !== "undefined";

const store = {
  get(k, d) { try { const v = localStorage.getItem("sh_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sh_" + k, JSON.stringify(v)); } catch {} },
};
const SCR_DEFAULT = { market: "all", sector: "", perMax: "", roeMin: "", divMin: "", scoreMin: "", capMin: "", upMin: "" };
const state = {
  view: "home", buy: null, sell: null, mode: "similar", period: "3M",
  homeMkt: "all", altMkt: "all", briefMkt: "KR", scr: { ...SCR_DEFAULT },
  myTab: "cmp", logQ: "",
  watch: new Set(store.get("watch", [])),
  cmp: store.get("cmp", []).filter(c => byCode[c]),
  logs: store.get("logs", []),
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
  const len = Math.min({ "1M": 21, "3M": 63, "6M": 126, "1Y": 250 }[period], s.hist.length);
  const d = s.hist.slice(-len);
  d[d.length - 1] = s.price;
  return d;
}
function chartSVG(s, period) {
  const d = series(s, period);
  const lo = Math.min(...d), hi = Math.max(...d), W = 400, H = 150, pad = 8;
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
    <div class="row-r"><b class="num">${money(s, s.price)}</b><span class="num ${ud(s.chg)}">${pc(s.chg)}</span></div>
    ${sbadge(Engine.score(s).total)}</div>`;
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
      <div class="picks">${o.picks.map(s => `<div class="pick" data-act="buy" data-arg="${s.code}"><b>${s.name}</b><span class="num">${money(s, s.price)} <em class="${ud(s.chg)}">${pc(s.chg)}</em></span>${sbadge(Engine.score(s).total)}</div>`).join("")}</div>
    </div>`).join("")}
    <p class="note" style="color:rgba(255,255,255,.55)">업종 선정: 전일 등락 25% · 상승 종목 비율 15% · 1개월 추세 20% · 평균 종합점수 40% (룰 기반, 투자 권유 아님)</p>
  </section>`;
}

/* ── 홈 ── */
function dueLogs() { const t = today(); return state.logs.filter(l => l.next && l.next <= t && !l.done); }
function viewHome() {
  const pool = Engine.ranked().filter(o => state.homeMkt === "all" || o.s.market === state.homeMkt);
  const secs = [...new Set(pool.map(o => o.s.sector))].map(sec => {
    const g = pool.filter(o => o.s.sector === sec).map(o => o.s);
    return { sec, n: g.length, r: g.reduce((a, s) => a + s.r1m, 0) / g.length };
  }).sort((a, b) => b.r - a.r);
  const heatCol = r => { const a = Math.min(Math.abs(r) / 10, 1) * .75 + .25; return r >= 0 ? `rgba(229,50,45,${a})` : `rgba(30,100,216,${a})`; };
  const due = dueLogs();
  return `
  ${briefCard()}
  ${due.length ? `<button class="due" data-act="myt" data-arg="log"><b>연락 예정 ${due.length}건</b><span>${due.slice(0, 2).map(l => esc(l.client)).join(", ")}${due.length > 2 ? " 외" : ""} — 상담 이력 보기 ›</span></button>` : ""}
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
  ${verifyCard()}
  <div class="card">
    <div class="card-h"><div class="card-t">섹터 1개월 수익률</div><div class="card-s">종목 단순평균</div></div>
    <div class="heat">${secs.map(o => `<div style="background:${heatCol(o.r)}"><b>${o.sec} <em>${o.n}</em></b><span class="num">${pc(o.r)}</span></div>`).join("")}</div>
  </div>
  ${disclaimer}`;
}

/* ── 매수 분석 ── */
function stockHead(s) {
  const c = chartSVG(s, state.period), on = state.watch.has(s.code), prev = s.price / (1 + s.chg / 100);
  return `<div class="card">
    <div class="sh"><div><div class="sh-name">${s.name}</div>
      <div class="sh-meta"><span>${s.code}</span>${mktBadge(s)}<span class="badge">${s.exch}</span><span class="badge">${s.sector}</span>${riskBadge(s)}</div>
      <div class="sh-sub">${esc(s.en)}${s.industry ? " · " + s.industry : ""}</div></div>
      <button class="star noprint ${on ? "on" : ""}" data-act="star" data-arg="${s.code}" aria-label="관심종목"><svg width="18" height="18" viewBox="0 0 24 24" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round">${ICON.star}</svg></button></div>
    <div class="price num ${ud(s.chg)}">${s.cur === "USD" ? "$" + s.price.toLocaleString("en-US", { minimumFractionDigits: 2 }) : won(s.price) + "<small>원</small>"}</div>
    <div class="pchg num ${ud(s.chg)}">${arrow(s.chg)} ${s.cur === "USD" ? "$" + Math.abs(s.price - prev).toFixed(2) : won(Math.abs(s.price - prev))} (${pc(s.chg, 2)}) <span class="flat" style="font-weight:500">${krwHint(s)}</span></div>
    <div style="margin-top:14px" class="noprint">${seg([["1M", "1개월"], ["3M", "3개월"], ["6M", "6개월"], ["1Y", "1년"]], state.period, "period")}</div>
    <div class="chart">${c.svg}</div>
    <div class="chart-foot num"><span>기간 수익률 <b class="${ud(c.r)}">${pc(c.r)}</b></span><span>최고 ${money(s, c.hi)} · 최저 ${money(s, c.lo)}</span></div>
  </div>`;
}

function newsCard(s) {
  if (!HAS_NEWS) return "";
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
    <button data-act="logadd" data-arg="${s.code}">${ic("note")}<span>상담 기록</span></button>
    <button data-act="cmpadd" data-arg="${s.code}" class="${inCmp ? "on" : ""}">${ic("cmp")}<span>${inCmp ? "비교 중" : "비교 담기"}</span></button>
    <button data-act="print">${ic("print")}<span>인쇄·PDF</span></button>
    <button data-act="sell" data-arg="${s.code}">${ic("swap")}<span>교체 추천</span></button>
  </div>
  <div class="card">
    <div class="card-h"><div class="card-t">AI 투자의견</div><div class="card-s">${STOCKS.length}종목 중 ${Engine.rankOf(s)}위</div></div>
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
    <div class="card-h"><div class="card-t">매도 점검</div><div class="card-s">종합점수 ${base.total}점 · ${Engine.rankOf(s)}위</div></div>
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
        <div class="row-main"><b>${t.name}</b><span>${t.market === "US" ? "미국" : "국내"} · ${t.industry || t.sector} · ${money(t, t.price)} <span class="${ud(t.chg)}">${pc(t.chg)}</span></span></div>
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
  ["뉴스 톤", s => HAS_NEWS ? Engine.newsDigest(s.code).tone : null, v => v],
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
    <div class="chart" style="height:160px">${overlaySVG(list, state.period)}</div>
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

/* ── MY: 상담 이력 ── */
const LOG_TYPES = ["매수 상담", "매도 상담", "교체 상담", "포트폴리오 점검", "일반 문의"];
const LOG_REACT = ["관심", "검토 중", "보류", "매수 결정", "매도 결정", "거절"];
function saveLogs() { store.set("logs", state.logs); }
function openLogForm(code = "", id = null) {
  const e = id ? state.logs.find(l => l.id === id) : null;
  const sel = e ? e.code : code;
  const opts = [...STOCKS].sort((a, b) => a.name.localeCompare(b.name, "ko")).map(s => `<option value="${s.code}" ${s.code === sel ? "selected" : ""}>${s.name} (${s.code})</option>`).join("");
  $("#sheet").innerHTML = `<div class="sheet-bg" data-act="sheetclose"></div><div class="sheet-p">
    <div class="sheet-h"><b>${e ? "상담 기록 수정" : "상담 기록"}</b><button data-act="sheetclose">✕</button></div>
    <p class="sheet-d">기록은 이 기기의 브라우저에만 저장됩니다. 주민번호·계좌번호·연락처 등 민감한 개인정보는 입력하지 마세요.</p>
    <div class="fgrid2">
      <label class="fld"><span>고객 (이름·별칭)*</span><input id="lf-client" maxlength="30" value="${esc(e?.client || "")}" placeholder="예: 김OO 고객"></label>
      <label class="fld"><span>상담일</span><input id="lf-date" type="date" value="${e?.date || today()}"></label>
      <label class="fld"><span>구분</span><select id="lf-type">${LOG_TYPES.map(t => `<option ${e?.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="fld"><span>고객 반응</span><select id="lf-react">${LOG_REACT.map(t => `<option ${e?.react === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    </div>
    <label class="fld" style="margin-top:8px"><span>관련 종목</span><select id="lf-code"><option value="">(종목 없음)</option>${opts}</select></label>
    <label class="fld" style="margin-top:8px"><span>메모</span><textarea id="lf-memo" rows="3" maxlength="500" placeholder="상담 내용, 고객 의견 등">${esc(e?.memo || "")}</textarea></label>
    <label class="fld" style="margin-top:8px"><span>다음 연락일 (선택)</span><input id="lf-next" type="date" value="${e?.next || ""}"></label>
    <button class="btn-pri" data-act="logsave" data-arg="${e ? e.id : ""}">${e ? "수정 저장" : "저장"}</button>
  </div>`;
  $("#sheet").classList.add("on");
  setTimeout(() => $("#lf-client").focus(), 50);
}
function saveLogForm(id) {
  const v = k => $("#lf-" + k).value.trim();
  if (!v("client")) { toast("고객 이름(별칭)을 입력하세요"); $("#lf-client").focus(); return; }
  const s = byCode[v("code")];
  const rec = { client: v("client"), date: v("date") || today(), type: v("type"), react: v("react"), code: v("code"), memo: v("memo"), next: v("next") };
  if (id) {
    const e = state.logs.find(l => l.id === id);
    if (e.code !== rec.code) Object.assign(e, { price: s ? s.price : null, score: s ? Engine.score(s).total : null });
    Object.assign(e, rec);
  } else {
    state.logs.unshift({ id: Date.now().toString(36), ...rec, price: s ? s.price : null, score: s ? Engine.score(s).total : null, created: new Date().toISOString(), done: false });
  }
  saveLogs();
  $("#sheet").classList.remove("on");
  toast("상담 기록을 저장했습니다");
  if (state.view === "my") render(); else { state.myTab = "log"; go("my"); }
}
function logCard(l) {
  const s = byCode[l.code], t = today();
  const since = s && l.price ? (s.price / l.price - 1) * 100 : null;
  const due = l.next && !l.done ? (l.next < t ? "overdue" : l.next === t ? "today" : "") : "";
  return `<div class="log">
    <div class="log-h"><b>${esc(l.client)}</b><span class="badge">${esc(l.type)}</span><span class="badge react">${esc(l.react)}</span><span class="log-d">${esc(l.date)}</span></div>
    ${s ? `<div class="log-s" data-act="buy" data-arg="${s.code}"><span>${s.name}</span><span class="num">상담 시 ${money(s, l.price)} → 현재 ${money(s, s.price)} <b class="${ud(since)}">${pc(since)}</b></span></div>` : ""}
    ${l.memo ? `<p class="log-m">${esc(l.memo)}</p>` : ""}
    <div class="log-f">
      ${l.next ? `<span class="next ${due}">${l.done ? "✓ 연락 완료" : `다음 연락 ${esc(l.next)}${due === "overdue" ? " (지남)" : due === "today" ? " (오늘)" : ""}`}</span>` : "<span></span>"}
      <span class="log-btns">${l.next && !l.done ? `<button data-act="logdone" data-arg="${l.id}">연락 완료</button>` : ""}<button data-act="logedit" data-arg="${l.id}">수정</button><button data-act="logdel" data-arg="${l.id}">삭제</button></span>
    </div>
  </div>`;
}
function viewLogs() {
  const q = state.logQ.trim().toLowerCase();
  const list = state.logs.filter(l => !q || l.client.toLowerCase().includes(q) || (byCode[l.code]?.name || "").toLowerCase().includes(q) || (l.memo || "").toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created));
  const due = dueLogs();
  return `<div class="log-top">
      <button class="btn-pri" data-act="logadd" data-arg="">+ 새 상담 기록</button>
      <button class="btn-sec" data-act="csv" ${state.logs.length ? "" : "disabled"}>엑셀(CSV) 저장</button>
    </div>
    <div class="search"><div class="search-box"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A94A3" stroke-width="2.2" stroke-linecap="round">${ICON.search}</svg>
      <input id="log-q" placeholder="고객·종목·메모 검색" value="${esc(state.logQ)}" autocomplete="off"></div></div>
    ${due.length && !q ? `<div class="card"><div class="card-h"><div class="card-t">연락 예정 ${due.length}건</div><div class="card-s">오늘까지</div></div>${due.map(logCard).join("")}</div>` : ""}
    <div class="card"><div class="card-h"><div class="card-t">상담 이력 ${list.length}건</div><div class="card-s">최근순</div></div>
      ${list.length ? list.map(logCard).join("") : `<div class="empty-note">${q ? "검색 결과가 없습니다" : "아직 기록이 없습니다. 매수 분석 화면의 '상담 기록' 버튼이나 위 버튼으로 추가하세요."}</div>`}
    </div>
    <p class="note" style="padding:0 4px">기록은 이 기기 브라우저에만 저장됩니다. 브라우저 데이터를 지우면 사라지니 주기적으로 CSV로 저장하세요.</p>`;
}
function exportCSV() {
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["상담일", "고객", "구분", "고객반응", "종목코드", "종목명", "상담시 가격", "현재가", "상담 후 수익률(%)", "상담시 점수", "메모", "다음 연락일", "연락완료"]];
  for (const l of state.logs) {
    const s = byCode[l.code];
    rows.push([l.date, l.client, l.type, l.react, l.code, s?.name || "", l.price ?? "", s?.price ?? "", s && l.price ? ((s.price / l.price - 1) * 100).toFixed(2) : "", l.score ?? "", l.memo, l.next, l.done ? "Y" : ""]);
  }
  const blob = new Blob(["﻿" + rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `상담이력_${today()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ── MY ── */
function viewWatch() {
  const list = [...state.watch].map(c => byCode[c]).filter(Boolean);
  if (!list.length) return `<div class="empty"><div class="ic">${ic("star", 26)}</div><b>관심종목이 없습니다</b><p>매수 분석에서 종목을 검색한 뒤<br>☆ 버튼으로 추가할 수 있어요</p></div>`;
  return `<div class="card">${list.map(s => stockRow(s)).join("")}</div>`;
}
function viewMy() {
  const tabs = [["cmp", `종목 비교${state.cmp.length ? " " + state.cmp.length : ""}`], ["log", `상담 이력${state.logs.length ? " " + state.logs.length : ""}`], ["watch", `관심종목${state.watch.size ? " " + state.watch.size : ""}`]];
  const body = { cmp: viewCompare, log: viewLogs, watch: viewWatch }[state.myTab]();
  return `<div class="sec-title noprint">MY 업무</div><div class="noprint" style="margin:10px 0 14px">${seg(tabs, state.myTab, "myt", "seg-navy")}</div>${body}`;
}

/* ── 상담 요약 ── */
function summaryText(s) {
  const { total } = Engine.score(s), g = Engine.grade(total), rs = Engine.buyReasons(s), up = Engine.upsideOf(s);
  const nd = HAS_NEWS ? Engine.newsDigest(s.code) : null;
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
    ...(nd && nd.n ? [``, `■ 최근 뉴스·공시 (${nd.tone}${nd.topics.length ? ", " + nd.topics.join("·") : ""})`, ...nd.news.slice(0, 3).map(n => `- ${n.t}`)] : []),
    ``,
    `※ 본 자료는 공개 데이터 기반 참고자료로 투자 권유가 아니며, 투자 결과의 책임은 투자자 본인에게 있습니다. 과거 수익률이 미래 수익을 보장하지 않습니다.`,
  ];
  return L.filter((l, i) => l !== "" || L[i - 1] !== "").join("\n");
}

/* ── router / render ── */
const VIEWS = { home: viewHome, buy: viewBuy, sell: viewSell, screen: viewScreener, my: viewMy };
function render() {
  $("#v-" + state.view).innerHTML = VIEWS[state.view]();
  for (const id of Object.keys(PICKERS)) bindSearch(id, PICKERS[id]);
  if (state.view === "screen") renderScreenerResults();
  const tray = $("#tray");
  tray.innerHTML = state.cmp.length && state.view !== "my" ? `<button data-act="myt" data-arg="cmp">${ic("cmp", 16)} 비교함 ${state.cmp.length}/4 · 비교하기 ›</button>` : "";
  const lq = $("#log-q");
  if (lq) lq.addEventListener("input", () => { state.logQ = lq.value; const pos = lq.selectionStart; render(); const n = $("#log-q"); n.focus(); n.setSelectionRange(pos, pos); });
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
  logadd: a => openLogForm(a),
  logedit: a => openLogForm("", a),
  logsave: a => saveLogForm(a || null),
  logdone: a => { const l = state.logs.find(l => l.id === a); if (l) { l.done = true; saveLogs(); toast("연락 완료로 표시했습니다"); render(); } },
  logdel: a => { const l = state.logs.find(l => l.id === a); if (l && confirm(`${l.client} 고객의 ${l.date} 상담 기록을 삭제할까요?`)) { state.logs = state.logs.filter(x => x.id !== a); saveLogs(); render(); } },
  csv: () => exportCSV(),
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
