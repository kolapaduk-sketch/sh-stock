"""
SH STOCK 데이터 수집기
  python tools/fetch_data.py
국내·미국 종목의 시세(1년 일봉)·재무지표·애널리스트 컨센서스를 Yahoo Finance 공개 엔드포인트에서 받아
app/data.js 로 저장한다. 외부 패키지 없이 표준 라이브러리만 사용.
"""
import json, math, time, sys, statistics, datetime, html, re, http.cookiejar, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from universe import KR_LIST, US_LIST

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "data.js"
NEWS_OUT = ROOT / "app" / "news.js"
PER_MARKET = 250

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
opener.addheaders = [("User-Agent", UA)]

SECTOR_KO = {
    "Technology": "기술", "Financial Services": "금융", "Healthcare": "헬스케어", "Consumer Cyclical": "경기소비재",
    "Consumer Defensive": "필수소비재", "Industrials": "산업재", "Basic Materials": "소재", "Energy": "에너지",
    "Utilities": "유틸리티", "Communication Services": "커뮤니케이션", "Real Estate": "부동산",
}
INDUSTRY_KO = {
    "Semiconductors": "반도체", "Semiconductor Equipment & Materials": "반도체장비·소재", "Consumer Electronics": "가전·IT기기",
    "Software - Infrastructure": "인프라 소프트웨어", "Software - Application": "응용 소프트웨어", "Internet Content & Information": "인터넷",
    "Internet Retail": "온라인 유통", "Auto Manufacturers": "자동차", "Auto Parts": "자동차부품", "Banks - Diversified": "은행",
    "Banks - Regional": "은행", "Insurance - Life": "생명보험", "Insurance - Property & Casualty": "손해보험", "Insurance - Diversified": "보험",
    "Capital Markets": "증권·자본시장", "Credit Services": "카드·결제", "Asset Management": "자산운용", "Financial Conglomerates": "금융지주",
    "Drug Manufacturers - General": "제약", "Drug Manufacturers - Specialty & Generic": "제약", "Biotechnology": "바이오",
    "Medical Devices": "의료기기", "Medical Instruments & Supplies": "의료기기", "Healthcare Plans": "헬스케어보험",
    "Diagnostics & Research": "진단·연구", "Aerospace & Defense": "항공우주·방산", "Specialty Industrial Machinery": "산업기계",
    "Electrical Equipment & Parts": "전기장비", "Farm & Heavy Construction Machinery": "건설·농기계", "Engineering & Construction": "건설",
    "Conglomerates": "지주·복합기업", "Marine Shipping": "해운", "Airlines": "항공", "Integrated Freight & Logistics": "물류",
    "Railroads": "철도", "Oil & Gas Integrated": "정유·석유", "Oil & Gas E&P": "석유개발", "Oil & Gas Refining & Marketing": "정유",
    "Oil & Gas Equipment & Services": "유전서비스", "Utilities - Regulated Electric": "전력", "Utilities - Renewable": "신재생",
    "Utilities - Independent Power Producers": "발전", "Utilities - Regulated Gas": "가스", "Uranium": "우라늄",
    "Telecom Services": "통신", "Entertainment": "엔터·미디어", "Electronic Gaming & Multimedia": "게임",
    "Specialty Chemicals": "화학", "Chemicals": "화학", "Steel": "철강", "Other Industrial Metals & Mining": "비철금속",
    "Gold": "금광", "Copper": "구리", "Packaged Foods": "음식료", "Beverages - Non-Alcoholic": "음료", "Beverages - Brewers": "주류",
    "Beverages - Wineries & Distilleries": "주류", "Tobacco": "담배", "Household & Personal Products": "생활용품·화장품",
    "Discount Stores": "할인점", "Department Stores": "백화점", "Grocery Stores": "식료품점", "Specialty Retail": "전문소매",
    "Home Improvement Retail": "주택용품", "Restaurants": "외식", "Apparel Retail": "의류소매", "Footwear & Accessories": "신발·잡화",
    "Apparel Manufacturing": "의류", "Travel Services": "여행", "Resorts & Casinos": "카지노·리조트", "Lodging": "숙박",
    "Information Technology Services": "IT서비스", "Communication Equipment": "통신장비", "Computer Hardware": "컴퓨터하드웨어",
    "Electronic Components": "전자부품", "Scientific & Technical Instruments": "계측기기", "REIT - Specialty": "리츠",
    "REIT - Industrial": "리츠", "REIT - Retail": "리츠", "Financial Data & Stock Exchanges": "금융데이터",
    "Leisure": "레저", "Building Products & Equipment": "건자재", "Building Materials": "건자재", "Rental & Leasing Services": "렌탈",
    "Insurance Brokers": "보험중개", "Pharmaceutical Retailers": "약국", "Medical Care Facilities": "의료서비스",
    "Industrial Distribution": "산업유통", "Metal Fabrication": "금속가공", "Tools & Accessories": "공구",
    "Specialty Business Services": "비즈니스서비스", "Recreational Vehicles": "레저차량", "Solar": "태양광",
}


