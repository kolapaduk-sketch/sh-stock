"""
SH STOCK 데이터 수집기
  python tools/fetch_data.py

1) 종목 선정(자동): 거래소 시가총액 순위(네이버 증권)에서
   - 국내: 시가총액 1,000억 원 이상 · 20일 평균 거래대금 5억 원 이상 · 보통주만(스팩·우선주·ETF·거래정지 제외)
   - 미국: 나스닥+NYSE 시가총액 상위 1,000 (같은 회사의 다른 주식 클래스는 1개만)
2) 수집: 시세·재무·컨센서스(Yahoo Finance) + 국내 시세·PER·수급·업종·뉴스·공시(네이버 증권)
3) 저장
   app/data.js            전 종목 요약(점수 계산용 지표 + 미리 계산한 기술적 지표) — 앱이 처음 읽는 가벼운 파일
   app/detail/<코드>.js    종목별 1년 주가·뉴스·공시 — 종목을 열 때만 읽음
   app/history/<날짜>.js   추천 성과 추적용 일별 스냅샷
외부 패키지 없이 표준 라이브러리만 사용.
"""
import json, math, time, random, statistics, datetime, html, re, http.cookiejar, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
OUT = APP / "data.js"
DETAIL = APP / "detail"

KR_MIN_CAP = 1000      # 억원
KR_MIN_TV20 = 5        # 20일 평균 거래대금, 억원
US_TOP = 1000
WORKERS = 6

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
# 네이버 업종(국내 표준 분류) → 앱 섹터
NAVER_SECTOR = {
    "기술": "반도체와반도체장비 전자장비와기기 디스플레이장비및부품 IT서비스 컴퓨터와주변기기 전자제품 디스플레이패널 핸드셋 소프트웨어 통신장비 사무용전자제품",
    "헬스케어": "생명과학도구및서비스 생물공학 제약 건강관리업체및서비스 건강관리장비와용품 건강관리기술",
    "산업재": "전기장비 건설 복합기업 항공사 기계 조선 우주항공과국방 운송인프라 상업서비스와공급품 건축제품 항공화물운송과물류 해운사 도로와철도운송 무역회사와판매업체 전기제품",
    "에너지": "석유와가스 에너지장비및서비스",
    "유틸리티": "전기유틸리티 가스유틸리티 복합유틸리티",
    "금융": "창업투자 생명보험 증권 기타금융 은행 손해보험 카드",
    "소재": "화학 비철금속 건축자재 종이와목재 철강 포장재",
    "경기소비재": "레저용장비와제품 교육서비스 호텔,레스토랑,레저 자동차부품 판매업체 가구 자동차 백화점과일반상점 섬유,의류,신발,호화품 인터넷과카탈로그소매 가정용기기와용품 다각화된소비자서비스 전문소매 문구류",
    "필수소비재": "담배 화장품 식품 식품과기본식료품소매 음료 가정용품",
    "커뮤니케이션": "양방향미디어와서비스 출판 광고 방송과엔터테인먼트 게임엔터테인먼트 무선통신서비스 다각화된통신서비스",
    "부동산": "부동산",
}
NAVER_SECTOR = {ind: sec for sec, names in NAVER_SECTOR.items() for ind in names.split()}
INDUSTRY_NAME = {}  # 네이버 업종 번호 → 이름 (main 에서 채움)


def get(url, tries=4):
    for i in range(tries):
        try:
            return json.loads(opener.open(url, timeout=20).read())
        except urllib.error.HTTPError as e:
            if e.code in (400, 404) or i == tries - 1:
                raise
            time.sleep(2 ** (i + 1) + random.random())   # 429·5xx: 점점 길게 쉬었다 재시도
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 ** (i + 1) + random.random())


def get_text(url, enc="utf-8"):
    r = urllib.request.Request(url, headers={"User-Agent": UA})
    for i in range(3):
        try:
            return urllib.request.urlopen(r, timeout=20).read().decode(enc, "replace")
        except Exception:
            if i == 2:
                raise
            time.sleep(2 ** (i + 1))


def crumb():
    try:
        opener.open("https://fc.yahoo.com", timeout=10)
    except Exception:
        pass  # 쿠키만 받으면 됨 (404 정상)
    return opener.open("https://query1.finance.yahoo.com/v1/test/getcrumb", timeout=10).read().decode()


CRUMB = None
num = lambda v: None if v in (None, "", "N/A", "-") else float(str(v).replace(",", "").replace("+", ""))


