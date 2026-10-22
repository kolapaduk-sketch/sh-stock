"""
SH STOCK 실시간 서버 (내 PC 전용)
  python tools/live_server.py          → 이 PC에서만 접속  http://localhost:8770
  python tools/live_server.py --lan    → 같은 와이파이의 휴대폰에서도 접속
  (바탕화면 폴더의 'SH STOCK 실시간.bat' / 'SH STOCK 실시간 (휴대폰 같이).bat' 더블클릭으로도 실행)

하는 일
  1) app/ 폴더의 앱 화면을 그대로 보여준다 (점수·재무는 하루 2번 수집한 data.js 사용)
  2) 앱이 요청하는 종목의 현재가·오늘 분봉을 네이버(국내)·Yahoo(미국)에서 대신 받아 전달한다
     (브라우저는 보안 정책상 네이버·Yahoo 에 직접 요청할 수 없어서 이 PC가 중계)
외부 패키지 없이 표준 라이브러리만 사용.
"""
import json, re, sys, time, socket, threading, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
PORT = 8770
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
KR_CODE = re.compile(r"^[0-9][0-9A-Z]{5}$")          # 국내 종목코드 (예: 005930, 0220W0)
US_CODE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")      # 미국 티커 (예: NVDA, BRK-B)
QUOTE_TTL, INTRA_TTL = 8, 45
sys.path.insert(0, str(Path(__file__).resolve().parent))
from market_index import fetch_indices, fetch_market_flows                           # 초 — 같은 요청은 잠깐 재사용해 출처에 부담을 주지 않음

_cache, _lock = {}, threading.Lock()
pool = ThreadPoolExecutor(max_workers=8)


def cached(key, ttl, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (now, val)
    return val


def get(url, raw=False):
    r = urllib.request.Request(url, headers={"User-Agent": UA})
    body = urllib.request.urlopen(r, timeout=10).read()
    return body if raw else json.loads(body.decode("utf-8"))


num = lambda v: None if v in (None, "", "-", "N/A") else float(str(v).replace(",", "").replace("+", ""))


# ── 현재가 ──────────────────────────────────────────
def kr_quotes(codes):
    out = {}
    for i in range(0, len(codes), 40):
        chunk = codes[i:i + 40]
        d = get("https://polling.finance.naver.com/api/realtime/domestic/stock/" + ",".join(chunk))
        for x in d.get("datas") or []:
            out[x["itemCode"]] = {"price": num(x.get("closePrice")), "chg": num(x.get("fluctuationsRatio")),
                                  "diff": num(x.get("compareToPreviousClosePrice")), "status": x.get("marketStatus"),
                                  "time": (x.get("localTradedAt") or "")[:19]}
    return out


def us_quote(code):
    m = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(code)}?range=1d&interval=5m")["chart"]["result"][0]["meta"]
    p, prev = m.get("regularMarketPrice"), m.get("chartPreviousClose") or m.get("previousClose")
    return {"price": p, "chg": round((p / prev - 1) * 100, 2) if p and prev else None, "diff": round(p - prev, 4) if p and prev else None,
            "status": "OPEN" if m.get("currentTradingPeriod", {}).get("regular", {}).get("start", 0) <= time.time() <= m.get("currentTradingPeriod", {}).get("regular", {}).get("end", 0) else "CLOSE",
            "time": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(m.get("regularMarketTime") or time.time()))}


def quotes(codes):
    kr = [c for c in codes if KR_CODE.match(c)]
    us = [c for c in codes if US_CODE.match(c) and not KR_CODE.match(c)]
    out = {}
    if kr:
        out.update(cached("kr:" + ",".join(sorted(kr)), QUOTE_TTL, lambda: kr_quotes(sorted(kr))))
    def one(c):
        try:
            return c, cached("us:" + c, QUOTE_TTL, lambda: us_quote(c))
        except Exception:
            return c, None
    for c, q in pool.map(one, us[:40]):
        if q:
            out[c] = q
    return out


# ── 오늘 분봉 ───────────────────────────────────────
def kr_intraday(code):
    t = get(f"https://fchart.stock.naver.com/sise.nhn?symbol={code}&timeframe=minute&count=600&requestType=0", raw=True).decode("euc-kr", "replace")
    rows = [x.split("|") for x in re.findall(r'data="([^"]+)"', t)]
    rows = [r for r in rows if r[4] not in ("null", "")]
    if not rows:
        return {"points": []}
    day = rows[-1][0][:8]
    pts = [[f"{r[0][8:10]}:{r[0][10:12]}", float(r[4])] for r in rows if r[0].startswith(day)]
    return {"day": f"{day[:4]}-{day[4:6]}-{day[6:]}", "points": pts}