def get(url, tries=3):
    for i in range(tries):
        try:
            return json.loads(opener.open(url, timeout=20).read())
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def crumb():
    try:
        opener.open("https://fc.yahoo.com", timeout=10)
    except Exception:
        pass  # 쿠키만 받으면 됨 (404 정상)
    return opener.open("https://query1.finance.yahoo.com/v1/test/getcrumb", timeout=10).read().decode()


CRUMB = None


# Yahoo 에 섹터 정보가 없는 국내 종목 보정
SECTOR_OVERRIDE = {
    "086520": ("소재", "2차전지소재"), "036930": ("기술", "반도체장비·소재"), "095340": ("기술", "반도체장비·소재"),
    "084370": ("기술", "반도체장비·소재"), "064760": ("기술", "반도체장비·소재"), "087010": ("헬스케어", "바이오"),
    "039200": ("헬스케어", "바이오"), "950160": ("헬스케어", "바이오"),
    "000250": ("헬스케어", "제약"),
    "067310": ("기술", "반도체"),
    "457190": ("소재", "화학"),
    "080220": ("기술", "반도체"),
    "095610": ("기술", "반도체장비·소재"),
    "131970": ("기술", "반도체"),
    "214370": ("헬스케어", "바이오"),
    "237690": ("헬스케어", "바이오"),
    "058610": ("산업재", "산업기계"),
    "078600": ("기술", "전자부품"),
    "101490": ("기술", "반도체장비·소재"),
    "099320": ("산업재", "항공우주·방산"),
}


def naver(code):
    """국내 종목 보완: PER·선행PER·PBR·배당·외국인소진율·국내 증권사 컨센서스 (네이버 증권)"""
    d = get(f"https://m.stock.naver.com/api/stock/{code}/integration")
    num = lambda v: None if v in (None, "", "N/A", "-") else float(str(v).replace(",", "").rstrip("배%원 ").strip() or "nan")
    info = {}
    for t in d.get("totalInfos") or []:
        try:
            info[t["code"]] = num(t.get("value"))
        except ValueError:
            pass
    c = d.get("consensusInfo") or {}
    try:
        tgt, rec = num(c.get("priceTargetMean")), num(c.get("recommMean"))
    except ValueError:
        tgt = rec = None
    return {"per": info.get("per"), "fper": info.get("cnsPer"), "pbr": info.get("pbr"), "div": info.get("dividendYieldRatio"),
            "foreign": info.get("foreignRate"), "target": tgt, "rec": (6 - rec) if rec else None}  # 네이버 5=강력매수 → 1=강력매수