# ── 1. 종목 선정 ─────────────────────────────────────────────
def naver_pages(url_fmt, stop, max_rows=10**9):
    out, page = [], 1
    while True:
        try:
            st = get(url_fmt.format(page)).get("stocks") or []
        except urllib.error.HTTPError:
            break
        out += st
        if len(st) < 100 or stop(st[-1]) or len(out) >= max_rows:
            break
        page += 1
    return out


def build_universe():
    kr = []
    for mk in ("KOSPI", "KOSDAQ"):
        rows = naver_pages(f"https://m.stock.naver.com/api/stocks/marketValue/{mk}?page={{}}&pageSize=100",
                           lambda r: (num(r.get("marketValue")) or 0) < KR_MIN_CAP)
        for r in rows:
            name, code = r.get("stockName", ""), r.get("itemCode", "")
            if (r.get("stockEndType") == "stock" and code.endswith("0")                  # 보통주 (우선주 코드는 0 이외로 끝남)
                    and "스팩" not in name and "기업인수목적" not in name
                    and (r.get("tradeStopType") or {}).get("name") == "TRADING"
                    and (num(r.get("marketValue")) or 0) >= KR_MIN_CAP):
                kr.append((code, name))
    us, seen = [], set()
    pool = []
    for ex in ("NASDAQ", "NYSE"):
        rows = naver_pages(f"https://api.stock.naver.com/stock/exchange/{ex}/marketValue?page={{}}&pageSize=100",
                           lambda r: False, max_rows=1300)  # 시총 상위 1,300개까지만
        pool += [r for r in rows[:1300] if r.get("stockEndType") == "stock"
                 and not re.search(r"[ .-]P(R|F)?[A-Z]?$|-PR|우선주|Preferred|Pfd", (r.get("symbolCode") or "") + " " + (r.get("stockName") or "") + " " + (r.get("stockNameEng") or ""))]
    pool.sort(key=lambda r: -(num(r.get("marketValue")) or 0))
    for r in pool:
        base = re.sub(r"\s+(Class|Cl\.?)\s+[A-Z]$", "", r.get("stockNameEng") or r.get("stockName") or "").strip()
        if base in seen:
            continue  # 같은 회사의 다른 주식 클래스(예: GOOGL/GOOG, BRK A/B)
        seen.add(base)
        us.append((r["symbolCode"].replace(" ", "-").replace(".", "-"), r.get("stockName") or r["symbolCode"]))
        if len(us) >= int(US_TOP * 1.08):
            break
    return kr, us


# ── 2. 종목별 수집 ───────────────────────────────────────────
def raw(o, k):
    v = (o or {}).get(k)
    return v.get("raw") if isinstance(v, dict) else v


def chart(sym, rng="1y"):
    d = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range={rng}&interval=1d")
    r = d["chart"]["result"][0]
    pairs = [(t, c) for t, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]) if c is not None]
    if len(pairs) < 60:
        raise ValueError("시세 부족")
    last = r["meta"].get("regularMarketTime") or pairs[-1][0]
    if time.time() - last > 10 * 86400:  # 상장폐지·이전 상장된 '유령 심볼'
        raise ValueError(f"오래된 시세({datetime.datetime.fromtimestamp(last):%Y-%m-%d})")
    meta = r["meta"]
    meta["dates"] = [datetime.datetime.fromtimestamp(t).strftime("%Y-%m-%d") for t, _ in pairs]
    return meta, [c for _, c in pairs], last