def us_intraday(code):
    r = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(code)}?range=1d&interval=5m")["chart"]["result"][0]
    ts, cl = r.get("timestamp") or [], r["indicators"]["quote"][0].get("close") or []
    pts = [[time.strftime("%H:%M", time.localtime(t)), c] for t, c in zip(ts, cl) if c is not None]
    return {"day": time.strftime("%Y-%m-%d", time.localtime(ts[-1])) if ts else None, "points": pts,
            "prev": r["meta"].get("chartPreviousClose")}


def intraday(code):
    if KR_CODE.match(code):
        return cached("ki:" + code, INTRA_TTL, lambda: kr_intraday(code))
    if US_CODE.match(code):
        return cached("ui:" + code, INTRA_TTL, lambda: us_intraday(code))
    return {"points": []}


# ── HTTP ────────────────────────────────────────────
class Handler(SimpleHTTPRequestHandler):
    # Windows 레지스트리 설정과 무관하게 올바른 형식으로 전달 (서비스워커는 JS 형식이 아니면 등록 거부)
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "application/javascript; charset=utf-8",
                      ".webmanifest": "application/manifest+json", ".css": "text/css; charset=utf-8",
                      ".html": "text/html; charset=utf-8", ".png": "image/png", ".json": "application/json"}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(APP), **k)

    def log_message(self, fmt, *args):  # 접속 로그는 생략 (화면 깔끔하게)
        pass

    def end_headers(self):
        if self.path.endswith(".js") or self.path.endswith(".html") or self.path in ("/", ""):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if not u.path.startswith("/api/"):
            return super().do_GET()
        q = urllib.parse.parse_qs(u.query)
        try:
            if u.path == "/api/ping":
                return self.send_json({"ok": True, "time": time.strftime("%Y-%m-%d %H:%M:%S")})
            if u.path == "/api/quotes":
                codes = [c for c in (q.get("codes", [""])[0].upper().split(",")) if c and (KR_CODE.match(c) or US_CODE.match(c))][:120]
                return self.send_json({"time": time.strftime("%H:%M:%S"), "quotes": quotes(codes)})
            if u.path == "/api/indices":
                return self.send_json({"time": time.strftime("%H:%M:%S"), "indices": cached("idx", 15, fetch_indices)})
            if u.path == "/api/flows":
                return self.send_json({"time": time.strftime("%H:%M:%S"), "flows": cached("flows", 50, fetch_market_flows)})
            if u.path == "/api/intraday":
                code = q.get("code", [""])[0].upper()
                return self.send_json(intraday(code))
            return self.send_json({"error": "not found"}, 404)
        except Exception as e:
            return self.send_json({"error": str(e)[:120]}, 502)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def refresh_if_stale(hours=14):
    """앱 데이터(data.js)가 오래됐으면 백그라운드로 새로 수집 (점수·재무·뉴스). 끝나면 앱을 새로고침하면 반영"""
    import subprocess
    f = APP / "data.js"
    age = (time.time() - f.stat().st_mtime) / 3600 if f.exists() else 999
    if age < hours:
        return
    print(f"  데이터가 {age:.0f}시간 전 것이라 새로 받는 중입니다 (약 15분, 끝나면 앱 새로고침)")
    tools = Path(__file__).resolve().parent
    def job():
        r = subprocess.run([sys.executable, str(tools / "fetch_data.py")], capture_output=True, env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
        if r.returncode == 0:
            subprocess.run([sys.executable, str(tools / "verify_data.py")], capture_output=True, env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
            print(f"  [{time.strftime('%H:%M')}] 데이터 갱신 완료 — 앱을 새로고침하세요")
        else:
            print(f"  [{time.strftime('%H:%M')}] 데이터 갱신 실패 — 기존 데이터로 계속 사용")
    threading.Thread(target=job, daemon=True).start()


if __name__ == "__main__":
    lan = "--lan" in sys.argv
    host = "0.0.0.0" if lan else "127.0.0.1"
    srv = ThreadingHTTPServer((host, PORT), Handler)
    print("=" * 56)
    print(" SH STOCK 실시간 서버 실행 중  (이 창을 닫으면 종료)")
    print(f"  PC에서:      http://localhost:{PORT}/")
    if lan and lan_ip():
        print(f"  휴대폰에서:  http://{lan_ip()}:{PORT}/   (같은 와이파이)")
    print("=" * 56)
    refresh_if_stale()
    if "--open" in sys.argv:  # 실행 파일로 켰을 때 브라우저 자동 열기
        import webbrowser
        threading.Timer(1.5, lambda: webbrowser.open(f"http://localhost:{PORT}/")).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