def naver_quote(code):
    """국내 현재가·등락률·시가총액(네이버) + 수정주가 일봉 260일(네이버 차트)"""
    b = get(f"https://m.stock.naver.com/api/stock/{code}/basic")
    info = {t["code"]: t.get("value") for t in get(f"https://m.stock.naver.com/api/stock/{code}/integration").get("totalInfos") or []}
    cap = None
    mv = info.get("marketValue") or ""
    jo, eok = re.search(r"([\d,]+)조", mv), re.search(r"([\d,]+)억", mv)
    if jo or eok:
        cap = (float(jo.group(1).replace(",", "")) * 10000 if jo else 0) + (float(eok.group(1).replace(",", "")) if eok else 0)
    r = urllib.request.Request(f"https://fchart.stock.naver.com/sise.nhn?symbol={code}&timeframe=day&count=260&requestType=0", headers={"User-Agent": UA})
    rows = [x.split("|") for x in re.findall(r'data="([^"]+)"', urllib.request.urlopen(r, timeout=20).read().decode("euc-kr", "replace"))]
    rows = [x for x in rows if float(x[4]) > 0]
    return {"name": b.get("stockName"), "price": float(b["closePrice"].replace(",", "")), "chg": float(b.get("fluctuationsRatio") or 0), "mcap": cap,
            "closes": [float(x[4]) for x in rows], "highs": [float(x[2]) for x in rows], "lows": [float(x[3]) for x in rows],
            "dates": [f"{x[0][:4]}-{x[0][4:6]}-{x[0][6:8]}" for x in rows]}


def price_stats(price, closes, highs=None, lows=None):
    """수익률·52주 범위·변동성·차트용 시계열 — 최근 250거래일(약 1년) 창 기준으로 일관 계산"""
    w = closes[-250:]
    hw, lw = (highs or w)[-250:], (lows or w)[-250:]
    ret = lambda d: round((price / w[max(0, len(w) - 1 - d)] - 1) * 100, 2)
    lr = [math.log(w[i] / w[i - 1]) for i in range(1, len(w)) if w[i - 1] > 0 and w[i] > 0]
    return {"r1m": ret(21), "r3m": ret(63), "r6m": ret(126), "r1y": round((price / w[0] - 1) * 100, 2),
            "hi52": round(max(hw + [price]), 2), "lo52": round(min(lw + [price]), 2),
            "vol": round(statistics.pstdev(lr) * math.sqrt(252) * 100, 1) if len(lr) > 20 else None,
            "hist": [float(f"{c:.6g}") for c in w]}


def raw(o, k):
    v = (o or {}).get(k)
    if isinstance(v, dict):
        return v.get("raw")
    return v


def chart(sym, rng="1y"):
    d = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range={rng}&interval=1d")
    r = d["chart"]["result"][0]
    pairs = [(t, c) for t, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]) if c is not None]
    if len(pairs) < 60:
        raise ValueError("시세 부족")
    # 상장폐지·이전 상장된 '유령 심볼'은 오래전 시세에서 멈춰 있으므로 최근 거래일이 10일 이내인지 확인
    last = r["meta"].get("regularMarketTime") or pairs[-1][0]
    if time.time() - last > 10 * 86400:
        raise ValueError(f"오래된 시세({datetime.datetime.fromtimestamp(last):%Y-%m-%d})")
    meta = r["meta"]
    meta["dates"] = [datetime.datetime.fromtimestamp(t).strftime("%Y-%m-%d") for t, _ in pairs]
    return meta, [c for _, c in pairs], last