def quote_summary(sym):
    mods = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,calendarEvents"
    q = get(f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{sym}?modules={mods}&crumb={CRUMB}")["quoteSummary"]["result"][0]
    t = raw(q.get("price"), "regularMarketTime") or 0
    if time.time() - t > 10 * 86400:
        raise ValueError("오래된 심볼")
    return q


def naver_kr(code):
    """국내: 현재가·등락·시총·PER·PBR·배당·외국인·컨센서스·업종(네이버) + 수정주가 일봉 260일(네이버 차트)"""
    b = get(f"https://m.stock.naver.com/api/stock/{code}/basic")
    d = get(f"https://m.stock.naver.com/api/stock/{code}/integration")
    info = {}
    for t in d.get("totalInfos") or []:
        info[t["code"]] = t.get("value")
    f = lambda k: (lambda v: None if v is None else v)(_safe(lambda: num(str(info.get(k) or "").rstrip("배%원 ").strip() or None)))
    mv = info.get("marketValue") or ""
    jo, eok = re.search(r"([\d,]+)조", mv), re.search(r"([\d,]+)억", mv)
    cap = (num(jo.group(1)) * 10000 if jo else 0) + (num(eok.group(1)) if eok else 0) if (jo or eok) else None
    c = d.get("consensusInfo") or {}
    tgt, rec = _safe(lambda: num(c.get("priceTargetMean"))), _safe(lambda: num(c.get("recommMean")))
    txt = get_text(f"https://fchart.stock.naver.com/sise.nhn?symbol={code}&timeframe=day&count=260&requestType=0", "euc-kr")
    rows = [x.split("|") for x in re.findall(r'data="([^"]+)"', txt)]
    rows = [x for x in rows if float(x[4]) > 0]
    ind = INDUSTRY_NAME.get(str(d.get("industryCode") or ""))
    return {"name": b.get("stockName"), "exch": {"KS": "KOSPI", "KQ": "KOSDAQ"}.get((b.get("stockExchangeType") or {}).get("code"), "KRX"),
            "price": num(b["closePrice"]), "chg": num(b.get("fluctuationsRatio")) or 0, "mcap": cap,
            "per": f("per"), "fper": f("cnsPer"), "pbr": f("pbr"), "div": f("dividendYieldRatio"), "foreign": f("foreignRate"),
            "target": tgt, "rec": (6 - rec) if rec else None, "industry": ind,   # 네이버 5=강력매수 → 1=강력매수
            "closes": [float(x[4]) for x in rows], "highs": [float(x[2]) for x in rows], "lows": [float(x[3]) for x in rows],
            "tv20": sum(float(x[4]) * float(x[5]) for x in rows[-20:]) / max(1, len(rows[-20:])) / 1e8,
            "dates": [f"{x[0][:4]}-{x[0][4:6]}-{x[0][6:8]}" for x in rows]}


def _safe(fn):
    try:
        return fn()
    except Exception:
        return None


def naver_flow(code):
    """최근 20거래일 외국인·기관 순매수 (네이버). 금액(억원) = 순매수 수량 × 당일 종가"""
    rows = get(f"https://m.stock.naver.com/api/stock/{code}/trend?pageSize=20")
    n = lambda v: float(str(v).replace(",", "").replace("+", "") or 0)
    f = [n(r["foreignerPureBuyQuant"]) * n(r["closePrice"]) / 1e8 for r in rows]
    o = [n(r["organPureBuyQuant"]) * n(r["closePrice"]) / 1e8 for r in rows]
    streak = 0
    for v in f:
        if v == 0 or (streak and (v > 0) != (streak > 0)):
            break
        streak += 1 if v > 0 else -1
    return {"f1": round(f[0], 1), "f5": round(sum(f[:5]), 1), "f20": round(sum(f[:20]), 1),
            "o1": round(o[0], 1), "o5": round(sum(o[:5]), 1), "o20": round(sum(o[:20]), 1),
            "fstreak": streak, "date": rows[0]["bizdate"] if rows else None}


def price_stats(price, closes, highs=None, lows=None):
    """수익률·52주 범위·변동성 — 최근 250거래일(약 1년) 창 기준"""
    w = closes[-250:]
    hw, lw = (highs or w)[-250:], (lows or w)[-250:]
    ret = lambda d: round((price / w[max(0, len(w) - 1 - d)] - 1) * 100, 2)
    lr = [math.log(w[i] / w[i - 1]) for i in range(1, len(w)) if w[i - 1] > 0 and w[i] > 0]
    return {"r1m": ret(21), "r3m": ret(63), "r6m": ret(126), "r1y": round((price / w[0] - 1) * 100, 2),
            "hi52": round(max(hw + [price]), 2), "lo52": round(min(lw + [price]), 2),
            "vol": round(statistics.pstdev(lr) * math.sqrt(252) * 100, 1) if len(lr) > 20 else None}


def tech_of(closes, price):
    """기술적 지표 (앱 engine.js tech() 와 같은 계산): 이동평균·RSI(14)·20/60일선 크로스·배열·이격도"""
    h = closes[-250:]
    if len(h) < 30:
        return None
    h = h[:-1] + [price]
    L = len(h) - 1
    ma = lambda n: sum(h[L + 1 - n:L + 1]) / n if L + 1 >= n else None
    ma_at = lambda n, i: sum(h[i + 1 - n:i + 1]) / n if i + 1 >= n else None
    g = l = 0.0
    for i in range(1, 15):
        d = h[i] - h[i - 1]
        g, l = (g + d, l) if d > 0 else (g, l - d)
    g, l = g / 14, l / 14
    for i in range(15, L + 1):
        d = h[i] - h[i - 1]
        g, l = (g * 13 + max(d, 0)) / 14, (l * 13 + max(-d, 0)) / 14
    rsi = 100.0 if l == 0 else 100 - 100 / (1 + g / l)
    cross = None
    i = L
    while i > L - 15 and i > 0:
        a, b, pa, pb = ma_at(20, i), ma_at(60, i), ma_at(20, i - 1), ma_at(60, i - 1)
        if None in (a, b, pa, pb):
            break
        if a - b > 0 and pa - pb <= 0:
            cross = {"type": "골든크로스", "ago": L - i}; break
        if a - b < 0 and pa - pb >= 0:
            cross = {"type": "데드크로스", "ago": L - i}; break
        i -= 1
    p, a, b, c = h[L], ma(20), ma(60), ma(120)
    if c is None:
        align = "단기 상승" if (a or 0) > (b or 0) else "단기 하락"
    else:
        align = "정배열" if p > a > b > c else "역배열" if p < a < b < c else "혼조"
    r = lambda v: None if v is None else float(f"{v:.6g}")
    return {"rsi": round(rsi, 1), "cross": cross, "align": align, "disp": round(p / a * 100, 2) if a else None,
            "ma": {"20": r(a), "60": r(b), "120": r(c)}}


def fetch_one(code, name, market):
    pct = lambda v: None if v is None else round(v * 100, 2)
    rnd = lambda v, d=2: None if v is None else round(v, d)
    # Yahoo: 재무·컨센서스·업종·일정 (국내 소형주는 없을 수 있음 → 네이버 값으로 진행)
    q, sym = {}, None
    for s_ in ([f"{code}.KS", f"{code}.KQ"] if market == "KR" else [code]):
        try:
            q, sym = quote_summary(s_), s_
            break
        except Exception:
            continue
    if market == "US" and not sym:
        return None, f"{code} {name}: Yahoo 데이터 없음"
    pr, sd, ks, fd, ap = (q.get(m) or {} for m in ("price", "summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile"))
    ce = q.get("calendarEvents") or {}
    ed = ((ce.get("earnings") or {}).get("earningsDate") or [{}])[0]
    sector_en = ap.get("sector") or ""
    fin = sector_en == "Financial Services"
    eps, feps, bvps = raw(ks, "trailingEps"), raw(ks, "forwardEps"), raw(ks, "bookValue")
    item = {
        "code": code, "yf": sym, "name": name, "en": pr.get("shortName") or pr.get("longName") or name, "market": market,
        "cur": "KRW" if market == "KR" else (pr.get("currency") or "USD"),
        "sector": SECTOR_KO.get(sector_en, sector_en or "기타"), "industry": INDUSTRY_KO.get(ap.get("industry") or "", ap.get("industry") or ""),
        "roe": pct(raw(fd, "returnOnEquity")), "opm": None if fin else pct(raw(fd, "operatingMargins")),
        "debt": None if fin else rnd(raw(fd, "debtToEquity"), 0),
        "target": rnd(raw(fd, "targetMeanPrice")), "rec": rnd(raw(fd, "recommendationMean")), "nAnalyst": raw(fd, "numberOfAnalystOpinions") or 0,
        "epsG": pct(raw(fd, "earningsGrowth")), "revG": pct(raw(fd, "revenueGrowth")), "beta": rnd(raw(sd, "beta")),
        "div": pct(raw(sd, "dividendYield")) or 0, "foreign": None, "flow": None,
        "earn": ed.get("fmt"), "earnEst": bool((ce.get("earnings") or {}).get("isEarningsDateEstimate")),
        "exdiv": (ce.get("exDividendDate") or {}).get("fmt"),
    }
    if market == "US":
        try:
            meta, closes, _ = chart(code)
        except Exception as e:
            return None, f"{code} {name}: 시세 없음 ({e})"
        price = round(raw(pr, "regularMarketPrice") or closes[-1], 2)   # 저장값과 같은 반올림 가격으로 수익률 계산
        prev = raw(pr, "regularMarketPreviousClose") or closes[-2]
        per = raw(sd, "trailingPE") or (price / eps if eps and eps > 0 else None)
        if eps is not None and eps <= 0:
            per = None
        pbr = raw(ks, "priceToBook") or (price / bvps if bvps and bvps > 0 else None)
        if pbr is not None and pbr < 0.05:
            pbr = None
        exch = {"NMS": "NASDAQ", "NGM": "NASDAQ", "NCM": "NASDAQ", "NYQ": "NYSE", "ASE": "NYSE American", "PCX": "NYSE Arca"}.get(meta.get("exchangeName"), meta.get("exchangeName"))
        item.update(exch=exch, price=rnd(price), chg=rnd((price / prev - 1) * 100), mcapRaw=raw(pr, "marketCap"), src="Yahoo",
                    per=rnd(per, 1), fper=rnd(raw(sd, "forwardPE") or (price / feps if feps and feps > 0 else None), 1), pbr=rnd(pbr),
                    d0=meta["dates"][-250:][0], **price_stats(price, closes))
    else:
        try:
            nv = naver_kr(code)
        except Exception as e:
            return None, f"{code} {name}: 네이버 시세 없음 ({e})"
        if len(nv["closes"]) < 60 or not nv["price"]:
            return None, f"{code} {name}: 상장 기간이 짧음(일봉 {len(nv['closes'])}일)"
        closes, price = nv["closes"], nv["price"]
        if nv["target"]:
            item["target"], item["rec"] = nv["target"], round(nv["rec"], 2) if nv["rec"] else item["rec"]
        sec = NAVER_SECTOR.get(nv["industry"] or "")
        item.update(name=nv["name"] or name, exch=nv["exch"], price=price, chg=nv["chg"], mcapRaw=(nv["mcap"] or 0) * 1e8, src="네이버",
                    per=rnd(nv["per"], 2) if nv["per"] and nv["per"] > 0 else None, fper=rnd(nv["fper"], 2), pbr=rnd(nv["pbr"], 2),
                    foreign=nv["foreign"], div=nv["div"] if nv["div"] is not None else item["div"], tv20=round(nv["tv20"], 1),
                    d0=nv["dates"][-250:][0], **price_stats(price, closes, nv["highs"], nv["lows"]))
        if sec:  # 국내는 국내 표준 업종 분류 우선
            item["sector"], item["industry"] = sec, nv["industry"]
        if not item["en"] or item["en"] == name:
            item["en"] = item["name"]
        try:
            item["flow"] = naver_flow(code)
        except Exception:
            pass
    item["tech"] = tech_of(closes, item["price"])
    item["_hist"] = [float(f"{c:.6g}") for c in closes[-250:]]
    return item, None


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
                dt = n.get("datetime", "")
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


# ── 3. 저장 ─────────────────────────────────────────────────
def write_atomic(path, text):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)  # 앱이 반쯤 쓰인 파일을 읽지 않도록 원자적 교체


