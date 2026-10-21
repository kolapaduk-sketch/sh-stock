// ─────────────────────────────────────────────────────────────
// 추천 엔진 (룰 기반 멀티팩터 스코어링)
// 5개 팩터 각 0~100점 → 가중평균 = 종합점수
//   가치(밸류에이션) · 성장(이익/매출) · 퀄리티(수익성/재무) · 모멘텀(가격추세) · 컨센서스(목표가·투자의견)
// 위험등급: 1년 일간 변동성(연환산) 기준 5단계
// makeEngine(종목배열): 과거 스냅샷도 같은 규칙으로 채점할 수 있도록 데이터셋별 엔진을 만든다 (추천 성과 추적용)
// ─────────────────────────────────────────────────────────────
function makeEngine(STOCKS) {
  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const ok = v => v != null && isFinite(v);

  const WEIGHTS = { value: 0.2, growth: 0.2, quality: 0.2, momentum: 0.2, consensus: 0.2 };
  const FACTOR_LABEL = { value: "가치", growth: "성장", quality: "퀄리티", momentum: "모멘텀", consensus: "컨센서스" };

  // 위험등급 (변동성 %)
  const RISK = [
    { max: 20, label: "매우 낮음" }, { max: 30, label: "낮음" }, { max: 45, label: "보통" },
    { max: 70, label: "높음" }, { max: Infinity, label: "매우 높음" },
  ];
  const riskTier = s => (ok(s.vol) ? RISK.findIndex(r => s.vol < r.max) : 2) + 1;
  const riskLabel = s => RISK[riskTier(s) - 1].label;

  // 섹터×시장 중앙 PER (표본 4개 미만이면 섹터 전체 → 시장 전체 순으로 대체)
  const keyOf = s => s.market + "|" + s.sector;
  const perOf = f => STOCKS.filter(f).map(s => s.per).filter(v => v > 0);
  const sectorPerCache = {};
  function sectorPer(s) {
    const k = keyOf(s);
    if (sectorPerCache[k]) return sectorPerCache[k];
    let p = perOf(x => keyOf(x) === k);
    if (p.length < 4) p = perOf(x => x.sector === s.sector);
    if (p.length < 4) p = perOf(x => x.market === s.market);
    return (sectorPerCache[k] = median(p));
  }

  const upsideOf = s => ok(s.target) && s.target > 0 ? (s.target / s.price - 1) * 100 : null;
  const rangePos = s => s.hi52 > s.lo52 ? (s.price - s.lo52) / (s.hi52 - s.lo52) : 0.5;
  const recLabel = r => !ok(r) ? "-" : r <= 1.5 ? "강력매수" : r <= 2.5 ? "매수" : r <= 3.5 ? "중립" : r <= 4.5 ? "매도" : "강력매도";

  // 수급: 20일 외국인+기관 순매수 금액 / 시가총액 (%)
  const flowPct = s => s.flow && s.mcap ? (s.flow.f20 + s.flow.o20) / s.mcap * 100 : null;
  const flowTxt = v => (v > 0 ? "+" : "") + Math.round(v).toLocaleString("ko-KR") + "억";

  // 기술적 지표: 이동평균(20·60·120), RSI(14), 골든/데드크로스(20일선 vs 60일선, 최근 15거래일)
  const techCache = new Map();
  function tech(s) {
    if (!s.hist || s.hist.length < 30) return null;
    if (techCache.has(s.code)) return techCache.get(s.code);
    const h = [...s.hist]; h[h.length - 1] = s.price;
    const ma = n => h.map((_, i) => i + 1 >= n ? avg(h.slice(i + 1 - n, i + 1)) : null);
    const m20 = ma(20), m60 = ma(60), m120 = ma(120), L = h.length - 1;
    let g = 0, l = 0;
    for (let i = 1; i <= 14; i++) { const d = h[i] - h[i - 1]; d > 0 ? g += d : l -= d; }
    g /= 14; l /= 14;
    for (let i = 15; i <= L; i++) { const d = h[i] - h[i - 1]; g = (g * 13 + Math.max(d, 0)) / 14; l = (l * 13 + Math.max(-d, 0)) / 14; }
    const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    let cross = null;
    for (let i = L; i > L - 15 && i > 0; i--) {
      if (m20[i] == null || m60[i] == null || m20[i - 1] == null || m60[i - 1] == null) break;
      const now = m20[i] - m60[i], prev = m20[i - 1] - m60[i - 1];
      if (now > 0 && prev <= 0) { cross = { type: "골든크로스", ago: L - i }; break; }
      if (now < 0 && prev >= 0) { cross = { type: "데드크로스", ago: L - i }; break; }
    }
    const p = h[L], a = m20[L], b = m60[L], c = m120[L];
    const align = c == null ? (a > b ? "단기 상승" : "단기 하락") : p > a && a > b && b > c ? "정배열" : p < a && a < b && b < c ? "역배열" : "혼조";
    const r = { m20, m60, m120, rsi, cross, align, disp: a ? p / a * 100 : null, ma: { 20: a, 60: b, 120: c } };
    techCache.set(s.code, r);
    return r;
  }

  // 다가오는 일정: 실적 발표·배당락 (오늘 ~ days일 이내)
  function events(list, days = 30) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const out = [];
    for (const s of list) {
      for (const [type, d] of [["실적 발표", s.earn], ["배당락", s.exdiv]]) {
        if (!d) continue;
        const dd = Math.round((new Date(d + "T00:00:00") - now) / 864e5);
        if (dd >= 0 && dd <= days) out.push({ s, type, date: d, dday: dd, est: type === "실적 발표" && s.earnEst });
      }
    }
    return out.sort((a, b) => a.dday - b.dday);
  }

  function factors(s) {
    // 가치: 섹터 대비 상대 PER 60% + 절대 PER 40%, PBR 1배 미만 가산
    let value;
    if (!(s.per > 0)) value = 15;
    else {
      const rel = clamp(100 - (s.per / sectorPer(s) - 0.5) * 60, 10, 100);
      const abs = clamp(110 - s.per * 2, 10, 100);
      value = clamp(0.6 * rel + 0.4 * abs + (ok(s.pbr) && s.pbr < 1 ? 6 : 0));
    }
    // 성장: EPS 증가율(없으면 매출 증가율), 선행 PER 40배 초과분 감점(PEG 관점)
    let growth;
    if (ok(s.epsG)) growth = 40 + clamp(s.epsG, -100, 150) * 0.4;
    else if (ok(s.revG)) growth = 40 + clamp(s.revG, -50, 100) * 0.8;
    else growth = 45;
    if (ok(s.revG) && ok(s.epsG)) growth += clamp(s.revG, -20, 40) * 0.3;
    if (ok(s.fper)) growth -= Math.max(0, (s.fper - 40) * 0.6);
    growth = clamp(growth, 5, 100);
    // 퀄리티: ROE·영업이익률·D/E
    const q = [];
    if (ok(s.roe)) q.push(clamp(s.roe * 4));
    if (ok(s.opm)) q.push(clamp(s.opm * 4));
    if (ok(s.debt)) q.push(clamp(120 - s.debt * 0.5));
    const quality = q.length ? avg(q) : 45;
    // 모멘텀: 3M·6M 수익률 + 52주 위치, 1개월 급등 시 과열 감점
    let momentum = 0.35 * clamp(50 + s.r3m * 1.5) + 0.35 * clamp(50 + s.r6m) + 0.3 * rangePos(s) * 100;
    if (s.r1m > 15) momentum -= (s.r1m - 15) * 1.2;
    const fp = flowPct(s);
    if (ok(fp)) momentum = 0.8 * momentum + 0.2 * clamp(50 + fp * 40);  // 국내: 20일 외국인·기관 수급 20% 반영
    momentum = clamp(momentum);
    // 컨센서스: 목표가 업사이드 70% + 투자의견(1=강력매수~5=강력매도) 30%. 커버리지 3곳 미만은 중립 쪽으로 수축
    const up = upsideOf(s);
    let consensus = 45;
    if (ok(up)) {
      const recScore = ok(s.rec) ? clamp((3.6 - s.rec) * 50) : 50;
      consensus = 0.7 * clamp(30 + up * 2.5) + 0.3 * recScore;
      if (s.nAnalyst < 3) consensus = 45 + (consensus - 45) * 0.5;
      if (up > 60) consensus = 45 + (consensus - 45) * 0.6;   // 목표가 괴리 과대 → 신뢰도 할인
    }
    return { value, growth, quality, momentum, consensus };
  }

  const cache = new Map();
  function score(s) {
    if (cache.has(s.code)) return cache.get(s.code);
    const f = factors(s);
    const total = Math.round(Object.keys(WEIGHTS).reduce((t, k) => t + f[k] * WEIGHTS[k], 0));
    const r = { f, total };
    cache.set(s.code, r);
    return r;
  }
  const ranked = () => STOCKS.map(s => ({ s, sc: score(s) })).sort((a, b) => b.sc.total - a.sc.total);
  let rankCache;
  const rankOf = s => { rankCache = rankCache || ranked().map(o => o.s.code); return rankCache.indexOf(s.code) + 1; };

  function grade(total) {
    if (total >= 68) return { label: "매수 우위", cls: "g-buy", desc: "팩터 전반이 우수해 신규 매수·비중 확대를 검토할 만한 구간" };
    if (total >= 58) return { label: "관심", cls: "g-watch", desc: "강점이 뚜렷하나 일부 약점 존재, 분할 접근 권장" };
    if (total >= 45) return { label: "중립", cls: "g-neutral", desc: "강점과 약점이 혼재, 추가 확인 후 판단" };
    return { label: "주의", cls: "g-caution", desc: "다수 팩터가 약해 보수적 접근 필요" };
  }

  const pct = v => (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  const money = (s, v) => s.cur === "USD" ? "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : Math.round(v).toLocaleString("ko-KR") + "원";
  const secName = s => `${s.market === "KR" ? "국내" : "미국"} ${s.sector}`;

  // 매수 분석: 추천 사유(강점) / 리스크
  function buyReasons(s) {
    const { f } = score(s);
    const pros = [], cons = [];
    const sp = sectorPer(s), up = upsideOf(s), pos = rangePos(s);

    if (s.per > 0 && s.per < sp * 0.85) pros.push({ t: "섹터 대비 저평가", d: `PER ${s.per}배로 ${secName(s)} 중앙값(${sp.toFixed(1)}배) 대비 ${((1 - s.per / sp) * 100).toFixed(0)}% 할인` });
    if (ok(s.pbr) && s.pbr < 1) pros.push({ t: "자산가치 대비 저평가", d: `PBR ${s.pbr}배로 장부가치 이하에서 거래` });
    if (ok(s.epsG) && s.epsG >= 25) pros.push({ t: "이익 고성장", d: `최근 분기 EPS 증가율 ${pct(s.epsG)}${ok(s.fper) && s.per > 0 && s.fper < s.per ? `, 선행 PER ${s.fper}배로 하락 예상` : ""}` });
    else if (ok(s.revG) && s.revG >= 20) pros.push({ t: "매출 고성장", d: `최근 분기 매출 증가율 ${pct(s.revG)}` });
    if (ok(s.roe) && s.roe >= 15) pros.push({ t: "높은 자본효율", d: `ROE ${s.roe.toFixed(1)}%로 우수한 수익성` });
    if (ok(s.opm) && s.opm >= 20) pros.push({ t: "고마진 사업구조", d: `영업이익률 ${s.opm.toFixed(1)}%` });
    if (f.momentum >= 70) pros.push({ t: "견조한 상승 추세", d: `3개월 ${pct(s.r3m)}, 6개월 ${pct(s.r6m)} 수익률` });
    if (ok(up) && up >= 15 && up <= 60 && s.nAnalyst >= 3) pros.push({ t: "목표가 상승여력", d: `애널리스트 ${s.nAnalyst}명 평균 목표가 ${money(s, s.target)} 대비 ${pct(up)}` });
    if (ok(s.rec) && s.rec <= 1.8 && s.nAnalyst >= 5) pros.push({ t: "애널리스트 강한 매수 의견", d: `투자의견 평균 ${s.rec.toFixed(1)}점(1=강력매수, ${s.nAnalyst}명)` });
    if (s.div >= 3.5) pros.push({ t: "고배당", d: `배당수익률 ${s.div.toFixed(1)}%로 하방 방어력` });
    const fl = s.flow, tc = tech(s);
    if (fl && fl.f5 > 0 && fl.o5 > 0) pros.push({ t: "외국인·기관 동반 순매수", d: `최근 5일 외국인 ${flowTxt(fl.f5)} · 기관 ${flowTxt(fl.o5)}${fl.fstreak >= 3 ? `, 외국인 ${fl.fstreak}일 연속 순매수` : ""}` });
    else if (fl && fl.fstreak >= 5) pros.push({ t: "외국인 연속 순매수", d: `${fl.fstreak}거래일 연속, 5일 누적 ${flowTxt(fl.f5)}` });
    if (tc && tc.cross && tc.cross.type === "골든크로스") pros.push({ t: "골든크로스", d: `${tc.cross.ago ? tc.cross.ago + "거래일 전" : "오늘"} 20일선이 60일선 상향 돌파` });
    else if (tc && tc.align === "정배열") pros.push({ t: "이동평균 정배열", d: "주가 > 20일 > 60일 > 120일선 — 상승 추세 유지" });

    if (!(s.per > 0)) cons.push({ t: "적자 상태", d: "최근 4분기 순이익 적자로 PER 산출 불가" });
    else if (s.per > sp * 1.4) cons.push({ t: "밸류에이션 부담", d: `PER ${s.per}배, ${secName(s)} 중앙값 대비 ${((s.per / sp - 1) * 100).toFixed(0)}% 할증` });
    if (ok(s.epsG) && s.epsG < -10) cons.push({ t: "이익 감소", d: `최근 분기 EPS 증가율 ${pct(s.epsG)}` });
    if (s.r1m >= 15) cons.push({ t: "단기 과열", d: `1개월 ${pct(s.r1m)} 급등, 눌림목 대기 고려` });
    if (pos >= 0.92) cons.push({ t: "52주 고점 근접", d: `52주 밴드 상단 ${(pos * 100).toFixed(0)}% 위치` });
    if (s.r3m < 0 && s.r6m < 0) cons.push({ t: "하락 추세", d: `3개월 ${pct(s.r3m)}, 6개월 ${pct(s.r6m)}` });
    if (ok(up) && up > 60) cons.push({ t: "목표가 괴리 과대", d: `평균 목표가 ${money(s, s.target)}가 현재가 대비 ${pct(up)} — 최근 주가 급변으로 컨센서스 하향 가능성 점검` });
    if (ok(up) && up < 3) cons.push({ t: "목표가 도달", d: `평균 목표가 대비 ${pct(up)} — 컨센서스 상향 여부 확인 필요` });
    if (ok(s.debt) && s.debt >= 150) cons.push({ t: "재무 레버리지", d: `부채/자본(D/E) ${s.debt}%` });
    if (riskTier(s) >= 4) cons.push({ t: "높은 변동성", d: `연 변동성 ${s.vol}% — 위험등급 '${riskLabel(s)}'` });
    if (fl && fl.f5 < 0 && fl.o5 < 0) cons.push({ t: "외국인·기관 동반 순매도", d: `최근 5일 외국인 ${flowTxt(fl.f5)} · 기관 ${flowTxt(fl.o5)}` });
    if (tc && tc.rsi >= 70) cons.push({ t: "RSI 과열", d: `RSI ${tc.rsi.toFixed(0)} — 단기 과매수 구간` });
    if (tc && tc.cross && tc.cross.type === "데드크로스") cons.push({ t: "데드크로스", d: `${tc.cross.ago ? tc.cross.ago + "거래일 전" : "오늘"} 20일선이 60일선 하향 이탈` });

    return { pros: pros.slice(0, 6), cons: cons.slice(0, 5) };
  }

  // 매도 점검: 매도 근거 / 보유 근거
  function sellCheck(s) {
    const { f, total } = score(s);
    const up = upsideOf(s), pos = rangePos(s), sp = sectorPer(s);
    const sell = [], hold = [];
    if (ok(up) && up < 5) sell.push(`평균 목표가 대비 상승여력 ${pct(up)} — 기대수익 소진 구간`);
    if (s.per > sp * 1.4) sell.push(`섹터 대비 PER 할증 ${((s.per / sp - 1) * 100).toFixed(0)}% — 밸류 부담`);
    if (!(s.per > 0)) sell.push("적자 지속 — 실적 가시성 낮음");
    if (s.r1m < -3 && s.r3m > 10) sell.push(`상승 후 1개월 ${pct(s.r1m)} 꺾임 — 추세 둔화 신호`);
    if (s.r3m < 0 && s.r6m < 0) sell.push("3·6개월 연속 하락 추세");
    if (pos >= 0.92 && s.r1m > 12) sell.push("52주 고점권 단기 급등 — 차익실현 고려 구간");
    if (ok(s.epsG) && s.epsG < -10) sell.push(`이익 역성장(EPS ${pct(s.epsG)})`);
    if (ok(s.rec) && s.rec >= 3) sell.push(`애널리스트 투자의견 ${recLabel(s.rec)}(${s.rec.toFixed(1)})`);
    const nd = newsDigest(s.code);
    if (nd.tone === "부정 우세") sell.push(`최근 뉴스·공시 부정 키워드 우세(부정 ${nd.neg} / 긍정 ${nd.pos})`);
    if (nd.tone === "긍정 우세") hold.push(`최근 뉴스·공시 긍정 키워드 우세(긍정 ${nd.pos} / 부정 ${nd.neg})`);
    const fl = s.flow, tc = tech(s);
    if (fl && fl.f5 < 0 && fl.o5 < 0) sell.push(`외국인·기관 5일 동반 순매도 (외국인 ${flowTxt(fl.f5)}, 기관 ${flowTxt(fl.o5)})`);
    if (fl && fl.f5 > 0 && fl.o5 > 0) hold.push(`외국인·기관 5일 동반 순매수 (외국인 ${flowTxt(fl.f5)}, 기관 ${flowTxt(fl.o5)})`);
    if (tc && tc.rsi >= 70) sell.push(`RSI ${tc.rsi.toFixed(0)} 과매수 — 분할 차익실현 고려`);
    if (tc && tc.rsi <= 30) hold.push(`RSI ${tc.rsi.toFixed(0)} 과매도 — 저점 매도 주의`);
    if (tc && tc.cross && tc.cross.type === "데드크로스") sell.push(`데드크로스 발생 (${tc.cross.ago}거래일 전)`);
    for (const e of events([s], 14)) hold.push(`${e.type} D-${e.dday} (${e.date}) — 일정 전후 변동성 유의`);
    if (total >= 68) hold.push(`종합점수 ${total}점으로 상위권 — 전량 매도보다 비중 조절 검토`);
    if (f.growth >= 75) hold.push("이익·매출 고성장 지속");
    if (ok(up) && up >= 15) hold.push(`평균 목표가 대비 ${pct(up)} 여력 잔존${up > 60 ? " (괴리 과대, 하향 가능성 유의)" : ""}`);
    if (s.div >= 4) hold.push(`배당수익률 ${s.div.toFixed(1)}% — 배당 기준일 확인 필요`);
    const verdict = sell.length >= 2 && total < 62 ? { t: "매도 근거 충분", cls: "g-caution" }
      : sell.length > hold.length ? { t: "부분 매도 고려", cls: "g-neutral" }
      : { t: "보유 우위", cls: "g-buy" };
    return { sell, hold, verdict };
  }

  // 매도 종목 → 대체 매수 추천
  // mode: "similar"(동일 섹터) | "diversify"(다른 섹터·저변동) | "best"(전체 상위)
  // opt: { market: "all"|"KR"|"US" }
  function alternatives(sold, mode = "similar", opt = {}, n = 5) {
    const base = score(sold);
    let pool = STOCKS.filter(s => s.code !== sold.code);
    if (opt.market && opt.market !== "all") pool = pool.filter(s => s.market === opt.market);
    if (mode === "similar") pool = pool.filter(s => s.sector === sold.sector);
    if (mode === "diversify") pool = pool.filter(s => s.sector !== sold.sector);
    return pool.map(s => {
      const sc = score(s);
      let fit = sc.total;
      if (mode === "similar" && s.industry === sold.industry) fit += 4;     // 동일 업종 가산
      if (mode === "similar" && s.market === sold.market) fit += 2;
      if (mode === "diversify" && ok(s.vol)) fit += (30 - s.vol) * 0.25;    // 저변동 가산
      const why = [];
      const ranked = Object.keys(WEIGHTS).map(k => [k, sc.f[k] - base.f[k]]).sort((a, b) => b[1] - a[1]);
      for (const [k, v] of ranked.slice(0, 2)) if (v > 5) why.push(`${FACTOR_LABEL[k]} +${v.toFixed(0)}`);
      return { s, sc, fit, delta: sc.total - base.total, why, reasons: buyReasons(s).pros.slice(0, 2) };
    }).sort((a, b) => b.fit - a.fit).slice(0, n);
  }

  // 뉴스·공시 키워드 요약 (룰 기반: 긍정/부정 키워드와 주요 이슈 분류)
  const POS = ["수주", "계약", "공급", "최대", "흑자", "상향", "신고가", "자사주", "배당", "승인", "인수", "호실적", "급등", "성장", "돌파", "확대", "강세",
    "beat", "upgrade", "record", "raise", "wins", "contract", "approval", "buyback", "surge", "soar", "jump", "rally", "tops", "strong"];
  const NEG = ["유상증자", "소송", "적자", "하향", "리콜", "감자", "횡령", "조사", "급락", "손실", "제재", "거래정지", "부진", "우려", "약세", "하락", "매도",
    "downgrade", "miss", "lawsuit", "probe", "recall", "cut", "plunge", "fall", "loss", "slump", "sink", "drop", "warn", "weak"];
  const TOPICS = {
    "실적": ["실적", "영업이익", "매출", "어닝", "earnings", "revenue", "profit", "guidance", "quarter"],
    "수주·계약": ["수주", "계약", "공급", "contract", "deal", "order"],
    "주주환원": ["자사주", "자기주식", "배당", "소각", "buyback", "dividend"],
    "자금조달": ["유상증자", "전환사채", "증자", "offering"],
    "M&A": ["인수", "합병", "acquire", "acquisition", "merger"],
    "규제·소송": ["소송", "제재", "조사", "lawsuit", "probe", "regulator", "antitrust"],
    "AI·반도체": ["AI", "HBM", "반도체", "chip", "GPU", "data center"],
    "목표가·의견": ["목표가", "투자의견", "price target", "upgrade", "downgrade", "rating"],
  };
  const has = (t, kw) => /^[A-Za-z]/.test(kw) ? new RegExp("\\b" + kw, kw === "AI" ? "" : "i").test(t) : t.includes(kw);
  function newsDigest(code) {
    const d = (typeof NEWS !== "undefined" && NEWS[code]) || { news: [], disc: [] };
    const texts = [...d.news.map(n => n.t + " " + (n.b || "")), ...d.disc.map(n => n.t)];
    let pos = 0, neg = 0;
    const topic = {};
    for (const t of texts) {
      const p = POS.some(k => has(t, k)), n = NEG.some(k => has(t, k));
      if (p && !n) pos++; else if (n && !p) neg++;
      for (const [k, kws] of Object.entries(TOPICS)) if (kws.some(w => has(t, w))) topic[k] = (topic[k] || 0) + 1;
    }
    const topics = Object.entries(topic).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
    const tone = pos >= neg + 2 ? "긍정 우세" : neg >= pos + 2 ? "부정 우세" : "중립";
    return { ...d, pos, neg, topics, tone, n: texts.length };
  }
  function discTag(t) {
    if (/잠정|영업실적|실적/.test(t)) return "실적";
    if (/자기주식|소각/.test(t)) return "자사주";
    if (/배당/.test(t)) return "배당";
    if (/유상증자|무상증자|전환사채|신주인수권/.test(t)) return "자금조달";
    if (/소유상황|대량보유|임원/.test(t)) return "지분변동";
    if (/기업설명회|IR/.test(t)) return "IR";
    if (/정정/.test(t)) return "정정";
    return "공시";
  }

  // 전일 시장 분석 → 매수 가망 업종 + 대표 종목
  // 섹터별: 전일 등락(25%) · 상승 종목 비율(15%) · 1개월 추세(20%) · 평균 종합점수(40%)를 표준화(z)해 합산
  function marketBrief(market) {
    const pool = STOCKS.filter(s => s.market === market);
    const by = {};
    for (const s of pool) (by[s.sector] = by[s.sector] || []).push(s);
    const secs = Object.entries(by).filter(([sec, g]) => g.length >= 3 && sec !== "기타").map(([sector, g]) => ({
      sector, n: g.length,
      d1: avg(g.map(s => s.chg)), up: g.filter(s => s.chg > 0).length,
      m1: avg(g.map(s => s.r1m)), sc: avg(g.map(s => score(s).total)),
      picks: g.map(s => ({ s, t: score(s).total })).sort((a, b) => b.t - a.t).slice(0, 3).map(o => o.s),
      f5: g.reduce((t, s) => t + (s.flow ? s.flow.f5 + s.flow.o5 : 0), 0),
      fp: avg(g.map(s => s.flow && s.mcap ? (s.flow.f5 + s.flow.o5) / s.mcap * 100 : 0)),
    }));
    const hasFlow = pool.some(s => s.flow);
    const z = k => { const v = secs.map(o => o[k]), m = avg(v), sd = Math.sqrt(avg(v.map(x => (x - m) ** 2))) || 1; secs.forEach(o => o["z_" + k] = (o[k] - m) / sd); };
    secs.forEach(o => o.br = o.up / o.n);
    ["d1", "br", "m1", "sc", "fp"].forEach(z);
    secs.forEach(o => {
      o.fit = hasFlow ? 0.2 * o.z_d1 + 0.1 * o.z_br + 0.15 * o.z_m1 + 0.35 * o.z_sc + 0.2 * o.z_fp
                      : 0.25 * o.z_d1 + 0.15 * o.z_br + 0.2 * o.z_m1 + 0.4 * o.z_sc;
      const why = [];
      if (o.d1 > 0.5) why.push(`전일 평균 ${pct(o.d1)}, ${o.n}종목 중 ${o.up}개 상승`);
      else if (o.d1 < -0.5) why.push(`전일 ${pct(o.d1)} 조정 — 분할 매수 기회 여부 점검`);
      if (o.m1 > 3) why.push(`1개월 추세 ${pct(o.m1)}로 자금 유입 지속`);
      if (hasFlow && Math.abs(o.f5) >= 100) why.push(`외국인·기관 5일 ${o.f5 > 0 ? "순매수" : "순매도"} ${flowTxt(o.f5)}`);
      if (o.sc >= 65) why.push(`업종 평균 종합점수 ${o.sc.toFixed(0)}점으로 펀더멘털 양호`);
      if (!why.length) why.push(`업종 평균 종합점수 ${o.sc.toFixed(0)}점, 1개월 ${pct(o.m1)}`);
      o.why = why;
    });
    secs.sort((a, b) => b.fit - a.fit);
    const up = pool.filter(s => s.chg > 0).length, dn = pool.filter(s => s.chg < 0).length;
    const avgChg = avg(pool.map(s => s.chg));
    const byD1 = [...secs].sort((a, b) => b.d1 - a.d1);
    const mood = avgChg > 1 && up > dn * 1.5 ? "강세" : avgChg < -1 && dn > up * 1.5 ? "약세" : avgChg >= 0 ? "혼조 속 강보합" : "혼조 속 약보합";
    const flowTop = hasFlow ? [...secs].sort((a, b) => b.f5 - a.f5)[0] : null;
    return { top: secs.slice(0, 3), all: secs, up, dn, hasFlow, flowTop, n: pool.length, avgChg, mood, best: byD1[0], worst: byD1[byD1.length - 1] };
  }

  // 조건검색
  function screen(c) {
    return ranked().filter(({ s, sc }) =>
      (c.market === "all" || s.market === c.market) &&
      (!c.sector || s.sector === c.sector) &&
      (!c.perMax || (s.per > 0 && s.per <= c.perMax)) &&
      (!c.roeMin || (ok(s.roe) && s.roe >= c.roeMin)) &&
      (!c.divMin || s.div >= c.divMin) &&
      (!c.scoreMin || sc.total >= c.scoreMin) &&
      (!c.capMin || s.mcap >= c.capMin * 10000) &&
      (!c.upMin || (ok(upsideOf(s)) && upsideOf(s) >= c.upMin)));
  }

  return { score, grade, ranked, rankOf, buyReasons, sellCheck, alternatives, screen, upsideOf, rangePos, sectorPer, recLabel,
    riskTier, riskLabel, money, RISK, newsDigest, discTag, marketBrief, flowPct, flowTxt, tech, events, FACTOR_LABEL, WEIGHTS };
}
const Engine = makeEngine(STOCKS);