def fetch_one(code, name, market):
    syms = [f"{code}.KS", f"{code}.KQ"] if market == "KR" else [code]
    cands = []
    for sym_ in syms:
        try:
            cands.append((sym_, *chart(sym_)))
        except Exception:
            continue
    if not cands:
        return None, f"{code} {name}: 시세 없음(또는 오래된 시세)"
    sym, meta, closes, ts = max(cands, key=lambda c: c[3])  # 가장 최근 거래일 심볼
    mods = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,calendarEvents"
    try:
        q = get(f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{sym}?modules={mods}&crumb={CRUMB}")["quoteSummary"]["result"][0]
    except Exception as e:
        return None, f"{code} {name}: 재무 없음 ({e})"
    pr, sd, ks, fd, ap = (q.get(m, {}) for m in ("price", "summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile"))
    ce = q.get("calendarEvents") or {}
    ed = ((ce.get("earnings") or {}).get("earningsDate") or [{}])[0]
    cal = {"earn": ed.get("fmt"), "earnEst": bool((ce.get("earnings") or {}).get("isEarningsDateEstimate")),
           "exdiv": (ce.get("exDividendDate") or {}).get("fmt"), "divPay": (ce.get("dividendDate") or {}).get("fmt")}

    price = raw(pr, "regularMarketPrice") or closes[-1]
    prev = raw(pr, "regularMarketPreviousClose") or closes[-2]
    eps, feps, bvps = raw(ks, "trailingEps"), raw(ks, "forwardEps"), raw(ks, "bookValue")
    per = raw(sd, "trailingPE") or (price / eps if eps and eps > 0 else None)
    if eps is not None and eps <= 0:
        per = None
    fper = raw(sd, "forwardPE") or (price / feps if feps and feps > 0 else None)
    pbr = raw(ks, "priceToBook") or (price / bvps if bvps and bvps > 0 else None)
    if pbr is not None and pbr < 0.05:  # Yahoo 오류값(예: BRK-B 0.0) 제거
        pbr = price / bvps if bvps and bvps > 0 and price / bvps >= 0.05 else None
    sector_en = ap.get("sector") or "기타"
    fin = sector_en == "Financial Services"

    pct = lambda v: None if v is None else round(v * 100, 2)
    rnd = lambda v, d=2: None if v is None else round(v, d)
    exch = {"KSC": "KOSPI", "KOE": "KOSDAQ", "NMS": "NASDAQ", "NGM": "NASDAQ", "NCM": "NASDAQ", "NYQ": "NYSE", "ASE": "NYSE American", "PCX": "NYSE Arca"}.get(meta.get("exchangeName"), meta.get("exchangeName"))
    industry_en = ap.get("industry") or ""
    item = {
        "code": code, "yf": sym, "name": name, "en": pr.get("shortName") or pr.get("longName") or code,
        "market": market, "exch": exch, "cur": pr.get("currency") or meta.get("currency"),
        "sector": SECTOR_KO.get(sector_en, sector_en), "industry": INDUSTRY_KO.get(industry_en, industry_en),
        "price": rnd(price, 2), "chg": rnd((price / prev - 1) * 100), "mcapRaw": raw(pr, "marketCap"),
        "per": rnd(per, 1), "fper": rnd(fper, 1), "pbr": rnd(pbr), "roe": pct(raw(fd, "returnOnEquity")),
        "div": pct(raw(sd, "dividendYield")) or 0, "opm": None if fin else pct(raw(fd, "operatingMargins")),
        "debt": None if fin else rnd(raw(fd, "debtToEquity"), 0),
        "target": rnd(raw(fd, "targetMeanPrice"), 2), "rec": rnd(raw(fd, "recommendationMean")),
        "nAnalyst": raw(fd, "numberOfAnalystOpinions") or 0,
        "epsG": pct(raw(fd, "earningsGrowth")), "revG": pct(raw(fd, "revenueGrowth")),
        "beta": rnd(raw(sd, "beta")),
        "foreign": None, "src": "Yahoo", "flow": None, **cal,
        **price_stats(price, closes), "d0": meta["dates"][-250:][0],
        "ts": ts,
    }
    if market == "KR":
        if code in SECTOR_OVERRIDE:
            item["sector"], item["industry"] = SECTOR_OVERRIDE[code]
        elif item["sector"] == "기타":
            print(f"  [섹터 없음] {code} {name}: SECTOR_OVERRIDE 에 추가 필요")
        try:
            nv = naver(code)
            for k in ("per", "fper", "pbr", "foreign"):
                if nv[k] is not None:
                    item[k] = round(nv[k], 2)
            if nv["per"] is None and eps is not None and eps <= 0:
                item["per"] = None
            if nv["div"] is not None:
                item["div"] = nv["div"]
            if nv["target"]:
                item["target"], item["rec"] = nv["target"], round(nv["rec"], 2) if nv["rec"] else item["rec"]
        except Exception as e:
            print(f"  네이버 보완 실패 {code} {name}: {e}")
        try:
            nq = naver_quote(code)
            if len(nq["closes"]) >= 60:
                item.update(price=nq["price"], chg=nq["chg"], src="네이버", d0=nq["dates"][-250:][0], **price_stats(nq["price"], nq["closes"], nq["highs"], nq["lows"]))
                if nq["mcap"]:
                    item["mcapRaw"] = nq["mcap"] * 1e8  # 억원 → 원 (main 에서 다시 억원 환산)
            # 종목명은 거래소 공식명(네이버) 사용 — 목록의 코드 오기 시 다른 회사 이름이 붙는 것을 방지
            if nq.get("name") and nq["name"].replace(" ", "") != name.replace(" ", ""):
                print(f"  [이름 확인] {code}: 목록 '{name}' → 공식명 '{nq['name']}'")
            if nq.get("name"):
                item["name"] = nq["name"]
        except Exception as e:
            print(f"  네이버 시세 실패 {code} {name}: {e} — Yahoo 시세 유지")
        try:
            item["flow"] = naver_flow(code)
        except Exception as e:
            print(f"  수급 실패 {code} {name}: {e}")
    return item, None


def naver_flow(code):
    """최근 20거래일 외국인·기관 순매수 (네이버). 금액(억원) = 순매수 수량 × 당일 종가"""
    rows = get(f"https://m.stock.naver.com/api/stock/{code}/trend?pageSize=20")
    n = lambda v: float(str(v).replace(",", "").replace("+", "") or 0)
    f = [n(r["foreignerPureBuyQuant"]) * n(r["closePrice"]) / 1e8 for r in rows]
    o = [n(r["organPureBuyQuant"]) * n(r["closePrice"]) / 1e8 for r in rows]
    streak = 0  # 외국인 연속 순매수(+)/순매도(-) 일수
    for v in f:
        if v == 0 or (streak and (v > 0) != (streak > 0)):
            break
        streak += 1 if v > 0 else -1
    return {"f1": round(f[0], 1), "f5": round(sum(f[:5]), 1), "f20": round(sum(f[:20]), 1),
            "o1": round(o[0], 1), "o5": round(sum(o[:5]), 1), "o20": round(sum(o[:20]), 1),
            "fstreak": streak, "date": rows[0]["bizdate"] if rows else None}


SNAP_KEYS = ("code", "name", "market", "sector", "cur", "price", "chg", "mcap", "per", "fper", "pbr", "roe", "opm", "debt",
             "epsG", "revG", "r1m", "r3m", "r6m", "hi52", "lo52", "target", "rec", "nAnalyst", "vol", "div", "flow")


def save_snapshot(final, market, asof):
    """추천 성과 추적용 일별 스냅샷 — 그날의 점수 계산에 필요한 값만 저장 (app/history/YYYY-MM-DD.js)"""
    hdir = ROOT / "app" / "history"
    hdir.mkdir(exist_ok=True)
    day = asof[:10]
    snap = {"asof": asof, "market": market, "stocks": [{k: s.get(k) for k in SNAP_KEYS} for s in final]}
    write_atomic(hdir / f"{day}.js", f'(window.SNAPS = window.SNAPS || {{}})["{day}"] = '
                 + json.dumps(snap, ensure_ascii=False, separators=(",", ":")) + ";\n")
    dates = sorted(p.stem for p in hdir.glob("????-??-??.js"))
    write_atomic(hdir / "index.js", "// 자동 생성 — 스냅샷 날짜 목록\nconst SNAP_DATES = " + json.dumps(dates) + ";\n")
    print(f"스냅샷 저장: {day} (누적 {len(dates)}일)")


def clean(t):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html.unescape(t or ""))).strip()