SNAP_KEYS = ["code", "name", "market", "sector", "cur", "price", "chg", "mcap", "per", "fper", "pbr", "roe", "opm", "debt",
             "epsG", "revG", "r1m", "r3m", "r6m", "hi52", "lo52", "target", "rec", "nAnalyst", "vol", "div", "flow"]


def save_snapshot(final, market, asof):
    """추천 성과 추적용 일별 스냅샷 (열 단위 압축) — app/history/YYYY-MM-DD.js"""
    hdir = APP / "history"
    hdir.mkdir(exist_ok=True)
    day = asof[:10]
    snap = {"asof": asof, "market": market, "keys": SNAP_KEYS, "rows": [[s.get(k) for k in SNAP_KEYS] for s in final]}
    write_atomic(hdir / f"{day}.js", f'(window.SNAPS = window.SNAPS || {{}})["{day}"] = '
                 + json.dumps(snap, ensure_ascii=False, separators=(",", ":")) + ";\n")
    dates = sorted(p.stem for p in hdir.glob("????-??-??.js"))
    write_atomic(hdir / "index.js", "// 자동 생성 — 스냅샷 날짜 목록\nconst SNAP_DATES = " + json.dumps(dates) + ";\n")
    print(f"스냅샷 저장: {day} (누적 {len(dates)}일)")


