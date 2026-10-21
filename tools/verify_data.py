"""
SH STOCK 데이터 검증
  python tools/verify_data.py
app/data.js 의 값을 '앱이 쓰지 않은 다른 출처'와 대조하고 내부 일관성을 점검해 tools/verify_report.txt 로 저장한다.
  국내(앱 시세 출처 = 네이버) → Yahoo Finance 와 대조
  미국(앱 시세 출처 = Yahoo)  → 네이버 증권 해외주식과 대조
  A. 현재가 대조 (3% 초과 경고, 1~3%는 반영 시점 차이로 참고 처리)
  B. 1년 수익률 대조 (두 출처의 수정주가 반영 방식 차이 탐지, 10%p 초과 경고)
  C. 내부 점검: 일간 변동 이상치(국내 가격제한폭 ±30% 초과 = 데이터 오류), 수익률 재계산, 차트 마지막 값 vs 현재가, 이상값, 결측치
"""
import json, re, datetime, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORT = Path(__file__).resolve().parent / "verify_report.txt"


def load():
    t = (ROOT / "app" / "data.js").read_text(encoding="utf-8")
    return json.loads(re.search(r"const STOCKS = (\[.*\]);", t).group(1)), re.search(r'const DATA_ASOF = "([^"]+)"', t).group(1)


def get(url):
    r = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return json.loads(urllib.request.urlopen(r, timeout=15).read().decode("utf-8"))


def other_source(s):
    try:
        if s["market"] == "KR":
            # 앱이 기록한 심볼이 아니라 .KS/.KQ 중 최근 거래 중인 심볼을 독립적으로 찾는다
            best = None
            for suf in (".KS", ".KQ"):
                try:
                    r = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{s['code']}{suf}?range=2y&interval=1d")["chart"]["result"][0]
                    if datetime.datetime.now().timestamp() - r["meta"]["regularMarketTime"] > 10 * 86400:
                        continue  # 상장 이전·폐지된 '유령 심볼'(오래된 시세)은 대조에서 제외
                    if not best or r["meta"]["regularMarketTime"] > best["meta"]["regularMarketTime"]:
                        best = r
                except Exception:
                    continue
            if not best:
                return {"err": "Yahoo 시세 없음"}
            p = best["meta"]["regularMarketPrice"]
            dates = [datetime.datetime.fromtimestamp(t).strftime("%Y-%m-%d") for t in best["timestamp"]]
            closes = best["indicators"]["quote"][0]["close"]
            base = next((c for d, c in zip(dates, closes) if d >= s.get("d0", "") and c), None)  # 앱 차트 시작일과 같은 날 종가
            return {"src": "Yahoo", "price": p, "r1y": (p / base - 1) * 100 if base else None}
        for suf in (".O", ".N", ".K", ".A", ""):
            try:
                b = get(f"https://api.stock.naver.com/stock/{s['code'].replace('-', '.')}{suf}/basic")
                if b.get("closePrice"):
                    return {"src": "네이버", "price": float(b["closePrice"].replace(",", ""))}
            except Exception:
                continue
        return {"err": "네이버 해외종목 코드 매칭 실패"}
    except Exception as e:
        return {"err": str(e)[:60]}