def fetch_news(it):
    """종목별 최근 뉴스 5건 + (국내) 공시 5건"""
    out = {"news": [], "disc": []}
    try:
        if it["market"] == "KR":
            for grp in get(f"https://m.stock.naver.com/api/news/stock/{it['code']}?pageSize=6&page=1"):
                n = (grp.get("items") or [None])[0]
                if not n:
                    continue
                dt = n.get("datetime", "")  # 202610212102
                out["news"].append({"t": clean(n.get("titleFull") or n.get("title")), "src": clean(n.get("officeName")),
                                    "dt": f"{dt[:4]}-{dt[4:6]}-{dt[6:8]} {dt[8:10]}:{dt[10:12]}", "url": n.get("mobileNewsUrl"),
                                    "b": clean(n.get("body"))[:120]})
            for d in get(f"https://m.stock.naver.com/api/stock/{it['code']}/disclosure?pageSize=5&page=1"):
                out["disc"].append({"t": clean(d.get("title")), "dt": (d.get("datetime") or "")[:16].replace("T", " ")})
        else:
            q = urllib.parse.quote(it["code"])
            for n in get(f"https://query1.finance.yahoo.com/v1/finance/search?q={q}&newsCount=6&quotesCount=0").get("news", []):
                t = n.get("providerPublishTime")
                out["news"].append({"t": clean(n.get("title")), "src": n.get("publisher"), "url": n.get("link"),
                                    "dt": datetime.datetime.fromtimestamp(t).strftime("%Y-%m-%d %H:%M") if t else ""})
    except Exception as e:
        out["err"] = str(e)[:80]
    out["news"] = out["news"][:5]
    return it["code"], out


