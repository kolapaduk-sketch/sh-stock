"""
지수·환율 (수집기·실시간 서버 공용)
  국내 지수: 네이버 증권 (거래소 공식 값, 등락률 포함)
  미국 지수: 네이버 증권 해외지수
  원/달러:   네이버 증권 (하나은행 고시)
네이버 실패 시 Yahoo 로 대체하되, 전일 종가는 반드시 range=1d 의 chartPreviousClose 를 쓴다
(Yahoo 일봉의 국내 지수 전일 종가가 틀리게 들어오는 경우가 있었음 — 2026-10-22 코스피 방향이 반대로 표시된 원인)
"""
import json, urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
num = lambda v: None if v in (None, "", "-", "N/A") else float(str(v).replace(",", "").replace("+", ""))


def _get(url):
    r = urllib.request.Request(url, headers={"User-Agent": UA})
    return json.loads(urllib.request.urlopen(r, timeout=10).read().decode("utf-8"))


def _yahoo(sym, name):
    m = _get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1d&interval=5m")["chart"]["result"][0]["meta"]
    p, prev = m["regularMarketPrice"], m.get("chartPreviousClose") or m.get("previousClose")
    return {"name": name, "value": round(p, 2), "chg": round((p / prev - 1) * 100, 2), "src": "Yahoo"}


def fetch_indices():
    out = {}
    try:
        for x in _get("https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI,KOSDAQ").get("datas") or []:
            out[x["itemCode"]] = {"name": x["itemCode"], "value": num(x["closePrice"]), "chg": num(x["fluctuationsRatio"]),
                                  "status": x.get("marketStatus"), "time": (x.get("localTradedAt") or "")[:16], "src": "네이버"}
    except Exception:
        pass
    # 개장 전(PREOPEN)에는 네이버가 등락률을 0으로 초기화 → 전일 종가·등락률을 일별 시세에서 가져와 표시
    for mk in ("KOSPI", "KOSDAQ"):
        v = out.get(mk)
        if v and v.get("status") == "PREOPEN" and not v.get("chg"):
            try:
                import datetime
                today = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime("%Y-%m-%d")
                rows = _get(f"https://m.stock.naver.com/api/index/{mk}/price?pageSize=3&page=1")
                row = next(r for r in rows if r["localTradedAt"] < today)  # 오늘 이전 마지막 거래일
                v.update(value=num(row["closePrice"]), chg=num(row["fluctuationsRatio"]), time=row["localTradedAt"], prevDay=True)
            except Exception:
                pass
    try:
        names = {".INX": "S&P500", ".IXIC": "NASDAQ"}
        for x in _get("https://polling.finance.naver.com/api/realtime/worldstock/index/.INX,.IXIC").get("datas") or []:
            n = names.get(x.get("reutersCode"))
            if n:
                out[n] = {"name": n, "value": num(x["closePrice"]), "chg": num(x["fluctuationsRatio"]),
                          "status": x.get("marketStatus"), "time": (x.get("localTradedAt") or "")[:16], "src": "네이버"}
    except Exception:
        pass
    try:
        e = _get("https://api.stock.naver.com/marketindex/exchange/FX_USDKRW")["exchangeInfo"]
        out["USD/KRW"] = {"name": "USD/KRW", "value": num(e["closePrice"]), "chg": num(e["fluctuationsRatio"]),
                          "time": (e.get("localTradedAt") or "")[:16], "src": "네이버"}
    except Exception:
        pass
    for sym, n in (("^KS11", "KOSPI"), ("^KQ11", "KOSDAQ"), ("^GSPC", "S&P500"), ("^IXIC", "NASDAQ"), ("KRW=X", "USD/KRW")):
        if n not in out or out[n]["value"] is None:
            try:
                out[n] = _yahoo(sym, n)
            except Exception:
                pass
    order = ["KOSPI", "KOSDAQ", "S&P500", "NASDAQ", "USD/KRW"]
    return [out[n] for n in order if n in out]


def fetch_market_flows():
    """시장 전체 투자자별 순매수(억원)·프로그램 매매·상승/하락 종목 수 — 코스피·코스닥 (네이버, 장중엔 잠정치)"""
    out = {}
    for mk in ("KOSPI", "KOSDAQ"):
        try:
            d = _get(f"https://m.stock.naver.com/api/index/{mk}/integration")
        except Exception:
            continue
        t, p, u = d.get("dealTrendInfo") or {}, d.get("programTrendInfo") or {}, d.get("upDownStockInfo") or {}
        out[mk] = {
            "date": t.get("bizdate"),
            "personal": num(t.get("personalValue")), "foreign": num(t.get("foreignValue")), "institutional": num(t.get("institutionalValue")),
            "program": {"arb": num(p.get("indexDifferenceReal")), "nonarb": num(p.get("indexBiDifferenceReal")), "total": num(p.get("indexTotalReal"))},
            "updown": {"upper": num(u.get("upperCount")), "up": num(u.get("riseCount")), "steady": num(u.get("steadyCount")),
                       "down": num(u.get("fallCount")), "lower": num(u.get("lowerCount"))},
        }
    return out


if __name__ == "__main__":
    for x in fetch_indices():
        print(x)
    print(fetch_market_flows())