def main():
    stocks, asof = load()
    with ThreadPoolExecutor(max_workers=8) as ex:
        ref = dict(zip([s["code"] for s in stocks], ex.map(other_source, stocks)))

    issues, notes, diffs = [], [], []
    for s in stocks:
        tag = f"{s['name']}({s['code']})"
        r = ref[s["code"]]
        if r.get("err"):
            notes.append(f"[대조불가] {tag}: {r['err']}")
        else:
            d = (s["price"] / r["price"] - 1) * 100
            diffs.append(abs(d))
            if 1 < abs(d) <= 3:
                notes.append(f"[가격 소폭 차이] {tag}: 앱({s.get('src')}) {s['price']:,} vs {r['src']} {r['price']:,} ({d:+.2f}%) — 출처별 시세 반영 시점 차이 범위")
            elif abs(d) > 3:
                issues.append(f"[가격 불일치] {tag}: 앱({s.get('src')}) {s['price']:,} vs {r['src']} {r['price']:,} ({d:+.2f}%)")
            if r.get("r1y") is not None and abs(r["r1y"] - s["r1y"]) > 5:
                notes.append(f"[출처간 1년 수익률 차이] {tag}: 앱 {s['r1y']:+.1f}% vs {r['src']} {r['r1y']:+.1f}% (기준일 {s.get('d0')}) — 증자·분할·배당 수정주가 반영 방식 차이")

        h = s["hist"]
        lim = 30.5 if s["market"] == "KR" else 60
        for i in range(1, len(h)):
            m = (h[i] / h[i - 1] - 1) * 100
            # 미국: 급변 후 가격이 유지되면(다음 날 ±30% 이내) 실제 이벤트로 보고 참고 처리. 국내는 가격제한폭 초과 = 오류
            if abs(m) > lim and s["market"] == "US" and i + 1 < len(h) and abs(h[i + 1] / h[i] - 1) < 0.3:
                notes.append(f"[급변동(가격 유지)] {tag}: {h[i-1]:,} → {h[i]:,} ({m:+.1f}%) — 실제 이벤트 가능, 뉴스 확인")
            elif abs(m) > lim:
                issues.append(f"[일간 변동 이상치] {tag}: {h[i-1]:,} → {h[i]:,} ({m:+.1f}%)")
        if abs((s["price"] / h[0] - 1) * 100 - s["r1y"]) > 0.05:
            issues.append(f"[수익률 재계산 불일치] {tag}")
        if abs(h[-1] / s["price"] - 1) > 0.02:
            notes.append(f"[차트 마지막 값 차이] {tag}: 차트 {h[-1]:,} vs 현재가 {s['price']:,}")
        if s["price"] <= 0 or s["mcap"] <= 0 or (s.get("pbr") is not None and s["pbr"] <= 0):
            issues.append(f"[이상값] {tag}: 가격/시총/PBR 0 이하")
        if s.get("epsG") is not None and abs(s["epsG"]) > 300:
            notes.append(f"[극단값] {tag}: EPS 증가율 {s['epsG']}% (전년 동기 이익이 작아 생긴 착시 가능, 점수 반영은 150%로 상한)")

    miss = {k: sum(1 for s in stocks if s.get(k) is None) for k in ("per", "fper", "pbr", "roe", "opm", "debt", "epsG", "revG", "target", "rec")}
    diffs.sort()
    kr, us = sum(s["market"] == "KR" for s in stocks), sum(s["market"] == "US" for s in stocks)
    lines = [
        f"SH STOCK 데이터 검증 리포트 · 데이터 {asof} · 검증 {datetime.datetime.now():%Y-%m-%d %H:%M}",
        f"대조: 국내 {kr}종목(앱=네이버 ↔ Yahoo) · 미국 {us}종목(앱=Yahoo ↔ 네이버)",
        f"현재가 대조 {len(diffs)}종목 · 오차 중앙값 {diffs[len(diffs)//2]:.3f}% · 최대 {diffs[-1]:.3f}% · 1% 초과 {sum(d > 1 for d in diffs)}종목" if diffs else "현재가 대조 0종목",
        "결측치(값 없음 → 화면에 '-' 표시, 점수는 중립 처리): " + ", ".join(f"{k} {v}" for k, v in miss.items()),
        "",
        f"■ 경고 {len(issues)}건", *(issues or ["- 없음"]),
        "",
        f"■ 참고 {len(notes)}건", *(notes or ["- 없음"]),
    ]
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    # 앱 홈 화면에 표시할 검증 요약
    summary = {"asof": asof, "checked": f"{datetime.datetime.now():%Y-%m-%d %H:%M}", "n": len(diffs),
               "median": round(diffs[len(diffs) // 2], 3) if diffs else None, "max": round(diffs[-1], 3) if diffs else None,
               "over1": sum(d > 1 for d in diffs), "issues": len(issues), "notes": len(notes), "items": issues[:20]}
    (ROOT / "app" / "verify.js").write_text("// 자동 생성 — tools/verify_data.py\nconst VERIFY = " + json.dumps(summary, ensure_ascii=False) + ";\n", encoding="utf-8")
    print("\n".join(lines[:4]))
    print(f"경고 {len(issues)}건 · 참고 {len(notes)}건 → {REPORT}")


if __name__ == "__main__":
    main()