def write_atomic(path, text):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)  # 앱이 반쯤 쓰인 파일을 읽지 않도록 원자적 교체


def main():
    global CRUMB
    CRUMB = crumb()
    fx = chart("KRW=X")[0]["regularMarketPrice"]
    print(f"crumb ok · USD/KRW {fx:.2f}")

    jobs = [(c, n, "KR") for c, n in KR_LIST] + [(c, n, "US") for c, n in US_LIST]
    items, errs = [], []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for i, (it, err) in enumerate(ex.map(lambda j: fetch_one(*j), jobs), 1):
            (items.append(it) if it else errs.append(err))
            if i % 25 == 0:
                print(f"  {i}/{len(jobs)}")
    for it in items:
        cap = it.pop("mcapRaw") or 0
        krw = cap * (fx if it["cur"] == "USD" else 1)
        it["mcap"] = round(krw / 1e8)  # 억원
    final = []
    for mk in ("KR", "US"):
        final += sorted([i for i in items if i["market"] == mk and i["mcap"] > 0], key=lambda i: -i["mcap"])[:PER_MARKET]

    market = []
    for sym, nm in (("^KS11", "KOSPI"), ("^KQ11", "KOSDAQ"), ("^GSPC", "S&P500"), ("^IXIC", "NASDAQ"), ("KRW=X", "USD/KRW")):
        try:
            m, c, _ = chart(sym)
            p = m["regularMarketPrice"]; pv = m.get("chartPreviousClose") if len(c) < 2 else c[-2]
            market.append({"name": nm, "value": round(p, 2), "chg": round((p / pv - 1) * 100, 2)})
        except Exception as e:
            errs.append(f"{nm}: {e}")

    asof = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    js = ("// 자동 생성 파일 — tools/fetch_data.py 로 갱신. 직접 수정하지 마세요.\n"
          f"// 출처: Yahoo Finance 공개 데이터 · 수집 {asof} · 국내 {sum(i['market']=='KR' for i in final)} / 미국 {sum(i['market']=='US' for i in final)}\n"
          f"const DATA_ASOF = {json.dumps(asof)};\nconst USDKRW = {fx:.2f};\n"
          f"const MARKET = {json.dumps(market, ensure_ascii=False)};\n"
          f"const STOCKS = {json.dumps(final, ensure_ascii=False, separators=(',', ':'))};\n")
    write_atomic(OUT, js)
    print(f"저장: {OUT} · {len(final)}종목 · {OUT.stat().st_size // 1024}KB")
    save_snapshot(final, market, asof)

    print("뉴스·공시 수집 중...")
    with ThreadPoolExecutor(max_workers=6) as ex:
        news = dict(ex.map(fetch_news, final))
    write_atomic(NEWS_OUT, "// 자동 생성 파일 — tools/fetch_data.py 로 갱신. 국내: 네이버 증권 뉴스·공시 / 미국: Yahoo Finance 뉴스\n"
                 f"const NEWS_ASOF = {json.dumps(asof)};\nconst NEWS = {json.dumps(news, ensure_ascii=False, separators=(',', ':'))};\n")
    print(f"저장: {NEWS_OUT} · 뉴스 {sum(len(v['news']) for v in news.values())}건 · 공시 {sum(len(v['disc']) for v in news.values())}건")
    if errs:
        print("실패/제외:", *errs, sep="\n  ")


if __name__ == "__main__":
    main()