def main():
    global CRUMB
    t0 = time.time()
    CRUMB = crumb()
    fx = chart("KRW=X")[0]["regularMarketPrice"]
    try:
        groups = get("https://m.stock.naver.com/api/stocks/industry?page=1&pageSize=100").get("groups") or []
        INDUSTRY_NAME.update({str(g["no"]): g["name"] for g in groups})
    except Exception as e:
        print("업종 목록 실패:", e)
    try:
        kr_list, us_list = build_universe()
    except Exception as e:  # 순위 API 장애 시 기존 수동 목록 사용
        print("종목 순위 수집 실패, universe.py 사용:", e)
        from universe import KR_LIST as kr_list, US_LIST as us_list
    print(f"USD/KRW {fx:.2f} · 후보 국내 {len(kr_list)} / 미국 {len(us_list)}")

    jobs = [(c, n, "KR") for c, n in kr_list] + [(c, n, "US") for c, n in us_list]
    items, errs = [], []
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for i, (it, err) in enumerate(ex.map(lambda j: fetch_one(*j), jobs), 1):
            (items.append(it) if it else errs.append(err))
            if i % 100 == 0:
                print(f"  {i}/{len(jobs)} ({time.time() - t0:.0f}초)")
    for it in items:
        cap = it.pop("mcapRaw") or 0
        it["mcap"] = round(cap * (fx if it["cur"] == "USD" else 1) / 1e8)  # 억원
    kr = [i for i in items if i["market"] == "KR" and i["mcap"] >= KR_MIN_CAP and (i.get("tv20") or 0) >= KR_MIN_TV20]
    low_liq = sum(1 for i in items if i["market"] == "KR" and (i.get("tv20") or 0) < KR_MIN_TV20)
    us = sorted([i for i in items if i["market"] == "US" and i["mcap"] > 0], key=lambda i: -i["mcap"])[:US_TOP]
    final = sorted(kr, key=lambda i: -i["mcap"]) + us
    print(f"선정: 국내 {len(kr)} (거래대금 부족 제외 {low_liq}) · 미국 {len(us)}")

    market = []
    for sym, nm in (("^KS11", "KOSPI"), ("^KQ11", "KOSDAQ"), ("^GSPC", "S&P500"), ("^IXIC", "NASDAQ"), ("KRW=X", "USD/KRW")):
        try:
            m, c, _ = chart(sym)
            p = m["regularMarketPrice"]
            market.append({"name": nm, "value": round(p, 2), "chg": round((p / c[-2] - 1) * 100, 2)})
        except Exception as e:
            errs.append(f"{nm}: {e}")

    print("뉴스·공시 수집 중...")
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        news = dict(ex.map(fetch_news, final))

    asof = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    # 종목별 상세 파일 (주가·뉴스·공시)
    DETAIL.mkdir(exist_ok=True)
    keep = set()
    for it in final:
        fn = re.sub(r"[^A-Za-z0-9_-]", "_", it["code"]) + ".js"
        keep.add(fn)
        d = {"hist": it.pop("_hist"), **news.get(it["code"], {"news": [], "disc": []})}
        write_atomic(DETAIL / fn, f'(window.DETAIL = window.DETAIL || {{}})[{json.dumps(it["code"])}] = '
                     + json.dumps(d, ensure_ascii=False, separators=(",", ":")) + ";\n")
    for p in DETAIL.glob("*.js"):
        if p.name not in keep:
            p.unlink()  # 선정에서 빠진 종목 정리
    for it in items:
        it.pop("_hist", None)

    js = ("// 자동 생성 파일 — tools/fetch_data.py 로 갱신. 직접 수정하지 마세요.\n"
          f"// 출처: 네이버 증권·Yahoo Finance 공개 데이터 · 수집 {asof} · 국내 {len(kr)} / 미국 {len(us)}\n"
          f"const DATA_ASOF = {json.dumps(asof)};\nconst NEWS_ASOF = DATA_ASOF;\nconst USDKRW = {fx:.2f};\n"
          f"const MARKET = {json.dumps(market, ensure_ascii=False)};\n"
          f"const STOCKS = {json.dumps(final, ensure_ascii=False, separators=(',', ':'))};\n")
    write_atomic(OUT, js)
    print(f"저장: data.js {OUT.stat().st_size // 1024}KB · 상세 {len(keep)}개 · 뉴스 {sum(len(v['news']) for v in news.values())}건 · {time.time() - t0:.0f}초")
    save_snapshot(final, market, asof)
    old_news = APP / "news.js"
    if old_news.exists():
        old_news.unlink()  # 이전 버전의 통합 뉴스 파일 (이제 종목별 상세 파일에 포함)
    if errs:
        print(f"제외 {len(errs)}건 (예시):", *errs[:15], sep="\n  ")


if __name__ == "__main__":
    main()
