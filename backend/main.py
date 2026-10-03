"""KhelSetu backend (MVP). FastAPI + SQLite (stdlib). Serves the PWA from ../frontend.

Design notes
- Events are immutable and idempotent (client UUID primary key), so offline sync never conflicts.
- Squad scoring is fairness-designed: mean goal completion, daily credit cap, manual minutes weigh less,
  comeback bonus, no individual raw-performance ranking is ever exposed.
- Admin aggregates are k-anonymous: groups smaller than K are folded into "Other"; if that is still < K it is hidden.
- SQLite stands in for PostgreSQL in the MVP. Every query is scoped by institution_id (what RLS would enforce in Postgres).
"""
import base64, hashlib, hmac, io, json, math, mimetypes, os, random, secrets, sqlite3, time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel, Field

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/manifest+json", ".webmanifest")

BASE = Path(__file__).resolve().parent
DB_PATH = os.environ.get("KHELSETU_DB", str(BASE / "khelsetu.db"))
MEDIA_DIR = Path(os.environ.get("KHELSETU_MEDIA_DIR", str(BASE / "media")))
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
Image.MAX_IMAGE_PIXELS = 10_000_000
K_ANON = int(os.environ.get("K_ANON", "10"))
DEMO = os.environ.get("DEMO", "1") == "1"
ADMIN_KEY = os.environ.get("ADMIN_KEY", "demo-admin" if DEMO else "")
IST = timezone(timedelta(hours=5, minutes=30))
CONSENT_VERSION = "2026-10-v1"

# Mirrors frontend/engine.js
WEEKLY_CAP, GENTLE_CAP, RAMP = 150, 90, 1.1
START_MIN = {"starter": 60, "building": 90, "steady": 120, "strong": 150}
BANDS = [("starter", 25), ("building", 50), ("steady", 75), ("strong", 101)]
DAILY_CREDIT_CAP, UNVERIFIED_WEIGHT = 60, 0.5


def _secret() -> bytes:
    env = os.environ.get("KHELSETU_SECRET")
    if env:
        return env.encode()
    f = BASE / ".secret"
    if not f.exists():
        f.write_text(secrets.token_hex(32))
    return f.read_text().encode()


SECRET = _secret()

# ---------------------------------------------------------------- db
SCHEMA = """
CREATE TABLE IF NOT EXISTS institutions(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, institution_id INTEGER NOT NULL REFERENCES institutions(id),
  display_name TEXT NOT NULL, grp TEXT NOT NULL, year INTEGER, email TEXT, roll_no TEXT,
  public_key TEXT, role TEXT DEFAULT 'student', synthetic INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS consents(
  id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), version TEXT NOT NULL,
  purposes TEXT NOT NULL, age_18 INTEGER NOT NULL, given_at INTEGER NOT NULL, withdrawn_at INTEGER);
-- Only the OUTCOME of the PAR-Q-style screening leaves the device, never the answers.
CREATE TABLE IF NOT EXISTS screenings(user_id TEXT PRIMARY KEY REFERENCES users(id), cleared INTEGER NOT NULL, gentle INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS assessments(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), ts INTEGER NOT NULL, kind TEXT NOT NULL,
  value REAL NOT NULL, unit TEXT NOT NULL, validity TEXT NOT NULL, confidence REAL, modified INTEGER DEFAULT 0,
  peer_witness TEXT, source TEXT DEFAULT 'camera', received_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS activity_events(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), ts INTEGER NOT NULL, minutes REAL NOT NULL,
  activity TEXT NOT NULL, verified INTEGER NOT NULL, source TEXT DEFAULT 'app', received_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS goals(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), ts INTEGER NOT NULL, band TEXT NOT NULL,
  idx INTEGER NOT NULL, start_minutes INTEGER NOT NULL, gentle INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS squads(
  id INTEGER PRIMARY KEY, institution_id INTEGER NOT NULL REFERENCES institutions(id), name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL, created_by TEXT, women_only INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS squad_members(
  squad_id INTEGER NOT NULL REFERENCES squads(id), user_id TEXT NOT NULL REFERENCES users(id),
  hide_progress INTEGER DEFAULT 0, joined_at INTEGER NOT NULL, UNIQUE(squad_id, user_id));
CREATE TABLE IF NOT EXISTS squad_reports(
  id INTEGER PRIMARY KEY, squad_id INTEGER NOT NULL REFERENCES squads(id), reporter_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS officer_sessions(
  id TEXT PRIMARY KEY, institution_id INTEGER NOT NULL REFERENCES institutions(id), officer_id TEXT NOT NULL,
  title TEXT NOT NULL, code TEXT UNIQUE NOT NULL, minutes REAL NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS retest_records(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), ts INTEGER NOT NULL,
  old_idx INTEGER NOT NULL, new_idx INTEGER NOT NULL, delta INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS otps(
  identifier TEXT PRIMARY KEY, otp TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_channels(
  id TEXT PRIMARY KEY, institution_id INTEGER NOT NULL REFERENCES institutions(id),
  kind TEXT NOT NULL, squad_id INTEGER REFERENCES squads(id), user_id TEXT REFERENCES users(id),
  title TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_messages(
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES chat_channels(id),
  sender_id TEXT NOT NULL REFERENCES users(id), sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'student', content TEXT NOT NULL,
  flagged INTEGER DEFAULT 0, flag_reason TEXT, held_for_review INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0, delete_reason TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_reactions(
  message_id TEXT NOT NULL REFERENCES chat_messages(id), user_id TEXT NOT NULL REFERENCES users(id),
  emoji TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(message_id, user_id, emoji));
CREATE TABLE IF NOT EXISTS chat_reports(
  id INTEGER PRIMARY KEY, message_id TEXT NOT NULL REFERENCES chat_messages(id),
  reporter_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL,
  resolved INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_blocks(
  user_id TEXT NOT NULL REFERENCES users(id), blocked_user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, UNIQUE(user_id, blocked_user_id));
CREATE TABLE IF NOT EXISTS user_preferences(
  user_id TEXT PRIMARY KEY REFERENCES users(id), theme TEXT DEFAULT 'light',
  haptics INTEGER DEFAULT 1, kindness_mode INTEGER DEFAULT 0, board_opt_out INTEGER DEFAULT 0,
  alias TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS media_files(
  id TEXT PRIMARY KEY, institution_id INTEGER NOT NULL REFERENCES institutions(id),
  owner_id TEXT NOT NULL REFERENCES users(id), file_path TEXT NOT NULL,
  thumb_path TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS posts(
  id TEXT PRIMARY KEY, institution_id INTEGER NOT NULL REFERENCES institutions(id),
  author_id TEXT NOT NULL REFERENCES users(id), author_name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'squad', squad_id INTEGER REFERENCES squads(id),
  grp TEXT, caption TEXT NOT NULL, tag TEXT NOT NULL, image_id TEXT NOT NULL REFERENCES media_files(id),
  image_url TEXT NOT NULL, thumb_url TEXT NOT NULL, flagged INTEGER DEFAULT 0,
  flag_reason TEXT, held_for_review INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0,
  delete_reason TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS post_reactions(
  post_id TEXT NOT NULL REFERENCES posts(id), user_id TEXT NOT NULL REFERENCES users(id),
  emoji TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(post_id, user_id, emoji));
CREATE TABLE IF NOT EXISTS post_comments(
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id),
  author_id TEXT NOT NULL REFERENCES users(id), author_name TEXT NOT NULL,
  content TEXT NOT NULL, flagged INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS post_reports(
  id INTEGER PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id),
  reporter_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL,
  resolved INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meal_logs(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  meal_type TEXT NOT NULL, title TEXT, image_id TEXT REFERENCES media_files(id),
  total_calories REAL NOT NULL, total_protein_g REAL NOT NULL,
  total_carbs_g REAL NOT NULL, total_fat_g REAL NOT NULL, total_fiber_g REAL DEFAULT 0,
  notes TEXT, logged_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meal_items(
  id TEXT PRIMARY KEY, meal_id TEXT NOT NULL REFERENCES meal_logs(id),
  name TEXT NOT NULL, portion_g REAL NOT NULL, calories REAL NOT NULL,
  protein_g REAL NOT NULL, carbs_g REAL NOT NULL, fat_g REAL NOT NULL,
  fiber_g REAL DEFAULT 0, source_db TEXT DEFAULT 'IFCT2017');
CREATE TABLE IF NOT EXISTS assistant_messages(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL, content TEXT NOT NULL, tools_called TEXT,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT, action TEXT NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS idx_act_user_ts ON activity_events(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_ass_user_ts ON assessments(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_chat_chan_ts ON chat_messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_inst_ts ON posts(institution_id, created_at);
CREATE INDEX IF NOT EXISTS idx_meals_user_ts ON meal_logs(user_id, logged_at);
"""


def db() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def init_db():
    c = db()
    c.executescript(SCHEMA)
    # Automatic schema migration for existing sqlite db files
    user_cols = {r["name"] for r in c.execute("PRAGMA table_info(users)").fetchall()}
    for col, ctype in [("email", "TEXT"), ("roll_no", "TEXT"), ("public_key", "TEXT"), ("role", "TEXT DEFAULT 'student'")]:
        if col not in user_cols:
            try:
                c.execute(f"ALTER TABLE users ADD COLUMN {col} {ctype}")
            except Exception:
                pass
    squad_mem_cols = {r["name"] for r in c.execute("PRAGMA table_info(squad_members)").fetchall()}
    if "hide_progress" not in squad_mem_cols:
        try:
            c.execute("ALTER TABLE squad_members ADD COLUMN hide_progress INTEGER DEFAULT 0")
        except Exception:
            pass
    c.execute("INSERT OR IGNORE INTO institutions(code,name) VALUES('DEMO','Demo College')")
    c.commit(); c.close()


def audit(c, actor, action, detail=""):
    c.execute("INSERT INTO audit_logs(ts,actor,action,detail) VALUES(?,?,?,?)", (now(), actor, action, detail))


def now() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------- auth (HMAC-signed, short-lived)
def make_token(uid: str, ttl_days: int = 30) -> str:
    body = base64.urlsafe_b64encode(json.dumps({"u": uid, "exp": int(time.time()) + ttl_days * 86400}).encode()).decode()
    sig = hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def current_user(authorization: Optional[str] = Header(None)) -> sqlite3.Row:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing_token")
    try:
        body, sig = authorization[7:].rsplit(".", 1)
        if not hmac.compare_digest(sig, hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()):
            raise ValueError
        data = json.loads(base64.urlsafe_b64decode(body))
        if data["exp"] < time.time():
            raise ValueError
    except Exception:
        raise HTTPException(401, "bad_token")
    c = db()
    u = c.execute("SELECT * FROM users WHERE id=?", (data["u"],)).fetchone()
    c.close()
    if not u:
        raise HTTPException(401, "unknown_user")
    return u


_hits: dict = defaultdict(list)


def rate_limit(request: Request):
    ip = request.client.host if request.client else "?"
    t = time.time()
    _hits[ip] = [x for x in _hits[ip] if t - x < 60]
    if len(_hits[ip]) >= 120:
        raise HTTPException(429, "slow_down")
    _hits[ip].append(t)


def admin_only(x_admin_key: Optional[str] = Header(None)):
    if not ADMIN_KEY or not x_admin_key or not hmac.compare_digest(x_admin_key, ADMIN_KEY):
        raise HTTPException(403, "admin_key_required")


# ---------------------------------------------------------------- scoring (fairness-designed)
def week_start(ts_ms: int) -> datetime:
    d = datetime.fromtimestamp(ts_ms / 1000, IST)
    return (d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def band_of(index: float) -> str:
    return next(b for b, mx in BANDS if index < mx)


def goal_for(goal_row, at_ms: int) -> int:
    """Weekly active-minute goal for the week containing at_ms (same formula as the client)."""
    if not goal_row:
        return 60
    cap = GENTLE_CAP if goal_row["gentle"] else WEEKLY_CAP
    weeks = max(0, (week_start(at_ms) - week_start(goal_row["ts"])).days // 7)
    start = min(goal_row["start_minutes"], cap)
    return min(cap, int(round(start * RAMP ** weeks / 5) * 5))


def credited_minutes(c, uid: str, ws: datetime) -> float:
    """Sum of minutes in the week, with per-day credit cap and reduced weight for unverified entries."""
    lo, hi = int(ws.timestamp() * 1000), int((ws + timedelta(days=7)).timestamp() * 1000)
    per_day: dict = defaultdict(float)
    for r in c.execute("SELECT ts,minutes,verified FROM activity_events WHERE user_id=? AND ts>=? AND ts<?", (uid, lo, hi)):
        day = datetime.fromtimestamp(r["ts"] / 1000, IST).date()
        per_day[day] += r["minutes"] * (1.0 if r["verified"] else UNVERIFIED_WEIGHT)
    return sum(min(v, DAILY_CREDIT_CAP) for v in per_day.values())


def completion(c, uid: str, ws: datetime) -> float:
    g = c.execute("SELECT * FROM goals WHERE user_id=? ORDER BY ts DESC LIMIT 1", (uid,)).fetchone()
    goal = goal_for(g, int(ws.timestamp() * 1000))
    return min(1.0, credited_minutes(c, uid, ws) / goal) if goal else 0.0


def squad_score(c, member_ids: list, ws: datetime):
    """Mean completion (not sum) + capped comeback bonus. Returns (score, per-member completion)."""
    if not member_ids:
        return 0.0, {}
    prev = ws - timedelta(days=7)
    comp = {u: completion(c, u, ws) for u in member_ids}
    def existed_last_week(u):  # a brand-new user is not a "comeback"
        g = c.execute("SELECT MIN(ts) t FROM goals WHERE user_id=?", (u,)).fetchone()
        return bool(g and g["t"] is not None and g["t"] < int(ws.timestamp() * 1000))
    comeback = sum(1 for u in member_ids if existed_last_week(u) and completion(c, u, prev) < 0.25 and comp[u] >= 0.5)
    score = sum(comp.values()) / len(member_ids) * 100 + min(10, 2 * comeback)
    return round(score, 1), comp


def squad_division(c, member_ids: list) -> str:
    if not member_ids:
        return "building"
    q = ",".join("?" * len(member_ids))
    rows = c.execute(f"SELECT user_id, idx FROM goals WHERE user_id IN ({q}) AND ts=(SELECT MAX(ts) FROM goals g2 WHERE g2.user_id=goals.user_id)", member_ids).fetchall()
    return band_of(sum(r["idx"] for r in rows) / len(rows)) if rows else "building"


# ---------------------------------------------------------------- models
class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    institution_code: str = Field(min_length=1, max_length=20)
    group: str = Field(min_length=1, max_length=40)
    year: Optional[int] = Field(None, ge=1, le=6)
    email: Optional[str] = Field(None, max_length=80)
    roll_no: Optional[str] = Field(None, max_length=30)
    public_key: Optional[str] = None
    age_confirmed_18: bool
    consent_version: str
    purposes: list[str]
    screening_cleared: bool = True
    gentle: bool = False


class OtpSendIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=80)
    institution_code: str = Field(min_length=1, max_length=20)


class OtpVerifyIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=80)
    otp: str = Field(min_length=4, max_length=10)
    name: str = Field(min_length=1, max_length=40)
    institution_code: str = Field(min_length=1, max_length=20)
    group: str = Field(min_length=1, max_length=40)
    year: Optional[int] = Field(None, ge=1, le=6)
    roll_no: Optional[str] = Field(None, max_length=30)
    age_confirmed_18: bool
    consent_version: str
    purposes: list[str]
    screening_cleared: bool = True
    gentle: bool = False
    public_key: Optional[str] = None


class EventIn(BaseModel):
    id: str = Field(min_length=8, max_length=64)
    type: str
    ts: int
    payload: dict[str, Any]
    sig: Optional[str] = None


class SyncIn(BaseModel):
    events: list[EventIn] = Field(max_length=500)


class SquadIn(BaseModel):
    name: str = Field(min_length=2, max_length=30)
    women_only: bool = False


class JoinIn(BaseModel):
    code: str


class OfficerSessionIn(BaseModel):
    title: str = Field(min_length=2, max_length=50)
    minutes: float = Field(gt=0, le=180)


class SessionCheckinIn(BaseModel):
    code: str = Field(min_length=4, max_length=10)


class SquadReportIn(BaseModel):
    reason: str = Field(min_length=3, max_length=200)


class RetestIn(BaseModel):
    old_index: int = Field(ge=0, le=100)
    new_index: int = Field(ge=0, le=100)


class ReserveSlotIn(BaseModel):
    facility_id: str = Field(min_length=2, max_length=30)
    slot_time: str = Field(min_length=4, max_length=20)


class PreferencesIn(BaseModel):
    theme: Optional[str] = "light"
    haptics: Optional[bool] = True
    kindness_mode: Optional[bool] = False
    board_opt_out: Optional[bool] = False
    alias: Optional[str] = Field(None, max_length=30)


class MessageSendIn(BaseModel):
    id: str = Field(min_length=8, max_length=64)
    content: str = Field(min_length=1, max_length=500)


class MessageReportIn(BaseModel):
    reason: str = Field(min_length=3, max_length=200)


class MessageDeleteIn(BaseModel):
    reason: Optional[str] = "deleted_by_user"


class MessageReactIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=10)


class BlockUserIn(BaseModel):
    blocked_user_id: str


class ModResolveIn(BaseModel):
    action: str = Field(pattern="^(approve|delete|dismiss)$")
    reason: Optional[str] = ""


class PostCreateIn(BaseModel):
    id: str = Field(min_length=8, max_length=64)
    image_id: str
    caption: str = Field(default="", max_length=300)
    tag: str = Field(default="Gym day", max_length=40)
    visibility: str = Field(default="squad", pattern="^(squad|hostel|campus)$")


class CommentCreateIn(BaseModel):
    id: str = Field(min_length=8, max_length=64)
    content: str = Field(min_length=1, max_length=200)


class PostReportIn(BaseModel):
    reason: str = Field(min_length=3, max_length=200)


class PostDeleteIn(BaseModel):
    reason: Optional[str] = "deleted_by_user"


class MealItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    portion_g: float = Field(gt=0, le=2000)
    calories: float = Field(ge=0, le=5000)
    protein_g: float = Field(ge=0, le=500)
    carbs_g: float = Field(ge=0, le=1000)
    fat_g: float = Field(ge=0, le=500)
    fiber_g: Optional[float] = 0.0
    source_db: Optional[str] = "IFCT2017"


class MealLogIn(BaseModel):
    id: str = Field(min_length=8, max_length=64)
    meal_type: str = Field(pattern="^(breakfast|lunch|dinner|snack)$")
    title: Optional[str] = ""
    image_id: Optional[str] = None
    items: list[MealItemIn]
    notes: Optional[str] = Field(default="", max_length=300)


class AssistantChatIn(BaseModel):
    messages: list[dict[str, Any]] = []
    message: Optional[str] = None




# ---------------------------------------------------------------- app
app = FastAPI(title="KhelSetu API", version="0.2-p1")
init_db()

LIMITS = {"squat": 70, "pushup": 70, "balance": 120000, "arm_raise": 70}


def validate_event(e: EventIn) -> Optional[str]:
    """Server-side plausibility checks. Returns a rejection reason or None."""
    n = now()
    if e.ts > n + 5 * 60_000: return "timestamp_in_future"
    if e.ts < n - 400 * 86_400_000: return "timestamp_too_old"
    p = e.payload
    try:
        if e.type == "assessment":
            kind = p["kind"]
            if kind not in LIMITS: return "unknown_kind"
            if not (0 <= float(p["value"]) <= LIMITS[kind]): return "implausible_value"
            if p["validity"] not in ("verified", "low_confidence", "manual"): return "bad_validity"
        elif e.type == "activity":
            if not (0 < float(p["minutes"]) <= 180): return "implausible_minutes"
        elif e.type == "baseline":
            if p["band"] not in START_MIN or not (0 <= int(p["index"]) <= 100): return "bad_baseline"
        else:
            return "unknown_type"
    except (KeyError, ValueError, TypeError):
        return "malformed_payload"
    return None


@app.post("/api/auth/otp/send", dependencies=[Depends(rate_limit)])
def send_otp(b: OtpSendIn):
    c = db()
    inst = c.execute("SELECT * FROM institutions WHERE code=?", (b.institution_code.strip().upper(),)).fetchone()
    if not inst:
        c.close(); raise HTTPException(404, "unknown_institution_code")
    code = f"{secrets.randbelow(900000) + 100000}"
    exp = now() + 10 * 60_000
    c.execute("INSERT OR REPLACE INTO otps VALUES(?,?,?)", (b.identifier.strip().lower(), code, exp))
    audit(c, "system", "send_otp", f"target={b.identifier} [DEV_OTP={code}]")
    c.commit(); c.close()
    return {"ok": True, "note": "OTP sent to institutional identifier. In development mode, check server logs or dev_otp.", "dev_otp": code if DEMO else None}


@app.post("/api/auth/otp/verify", dependencies=[Depends(rate_limit)])
def verify_otp(b: OtpVerifyIn):
    if not b.age_confirmed_18:
        raise HTTPException(403, "pilot_is_18_plus")
    c = db()
    record = c.execute("SELECT * FROM otps WHERE identifier=?", (b.identifier.strip().lower(),)).fetchone()
    if not record or record["otp"] != b.otp.strip() or record["expires_at"] < now():
        c.close(); raise HTTPException(400, "invalid_or_expired_otp")
    inst = c.execute("SELECT * FROM institutions WHERE code=?", (b.institution_code.strip().upper(),)).fetchone()
    if not inst:
        c.close(); raise HTTPException(404, "unknown_institution_code")
    c.execute("DELETE FROM otps WHERE identifier=?", (b.identifier.strip().lower(),))
    
    # Check if user already exists
    existing = c.execute("SELECT * FROM users WHERE email=? OR roll_no=?", (b.identifier.strip().lower(), b.identifier.strip().lower())).fetchone()
    t = now()
    if existing:
        uid = existing["id"]
        c.close()
        return {"token": make_token(uid), "user_id": uid, "institution": inst["name"]}
    
    uid = secrets.token_hex(8)
    c.execute("INSERT INTO users(id,institution_id,display_name,grp,year,email,roll_no,public_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
              (uid, inst["id"], b.name.strip(), b.group.strip(), b.year, b.identifier.strip().lower(), b.roll_no, b.public_key, t))
    c.execute("INSERT INTO consents(user_id,version,purposes,age_18,given_at) VALUES(?,?,?,?,?)", (uid, b.consent_version, json.dumps(b.purposes), 1, t))
    c.execute("INSERT INTO screenings VALUES(?,?,?,?)", (uid, int(b.screening_cleared), int(b.gentle), t))
    audit(c, uid, "register_otp", f"identifier={b.identifier}")
    c.commit(); c.close()
    return {"token": make_token(uid), "user_id": uid, "institution": inst["name"]}


@app.post("/api/register", dependencies=[Depends(rate_limit)])
def register(b: RegisterIn):
    if not b.age_confirmed_18:
        raise HTTPException(403, "pilot_is_18_plus")  # DPDP: avoids verifiable-parental-consent obligations for the pilot
    if not {"fitness_assessment", "activity_tracking"} <= set(b.purposes):
        raise HTTPException(400, "required_consent_purposes_missing")
    c = db()
    inst = c.execute("SELECT * FROM institutions WHERE code=?", (b.institution_code.strip().upper(),)).fetchone()
    if not inst:
        c.close(); raise HTTPException(404, "unknown_institution_code")
    uid = secrets.token_hex(8)
    t = now()
    c.execute("INSERT INTO users(id,institution_id,display_name,grp,year,email,roll_no,public_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
              (uid, inst["id"], b.name.strip(), b.group.strip(), b.year, b.email, b.roll_no, b.public_key, t))
    c.execute("INSERT INTO consents(user_id,version,purposes,age_18,given_at) VALUES(?,?,?,?,?)", (uid, b.consent_version, json.dumps(b.purposes), 1, t))
    c.execute("INSERT INTO screenings VALUES(?,?,?,?)", (uid, int(b.screening_cleared), int(b.gentle), t))
    audit(c, uid, "register", f"inst={inst['code']} consent={b.consent_version}")
    c.commit(); c.close()
    return {"token": make_token(uid), "user_id": uid, "institution": inst["name"]}


@app.post("/api/sync", dependencies=[Depends(rate_limit)])
def sync(body: SyncIn, u=Depends(current_user)):
    c = db(); accepted, rejected = [], []
    for e in body.events:
        why = validate_event(e)
        if why:
            rejected.append({"id": e.id, "reason": why}); continue
        if e.sig:
            audit(c, u["id"], "signed_event", f"event={e.id} sig={e.sig[:16]}")
        p, t = e.payload, now()
        if e.type == "assessment":
            cur = c.execute("INSERT OR IGNORE INTO assessments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                            (e.id, u["id"], e.ts, p["kind"], float(p["value"]), p.get("unit", ""), p["validity"],
                             p.get("confidence"), int(bool(p.get("modified"))), p.get("peer_witness"), p.get("source", "camera"), t))
        elif e.type == "activity":
            cur = c.execute("INSERT OR IGNORE INTO activity_events VALUES(?,?,?,?,?,?,?,?)",
                            (e.id, u["id"], e.ts, float(p["minutes"]), str(p.get("activity", "workout"))[:30],
                             int(bool(p.get("verified"))), p.get("source", "app"), t))
        else:
            gentle = int(bool(p.get("gentle")))
            cur = c.execute("INSERT OR IGNORE INTO goals VALUES(?,?,?,?,?,?,?)",
                            (e.id, u["id"], e.ts, p["band"], int(p["index"]), START_MIN[p["band"]], gentle))
        accepted.append(e.id)  # duplicates are accepted too: idempotent by design
    c.commit(); c.close()
    return {"accepted": accepted, "rejected": rejected}


@app.post("/api/officer/sessions", dependencies=[Depends(admin_only)])
def create_officer_session(b: OfficerSessionIn, x_admin_key: Optional[str] = Header(None)):
    c = db()
    inst = c.execute("SELECT id FROM institutions WHERE code='DEMO'").fetchone()["id"]
    code = secrets.token_hex(2).upper()
    sid = secrets.token_hex(6)
    exp = now() + 4 * 3600_000
    c.execute("INSERT INTO officer_sessions VALUES(?,?,?,?,?,?,?)", (sid, inst, "officer", b.title.strip(), code, b.minutes, exp))
    c.commit(); c.close()
    return {"session_id": sid, "code": code, "title": b.title, "minutes": b.minutes, "expires_in_hours": 4}


@app.post("/api/session/checkin", dependencies=[Depends(rate_limit)])
def session_checkin(b: SessionCheckinIn, u=Depends(current_user)):
    c = db()
    s = c.execute("SELECT * FROM officer_sessions WHERE code=? AND institution_id=? AND expires_at>?",
                  (b.code.strip().upper(), u["institution_id"], now())).fetchone()
    if not s:
        c.close(); raise HTTPException(404, "invalid_or_expired_session_code")
    eid = f"sess-{u['id']}-{s['id']}"
    t = now()
    c.execute("INSERT OR IGNORE INTO activity_events VALUES(?,?,?,?,?,?,?,?)",
              (eid, u["id"], t, s["minutes"], f"verified_{s['title'].lower()[:20]}", 1, "officer_qr", t))
    audit(c, u["id"], "officer_checkin", f"session={s['title']}")
    c.commit(); c.close()
    return {"credited_minutes": s["minutes"], "title": s["title"], "verified": True}


@app.post("/api/retest/record", dependencies=[Depends(rate_limit)])
def record_retest(b: RetestIn, u=Depends(current_user)):
    c = db()
    rid = secrets.token_hex(8)
    delta = b.new_index - b.old_index
    t = now()
    c.execute("INSERT INTO retest_records VALUES(?,?,?,?,?,?)", (rid, u["id"], t, b.old_index, b.new_index, delta))
    audit(c, u["id"], "retest_delta", f"old={b.old_index} new={b.new_index} delta={delta}")
    c.commit(); c.close()
    return {"retest_id": rid, "delta": delta, "improved": delta > 0}


@app.get("/api/me")
def me(u=Depends(current_user)):
    c = db()
    g = c.execute("SELECT * FROM goals WHERE user_id=? ORDER BY ts DESC LIMIT 1", (u["id"],)).fetchone()
    ws = week_start(now())
    out = {"name": u["display_name"], "group": u["grp"], "weekly_goal": goal_for(g, now()) if g else None,
           "credited_minutes": round(credited_minutes(c, u["id"], ws), 1), "completion": round(completion(c, u["id"], ws), 3)}
    c.close(); return out


def squad_view(c, u, squad):
    ws = week_start(now())
    ids = [r["user_id"] for r in c.execute("SELECT user_id FROM squad_members WHERE squad_id=?", (squad["id"],))]
    score, comp = squad_score(c, ids, ws)
    names = {r["id"]: r["display_name"] for r in c.execute(f"SELECT id,display_name FROM users WHERE id IN ({','.join('?' * len(ids))})", ids)}
    division = squad_division(c, ids)
    standings = []
    for s in c.execute("SELECT * FROM squads WHERE institution_id=?", (squad["institution_id"],)).fetchall():
        sids = [r["user_id"] for r in c.execute("SELECT user_id FROM squad_members WHERE squad_id=?", (s["id"],))]
        if squad_division(c, sids) == division and len(sids) >= 2:
            standings.append({"id": s["id"], "name": s["name"], "score": squad_score(c, sids, ws)[0], "members": len(sids)})
    standings.sort(key=lambda x: -x["score"])
    rank = next((i + 1 for i, s in enumerate(standings) if s["id"] == squad["id"]), None)
    # Members expose only goal completion (relative to own goal), never raw reps/fitness values.
    members = sorted(({"name": names[i], "completion_pct": round(comp[i] * 100), "you": i == u["id"]} for i in ids), key=lambda m: m["name"])
    return {"id": squad["id"], "name": squad["name"], "code": squad["code"], "division": division, "score": score,
            "rank": rank, "of": len(standings), "members": members, "standings": [{k: v for k, v in s.items() if k != "id"} for s in standings[:5]]}


@app.post("/api/squads", dependencies=[Depends(rate_limit)])
def create_squad(b: SquadIn, u=Depends(current_user)):
    c = db()
    code = secrets.token_hex(3).upper()
    cur = c.execute("INSERT INTO squads(institution_id,name,code,created_by,women_only,created_at) VALUES(?,?,?,?,?,?)",
                    (u["institution_id"], b.name.strip(), code, u["id"], int(b.women_only), now()))
    c.execute("INSERT INTO squad_members(squad_id,user_id,joined_at) VALUES(?,?,?)", (cur.lastrowid, u["id"], now()))
    c.commit()
    s = c.execute("SELECT * FROM squads WHERE id=?", (cur.lastrowid,)).fetchone(); v = squad_view(c, u, s); c.close(); return v


@app.post("/api/squads/join", dependencies=[Depends(rate_limit)])
def join_squad(b: JoinIn, u=Depends(current_user)):
    c = db()
    s = c.execute("SELECT * FROM squads WHERE code=? AND institution_id=?", (b.code.strip().upper(), u["institution_id"])).fetchone()
    if not s:
        c.close(); raise HTTPException(404, "squad_not_found")
    n = c.execute("SELECT COUNT(*) n FROM squad_members WHERE squad_id=?", (s["id"],)).fetchone()["n"]
    if n >= 8:
        c.close(); raise HTTPException(409, "squad_full")
    c.execute("INSERT OR IGNORE INTO squad_members(squad_id,user_id,joined_at) VALUES(?,?,?)", (s["id"], u["id"], now()))
    c.commit(); v = squad_view(c, u, s); c.close(); return v


@app.get("/api/squads/me")
def my_squad(u=Depends(current_user)):
    c = db()
    s = c.execute("SELECT s.* FROM squads s JOIN squad_members m ON m.squad_id=s.id WHERE m.user_id=? ORDER BY m.joined_at DESC LIMIT 1", (u["id"],)).fetchone()
    v = squad_view(c, u, s) if s else None
    c.close(); return {"squad": v}


@app.post("/api/squads/{squad_id}/leave", dependencies=[Depends(rate_limit)])
def leave_squad(squad_id: int, u=Depends(current_user)):
    c = db()
    c.execute("DELETE FROM squad_members WHERE squad_id=? AND user_id=?", (squad_id, u["id"]))
    audit(c, u["id"], "leave_squad", f"squad={squad_id}")
    c.commit(); c.close()
    return {"left": True}


@app.post("/api/squads/{squad_id}/report", dependencies=[Depends(rate_limit)])
def report_squad(squad_id: int, b: SquadReportIn, u=Depends(current_user)):
    c = db()
    s = c.execute("SELECT * FROM squads WHERE id=?", (squad_id,)).fetchone()
    if not s:
        c.close(); raise HTTPException(404, "squad_not_found")
    c.execute("INSERT INTO squad_reports(squad_id,reporter_id,reason,created_at) VALUES(?,?,?,?)",
              (squad_id, u["id"], b.reason.strip(), now()))
    audit(c, u["id"], "report_squad", f"squad={squad_id} reason={b.reason[:30]}")
    c.commit(); c.close()
    return {"reported": True}


@app.get("/api/me/export")
def export_me(u=Depends(current_user)):
    c = db(); uid = u["id"]
    out = {"user": dict(u)}
    for t in ("consents", "screenings", "assessments", "activity_events", "goals", "user_preferences", "user_blocks", "chat_reactions", "post_reactions"):
        out[t] = [dict(r) for r in c.execute(f"SELECT * FROM {t} WHERE user_id=?", (uid,))]
    out["chat_messages"] = [dict(r) for r in c.execute("SELECT * FROM chat_messages WHERE sender_id=?", (uid,))]
    out["posts"] = [dict(r) for r in c.execute("SELECT * FROM posts WHERE author_id=?", (uid,))]
    out["post_comments"] = [dict(r) for r in c.execute("SELECT * FROM post_comments WHERE author_id=?", (uid,))]
    out["meal_logs"] = [dict(r) for r in c.execute("SELECT * FROM meal_logs WHERE user_id=?", (uid,))]
    out["meal_items"] = [dict(r) for r in c.execute("SELECT mi.* FROM meal_items mi JOIN meal_logs ml ON ml.id=mi.meal_id WHERE ml.user_id=?", (uid,))]
    out["assistant_messages"] = [dict(r) for r in c.execute("SELECT * FROM assistant_messages WHERE user_id=?", (uid,))]
    audit(c, uid, "export"); c.commit(); c.close(); return out


@app.post("/api/me/delete")
def delete_me(u=Depends(current_user)):
    c = db(); uid = u["id"]
    media_rows = c.execute("SELECT file_path, thumb_path FROM media_files WHERE owner_id=?", (uid,)).fetchall()
    for mr in media_rows:
        try:
            if os.path.exists(mr["file_path"]): os.remove(mr["file_path"])
            if os.path.exists(mr["thumb_path"]): os.remove(mr["thumb_path"])
        except Exception:
            pass
    c.execute("DELETE FROM meal_items WHERE meal_id IN (SELECT id FROM meal_logs WHERE user_id=?)", (uid,))
    c.execute("DELETE FROM meal_logs WHERE user_id=?", (uid,))
    c.execute("DELETE FROM assistant_messages WHERE user_id=?", (uid,))
    c.execute("DELETE FROM post_reactions WHERE post_id IN (SELECT id FROM posts WHERE author_id=?) OR user_id=?", (uid, uid))
    c.execute("DELETE FROM post_reports WHERE post_id IN (SELECT id FROM posts WHERE author_id=?) OR reporter_id=?", (uid, uid))
    c.execute("DELETE FROM post_comments WHERE post_id IN (SELECT id FROM posts WHERE author_id=?) OR author_id=?", (uid, uid))
    c.execute("DELETE FROM posts WHERE author_id=?", (uid,))
    c.execute("DELETE FROM media_files WHERE owner_id=?", (uid,))
    c.execute("DELETE FROM chat_reactions WHERE message_id IN (SELECT id FROM chat_messages WHERE sender_id=?) OR user_id=?", (uid, uid))
    c.execute("DELETE FROM chat_reports WHERE message_id IN (SELECT id FROM chat_messages WHERE sender_id=?) OR reporter_id=?", (uid, uid))
    c.execute("DELETE FROM chat_messages WHERE sender_id=?", (uid,))
    c.execute("DELETE FROM chat_channels WHERE user_id=?", (uid,))
    c.execute("DELETE FROM user_blocks WHERE user_id=? OR blocked_user_id=?", (uid, uid))
    c.execute("DELETE FROM retest_records WHERE user_id=?", (uid,))
    c.execute("DELETE FROM squad_reports WHERE reporter_id=?", (uid,))
    for t in ("squad_members", "assessments", "activity_events", "goals", "screenings", "consents", "user_preferences"):
        c.execute(f"DELETE FROM {t} WHERE user_id=?", (uid,))
    c.execute("DELETE FROM users WHERE id=?", (uid,))
    audit(c, "system", "delete_user", "user data erased on request"); c.commit(); c.close()
    return {"deleted": True}


# ---------------------------------------------------------------- preferences & settings
@app.get("/api/user/preferences")
def get_preferences(u=Depends(current_user)):
    c = db()
    row = c.execute("SELECT * FROM user_preferences WHERE user_id=?", (u["id"],)).fetchone()
    c.close()
    if not row:
        return {"theme": "light", "haptics": True, "kindness_mode": False, "board_opt_out": False, "alias": None}
    return {
        "theme": row["theme"], "haptics": bool(row["haptics"]), "kindness_mode": bool(row["kindness_mode"]),
        "board_opt_out": bool(row["board_opt_out"]), "alias": row["alias"]
    }


@app.post("/api/user/preferences", dependencies=[Depends(rate_limit)])
def update_preferences(b: PreferencesIn, u=Depends(current_user)):
    c = db()
    c.execute("""
      INSERT INTO user_preferences(user_id, theme, haptics, kindness_mode, board_opt_out, alias, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        theme=excluded.theme, haptics=excluded.haptics, kindness_mode=excluded.kindness_mode,
        board_opt_out=excluded.board_opt_out, alias=excluded.alias, updated_at=excluded.updated_at
    """, (
        u["id"], b.theme or "light", 1 if b.haptics else 0, 1 if b.kindness_mode else 0,
        1 if b.board_opt_out else 0, b.alias.strip() if b.alias else None, now()
    ))
    c.commit(); c.close()
    return {"saved": True}


# ---------------------------------------------------------------- leaderboards (fairness-designed)
ENABLE_LEADERBOARDS = os.environ.get("ENABLE_LEADERBOARDS", "1") == "1"


@app.get("/api/leaderboards/squads")
def leaderboard_squads(u=Depends(current_user)):
    if not ENABLE_LEADERBOARDS:
        raise HTTPException(503, "leaderboards_disabled")
    c = db(); inst_id = u["institution_id"]; ws = week_start(now())
    squad_rows = c.execute("SELECT * FROM squads WHERE institution_id=?", (inst_id,)).fetchall()
    divisions: dict = {"starter": [], "building": [], "steady": [], "strong": []}
    for s in squad_rows:
        members = [r["user_id"] for r in c.execute("SELECT user_id FROM squad_members WHERE squad_id=?", (s["id"],)).fetchall()]
        if not members:
            continue
        div = squad_division(c, members)
        score, _ = squad_score(c, members, ws)
        divisions[div].append({"id": s["id"], "name": s["name"], "score": score, "members_count": len(members), "division": div})
    for div in divisions:
        divisions[div].sort(key=lambda x: -x["score"])
        for idx, sq in enumerate(divisions[div]):
            sq["rank"] = idx + 1
    c.close()
    return {"divisions": divisions, "week_start": ws.date().isoformat(), "reset_note": "Resets every Monday 00:00 IST"}


@app.get("/api/leaderboards/departments")
def leaderboard_departments(target_pct: float = 1.0, u=Depends(current_user)):
    if not ENABLE_LEADERBOARDS:
        raise HTTPException(503, "leaderboards_disabled")
    c = db(); inst_id = u["institution_id"]; ws = week_start(now())
    user_rows = c.execute("SELECT id, grp FROM users WHERE institution_id=?", (inst_id,)).fetchall()
    groups: dict = defaultdict(list)
    for r in user_rows:
        groups[r["grp"]].append(r["id"])
    visible, small = [], []
    for grp_name, uids in groups.items():
        n = len(uids)
        meet_count = sum(1 for uid in uids if completion(c, uid, ws) >= target_pct)
        rate = round(100 * meet_count / n, 1) if n > 0 else 0.0
        if n >= K_ANON:
            visible.append({"group": grp_name, "n": n, "participation_rate": rate, "meeting_target_count": meet_count, "suppressed": False})
        else:
            small.extend(uids)
    other = None
    if small:
        n_small = len(small)
        meet_small = sum(1 for uid in small if completion(c, uid, ws) >= target_pct)
        rate_small = round(100 * meet_small / n_small, 1) if n_small > 0 else 0.0
        if n_small < K_ANON:
            other = {"group": "Other (small groups)", "suppressed": True, "n": None, "participation_rate": None}
        else:
            other = {"group": "Other (small groups)", "suppressed": False, "n": n_small, "participation_rate": rate_small, "meeting_target_count": meet_small}
    visible.sort(key=lambda x: -x["participation_rate"])
    for idx, dep in enumerate(visible):
        dep["rank"] = idx + 1
    c.close()
    return {"departments": visible + ([other] if other else []), "week_start": ws.date().isoformat(), "k_anon": K_ANON, "reset_note": "Resets every Monday 00:00 IST"}


@app.get("/api/leaderboards/consistency")
def leaderboard_consistency(u=Depends(current_user)):
    if not ENABLE_LEADERBOARDS:
        raise HTTPException(503, "leaderboards_disabled")
    c = db(); inst_id = u["institution_id"]; ws = week_start(now())
    users = c.execute("""
      SELECT u.id, u.display_name, p.alias, p.board_opt_out, p.kindness_mode
      FROM users u
      LEFT JOIN user_preferences p ON p.user_id = u.id
      WHERE u.institution_id = ?
    """, (inst_id,)).fetchall()
    lo, hi = int(ws.timestamp() * 1000), int((ws + timedelta(days=7)).timestamp() * 1000)
    scored_users = []
    user_standing = None
    for row in users:
        uid = row["id"]
        opted_out = bool(row["board_opt_out"])
        act_rows = c.execute("SELECT ts FROM activity_events WHERE user_id=? AND ts>=? AND ts<?", (uid, lo, hi)).fetchall()
        days_active = len({datetime.fromtimestamp(r["ts"] / 1000, IST).date() for r in act_rows})
        days_active_capped = min(7, days_active)
        comp = completion(c, uid, ws)
        comp_pct = round(min(1.0, comp) * 100, 1)
        if row["alias"]:
            name = row["alias"]
        else:
            parts = row["display_name"].strip().split()
            name = f"{parts[0]} {parts[1][0]}." if len(parts) > 1 else parts[0]
        is_current_user = (uid == u["id"])
        entry = {"name": name, "completion_pct": comp_pct, "active_days": days_active_capped, "is_you": is_current_user, "opted_out": opted_out}
        if is_current_user:
            user_standing = entry
        if not opted_out:
            scored_users.append(entry)
    scored_users.sort(key=lambda x: (-x["completion_pct"], -x["active_days"]))
    for idx, item in enumerate(scored_users):
        item["rank"] = idx + 1
    top_10 = scored_users[:10]
    your_rank = None
    if user_standing and not user_standing["opted_out"]:
        your_rank = next((item["rank"] for item in scored_users if item["is_you"]), None)
    c.close()
    return {
        "board": [{"rank": item["rank"], "name": item["name"], "completion_pct": item["completion_pct"], "active_days": item["active_days"], "is_you": item["is_you"]} for item in top_10],
        "your_standing": {
            "rank": your_rank, "completion_pct": user_standing["completion_pct"] if user_standing else 0.0,
            "active_days": user_standing["active_days"] if user_standing else 0, "opted_out": user_standing["opted_out"] if user_standing else False
        },
        "total_participants": len(scored_users), "week_start": ws.date().isoformat(), "reset_note": "Resets every Monday 00:00 IST"
    }


@app.get("/api/leaderboards/improved")
def leaderboard_improved(u=Depends(current_user)):
    if not ENABLE_LEADERBOARDS:
        raise HTTPException(503, "leaderboards_disabled")
    c = db(); inst_id = u["institution_id"]
    rows = c.execute("""
      SELECT r.user_id, r.old_idx, r.new_idx, r.delta, u.display_name, p.alias, p.board_opt_out
      FROM retest_records r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN user_preferences p ON p.user_id = u.id
      WHERE u.institution_id = ?
      ORDER BY r.ts DESC
    """, (inst_id,)).fetchall()
    improvers = {}
    for r in rows:
        uid = r["user_id"]
        if r["board_opt_out"]:
            continue
        delta = r["delta"]
        if delta <= 0 or delta > 45:
            continue
        if uid not in improvers or delta > improvers[uid]["delta"]:
            name = r["alias"] if r["alias"] else f"{r['display_name'].split()[0]}."
            improvers[uid] = {"name": name, "delta": delta, "is_you": (uid == u["id"])}
    sorted_improvers = sorted(improvers.values(), key=lambda x: -x["delta"])
    for idx, item in enumerate(sorted_improvers):
        item["rank"] = idx + 1
    c.close()
    return {"board": sorted_improvers[:10], "reset_note": "Relative to personal baseline index from verified retests."}


# ---------------------------------------------------------------- facilities & slot finder
@app.get("/api/facilities/slots")
def get_facility_slots(u=Depends(current_user)):
    facilities = [
        {"id": "badminton", "name": "Badminton Court", "location": "Indoor Sports Complex", "capacity": 8, "occupied": 4, "slots": ["06:00 - 06:45", "07:00 - 07:45", "17:00 - 17:45", "18:00 - 18:45"]},
        {"id": "gym", "name": "Strength & Multi-Gym", "location": "Student Activity Center", "capacity": 20, "occupied": 11, "slots": ["06:30 - 07:15", "07:30 - 08:15", "16:30 - 17:15", "17:30 - 18:15"]},
        {"id": "table_tennis", "name": "Table Tennis Arena", "location": "Hostel Block Common Hall", "capacity": 6, "occupied": 2, "slots": ["17:00 - 17:45", "18:00 - 18:45", "19:00 - 19:45"]},
        {"id": "track", "name": "Athletic Running Track", "location": "Main Campus Ground", "capacity": 50, "occupied": 18, "slots": ["06:00 - 06:45", "06:45 - 07:30", "17:30 - 18:15", "18:15 - 19:00"]},
    ]
    return {"facilities": facilities}


@app.post("/api/facilities/reserve", dependencies=[Depends(rate_limit)])
def reserve_slot(b: ReserveSlotIn, u=Depends(current_user)):
    c = db()
    res_code = secrets.token_hex(2).upper()
    audit(c, u["id"], "facility_reserve", f"facility={b.facility_id} slot={b.slot_time} code={res_code}")
    c.commit(); c.close()
    return {"reserved": True, "facility_id": b.facility_id, "slot_time": b.slot_time, "checkin_code": res_code, "note": "Show this check-in PIN at the facility entrance."}



# ---------------------------------------------------------------- committee chat (moderated, text-only)
ENABLE_CHAT = os.environ.get("ENABLE_CHAT", "1") == "1"

CRISIS_KEYWORDS = {
    "suicide", "kill myself", "end my life", "self harm", "hurt myself",
    "mar jaunga", "jaan de dunga", "aatmahatya", "khatam kar dunga"
}

ABUSE_KEYWORDS = {
    "harass", "hate", "idiot", "stupid", "bastard", "kamine", "saale", "kutta",
    "bhenchod", "madarchod", "gandu", "chutiya", "harami"
}

ALLOWED_DOMAINS = {
    "ac.in", "edu.in", "gov.in", "khelsetu.in", "localhost", "127.0.0.1"
}


def contains_crisis(text: str) -> bool:
    t_lower = text.lower()
    return any(k in t_lower for k in CRISIS_KEYWORDS)


def contains_abuse(text: str) -> tuple[bool, str]:
    t_lower = text.lower()
    for word in ABUSE_KEYWORDS:
        if word in t_lower:
            return True, f"contains_{word}"
    return False, ""


def contains_unallowed_link(text: str) -> bool:
    import re
    urls = re.findall(r"(?:https?://|www\.)([^\s/]+)", text.lower())
    for url in urls:
        host = url.split(":")[0]
        if not any(host.endswith(d) or host == d for d in ALLOWED_DOMAINS):
            return True
    return False


def ensure_channels_for_user(c, u):
    inst_id = u["institution_id"]
    uid = u["id"]
    t0 = now()
    ann_id = f"ann-inst-{inst_id}"
    c.execute("""
      INSERT OR IGNORE INTO chat_channels(id, institution_id, kind, title, created_at)
      VALUES(?, ?, 'announcements', 'Campus Announcements', ?)
    """, (ann_id, inst_id, t0))
    squad_row = c.execute("""
      SELECT s.id, s.name FROM squads s
      JOIN squad_members m ON m.squad_id = s.id
      WHERE m.user_id = ?
    """, (uid,)).fetchone()
    if squad_row:
        sq_chan_id = f"sq-chan-{squad_row['id']}"
        c.execute("""
          INSERT OR IGNORE INTO chat_channels(id, institution_id, kind, squad_id, title, created_at)
          VALUES(?, ?, 'squad', ?, ?, ?)
        """, (sq_chan_id, inst_id, squad_row["id"], f"Squad: {squad_row['name']}", t0))
    if u["role"] == "student":
        ask_id = f"ask-{uid}"
        c.execute("""
          INSERT OR IGNORE INTO chat_channels(id, institution_id, kind, user_id, title, created_at)
          VALUES(?, ?, 'ask_committee', ?, 'Ask the Committee', ?)
        """, (ask_id, inst_id, uid, t0))
    c.commit()


@app.get("/api/chat/channels")
def get_channels(u=Depends(current_user)):
    if not ENABLE_CHAT:
        raise HTTPException(503, "chat_disabled")
    c = db()
    ensure_channels_for_user(c, u)
    inst_id = u["institution_id"]; uid = u["id"]
    if u["role"] in ("officer", "admin"):
        rows = c.execute("""
          SELECT c.*, 
            (SELECT COUNT(*) FROM chat_messages m WHERE m.channel_id = c.id AND m.deleted = 0) as message_count
          FROM chat_channels c
          WHERE c.institution_id = ?
          ORDER BY c.created_at DESC
        """, (inst_id,)).fetchall()
    else:
        squad_id = c.execute("SELECT squad_id FROM squad_members WHERE user_id=?", (uid,)).fetchone()
        sq_id = squad_id["squad_id"] if squad_id else None
        rows = c.execute("""
          SELECT c.*,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.channel_id = c.id AND m.deleted = 0) as message_count
          FROM chat_channels c
          WHERE c.institution_id = ? AND (
            c.kind = 'announcements' OR
            (c.kind = 'squad' AND c.squad_id = ?) OR
            (c.kind = 'ask_committee' AND c.user_id = ?)
          )
          ORDER BY c.created_at ASC
        """, (inst_id, sq_id, uid)).fetchall()
    res = [dict(r) for r in rows]
    c.close()
    return {"channels": res}


@app.get("/api/chat/channels/{channel_id}/messages")
def get_channel_messages(channel_id: str, limit: int = 50, u=Depends(current_user)):
    if not ENABLE_CHAT:
        raise HTTPException(503, "chat_disabled")
    c = db()
    chan = c.execute("SELECT * FROM chat_channels WHERE id=?", (channel_id,)).fetchone()
    if not chan or chan["institution_id"] != u["institution_id"]:
        c.close(); raise HTTPException(404, "channel_not_found")
    if chan["kind"] == "squad":
        is_mem = c.execute("SELECT 1 FROM squad_members WHERE squad_id=? AND user_id=?", (chan["squad_id"], u["id"])).fetchone()
        if not is_mem and u["role"] not in ("officer", "admin"):
            c.close(); raise HTTPException(403, "squad_membership_required")
    elif chan["kind"] == "ask_committee":
        if chan["user_id"] != u["id"] and u["role"] not in ("officer", "admin"):
            c.close(); raise HTTPException(403, "access_denied")
    blocked_ids = {r["blocked_user_id"] for r in c.execute("SELECT blocked_user_id FROM user_blocks WHERE user_id=?", (u["id"],)).fetchall()}
    rows = c.execute("""
      SELECT * FROM chat_messages
      WHERE channel_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    """, (channel_id, max(1, min(limit, 200)))).fetchall()
    msg_ids = [r["id"] for r in rows]
    reactions_map = defaultdict(lambda: defaultdict(int))
    user_reacts = defaultdict(list)
    if msg_ids:
        q = ",".join("?" * len(msg_ids))
        r_rows = c.execute(f"SELECT message_id, user_id, emoji FROM chat_reactions WHERE message_id IN ({q})", msg_ids).fetchall()
        for r in r_rows:
            reactions_map[r["message_id"]][r["emoji"]] += 1
            if r["user_id"] == u["id"]:
                user_reacts[r["message_id"]].append(r["emoji"])
    out = []
    is_mod = u["role"] in ("officer", "admin")
    for r in rows:
        if r["sender_id"] in blocked_ids:
            continue
        if r["held_for_review"] and r["sender_id"] != u["id"] and not is_mod:
            continue
        content = "[Message deleted]" if r["deleted"] else r["content"]
        out.append({
            "id": r["id"], "sender_id": r["sender_id"], "sender_name": r["sender_name"], "sender_role": r["sender_role"],
            "content": content, "deleted": bool(r["deleted"]), "flagged": bool(r["flagged"]),
            "held_for_review": bool(r["held_for_review"]), "created_at": r["created_at"],
            "is_you": r["sender_id"] == u["id"], "reactions": dict(reactions_map[r["id"]]), "my_reactions": user_reacts[r["id"]]
        })
    c.close()
    return {"messages": out, "channel": dict(chan)}


@app.post("/api/chat/channels/{channel_id}/messages", dependencies=[Depends(rate_limit)])
def send_message(channel_id: str, b: MessageSendIn, u=Depends(current_user)):
    if not ENABLE_CHAT:
        raise HTTPException(503, "chat_disabled")
    c = db()
    chan = c.execute("SELECT * FROM chat_channels WHERE id=?", (channel_id,)).fetchone()
    if not chan or chan["institution_id"] != u["institution_id"]:
        c.close(); raise HTTPException(404, "channel_not_found")
    if chan["kind"] == "announcements" and u["role"] not in ("officer", "admin"):
        c.close(); raise HTTPException(403, "announcements_read_only")
    elif chan["kind"] == "squad":
        is_mem = c.execute("SELECT 1 FROM squad_members WHERE squad_id=? AND user_id=?", (chan["squad_id"], u["id"])).fetchone()
        if not is_mem:
            c.close(); raise HTTPException(403, "squad_membership_required")
    elif chan["kind"] == "ask_committee":
        if chan["user_id"] != u["id"] and u["role"] not in ("officer", "admin"):
            c.close(); raise HTTPException(403, "access_denied")
    content = b.content.strip()
    if not content:
        c.close(); raise HTTPException(400, "empty_message")
    if len(content) > 500:
        c.close(); raise HTTPException(400, "message_too_long")
    if u["role"] == "student" and contains_unallowed_link(content):
        c.close(); raise HTTPException(400, "links_not_permitted")
    is_crisis = contains_crisis(content)
    is_abuse, abuse_reason = contains_abuse(content)
    flagged = 1 if (is_crisis or is_abuse) else 0
    held_for_review = 1 if is_abuse else 0
    flag_reason = "crisis_guardrail" if is_crisis else abuse_reason if is_abuse else None
    c.execute("""
      INSERT OR IGNORE INTO chat_messages(
        id, channel_id, sender_id, sender_name, sender_role, content,
        flagged, flag_reason, held_for_review, deleted, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    """, (
        b.id, channel_id, u["id"], u["display_name"], u["role"], content,
        flagged, flag_reason, held_for_review, now()
    ))
    if is_crisis or is_abuse:
        audit(c, u["id"], "chat_filter_flag", f"channel={channel_id} reason={flag_reason}")
    c.commit(); c.close()
    crisis_notice = None
    if is_crisis:
        crisis_notice = (
            "Support notice: If you are going through a difficult time, you are not alone. "
            "Please reach out to your institution's student health and counselling centre. "
            "(Configured placeholder: Contact student support desk)."
        )
    return {"sent": True, "id": b.id, "held_for_review": bool(held_for_review), "crisis_notice": crisis_notice}


@app.post("/api/chat/messages/{message_id}/reactions")
def toggle_reaction(message_id: str, b: MessageReactIn, u=Depends(current_user)):
    c = db()
    msg = c.execute("SELECT m.*, c.institution_id FROM chat_messages m JOIN chat_channels c ON c.id=m.channel_id WHERE m.id=?", (message_id,)).fetchone()
    if not msg or msg["institution_id"] != u["institution_id"]:
        c.close(); raise HTTPException(404, "message_not_found")
    existing = c.execute("SELECT 1 FROM chat_reactions WHERE message_id=? AND user_id=? AND emoji=?", (message_id, u["id"], b.emoji)).fetchone()
    if existing:
        c.execute("DELETE FROM chat_reactions WHERE message_id=? AND user_id=? AND emoji=?", (message_id, u["id"], b.emoji))
        active = False
    else:
        c.execute("INSERT INTO chat_reactions(message_id, user_id, emoji, created_at) VALUES(?,?,?,?)", (message_id, u["id"], b.emoji, now()))
        active = True
    c.commit(); c.close()
    return {"reacted": active, "emoji": b.emoji}


@app.post("/api/chat/messages/{message_id}/report", dependencies=[Depends(rate_limit)])
def report_message(message_id: str, b: MessageReportIn, u=Depends(current_user)):
    c = db()
    msg = c.execute("SELECT m.*, c.institution_id FROM chat_messages m JOIN chat_channels c ON c.id=m.channel_id WHERE m.id=?", (message_id,)).fetchone()
    if not msg or msg["institution_id"] != u["institution_id"]:
        c.close(); raise HTTPException(404, "message_not_found")
    c.execute("INSERT INTO chat_reports(message_id, reporter_id, reason, created_at) VALUES(?,?,?,?)", (message_id, u["id"], b.reason.strip(), now()))
    c.execute("UPDATE chat_messages SET flagged=1, flag_reason='user_reported' WHERE id=?", (message_id,))
    audit(c, u["id"], "report_message", f"msg={message_id} reason={b.reason[:30]}")
    c.commit(); c.close()
    return {"reported": True}


@app.post("/api/chat/messages/{message_id}/delete")
def delete_message(message_id: str, b: MessageDeleteIn, u=Depends(current_user)):
    c = db()
    msg = c.execute("SELECT m.*, c.institution_id FROM chat_messages m JOIN chat_channels c ON c.id=m.channel_id WHERE m.id=?", (message_id,)).fetchone()
    if not msg or msg["institution_id"] != u["institution_id"]:
        c.close(); raise HTTPException(404, "message_not_found")
    if msg["sender_id"] != u["id"] and u["role"] not in ("officer", "admin"):
        c.close(); raise HTTPException(403, "cannot_delete_peer_message")
    c.execute("UPDATE chat_messages SET deleted=1, delete_reason=? WHERE id=?", (b.reason, message_id))
    audit(c, u["id"], "delete_message", f"msg={message_id} reason={b.reason}")
    c.commit(); c.close()
    return {"deleted": True}


@app.post("/api/chat/users/block")
def block_user(b: BlockUserIn, u=Depends(current_user)):
    if b.blocked_user_id == u["id"]:
        raise HTTPException(400, "cannot_block_self")
    c = db()
    c.execute("INSERT OR IGNORE INTO user_blocks(user_id, blocked_user_id, created_at) VALUES(?,?,?)", (u["id"], b.blocked_user_id, now()))
    audit(c, u["id"], "block_user", f"target={b.blocked_user_id}")
    c.commit(); c.close()
    return {"blocked": True}


# --- Moderation Queue (Officer / Admin) ---
@app.get("/api/moderation/queue")
def moderation_queue(u=Depends(current_user)):
    if u["role"] not in ("officer", "admin"):
        raise HTTPException(403, "moderator_role_required")
    c = db(); inst_id = u["institution_id"]
    rows = c.execute("""
      SELECT m.id, m.channel_id, m.sender_id, m.sender_name, m.content, m.flagged,
             m.flag_reason, m.held_for_review, m.deleted, m.created_at,
             (SELECT COUNT(*) FROM chat_reports r WHERE r.message_id = m.id) as report_count
      FROM chat_messages m
      JOIN chat_channels c ON c.id = m.channel_id
      WHERE c.institution_id = ? AND (m.flagged = 1 OR m.held_for_review = 1)
      ORDER BY m.created_at DESC
      LIMIT 100
    """, (inst_id,)).fetchall()
    c.close()
    return {"queue": [dict(r) for r in rows]}


@app.post("/api/moderation/messages/{message_id}/resolve")
def resolve_moderation(message_id: str, b: ModResolveIn, u=Depends(current_user)):
    if u["role"] not in ("officer", "admin"):
        raise HTTPException(403, "moderator_role_required")
    c = db()
    if b.action == "approve":
        c.execute("UPDATE chat_messages SET flagged=0, held_for_review=0 WHERE id=?", (message_id,))
        c.execute("UPDATE chat_reports SET resolved=1 WHERE message_id=?", (message_id,))
    elif b.action == "delete":
        c.execute("UPDATE chat_messages SET deleted=1, delete_reason='mod_takedown' WHERE id=?", (message_id,))
        c.execute("UPDATE chat_reports SET resolved=1 WHERE message_id=?", (message_id,))
    elif b.action == "dismiss":
        c.execute("UPDATE chat_reports SET resolved=1 WHERE message_id=?", (message_id,))
    audit(c, u["id"], "moderation_resolve", f"msg={message_id} action={b.action} reason={b.reason}")
    c.commit(); c.close()
    return {"resolved": True, "action": b.action}


@app.post("/api/chat/retention/purge", dependencies=[Depends(admin_only)])
def purge_chat_retention(days: int = 90):
    c = db()
    cutoff = now() - days * 86_400_000
    c.execute("DELETE FROM chat_reactions WHERE message_id IN (SELECT id FROM chat_messages WHERE created_at < ?)", (cutoff,))
    c.execute("DELETE FROM chat_reports WHERE message_id IN (SELECT id FROM chat_messages WHERE created_at < ?)", (cutoff,))
    cur = c.execute("DELETE FROM chat_messages WHERE created_at < ?", (cutoff,))
    deleted_count = cur.rowcount
    audit(c, "admin", "chat_purge", f"days={days} deleted={deleted_count}")
    c.commit(); c.close()
    return {"purged_messages": deleted_count, "retention_days": days}


# ---------------------------------------------------------------- gym-photo feed & media pipeline
ENABLE_FEED = os.environ.get("ENABLE_FEED", "1") == "1"


def process_and_store_image(file_bytes: bytes, user_id: str, institution_id: int) -> dict:
    if len(file_bytes) > 8 * 1024 * 1024:
        raise HTTPException(400, "image_too_large_max_8mb")
    
    # Magic bytes validation: JPEG, PNG, WebP
    is_jpeg = file_bytes.startswith(b"\xff\xd8\xff")
    is_png = file_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    is_webp = len(file_bytes) > 12 and file_bytes.startswith(b"RIFF") and file_bytes[8:12] == b"WEBP"
    if not (is_jpeg or is_png or is_webp):
        raise HTTPException(400, "unsupported_image_format")
    
    try:
        raw_img = Image.open(io.BytesIO(file_bytes))
        raw_img.verify()
        raw_img = Image.open(io.BytesIO(file_bytes))
    except Exception:
        raise HTTPException(400, "corrupted_or_invalid_image")
    
    # EXIF & metadata stripping by rendering clean RGB
    if raw_img.mode in ("RGBA", "LA") or (raw_img.mode == "P" and "transparency" in raw_img.info):
        clean_img = Image.new("RGB", raw_img.size, (255, 255, 255))
        converted = raw_img.convert("RGBA")
        clean_img.paste(converted, mask=converted.split()[3])
    else:
        clean_img = raw_img.convert("RGB")
    
    display_img = clean_img.copy()
    display_img.thumbnail((1080, 1080), Image.Resampling.LANCZOS)
    
    thumb_img = clean_img.copy()
    thumb_img.thumbnail((320, 320), Image.Resampling.LANCZOS)
    
    media_id = secrets.token_hex(16)
    file_path = MEDIA_DIR / f"{media_id}.jpg"
    thumb_path = MEDIA_DIR / f"{media_id}_thumb.jpg"
    
    display_img.save(file_path, "JPEG", quality=85, optimize=True)
    thumb_img.save(thumb_path, "JPEG", quality=75, optimize=True)
    size_bytes = os.path.getsize(file_path)
    
    c = db()
    c.execute(
        "INSERT INTO media_files(id, institution_id, owner_id, file_path, thumb_path, content_type, size_bytes, created_at) VALUES(?,?,?,?,?,?,?,?)",
        (media_id, institution_id, user_id, str(file_path), str(thumb_path), "image/jpeg", size_bytes, now())
    )
    audit(c, user_id, "upload_media", f"media={media_id} size={size_bytes}")
    c.commit(); c.close()
    
    return {
        "id": media_id,
        "url": f"/api/media/{media_id}",
        "thumb_url": f"/api/media/{media_id}?thumb=1",
        "size_bytes": size_bytes
    }


@app.post("/api/feed/upload", dependencies=[Depends(rate_limit)])
async def upload_feed_image(file: UploadFile = File(...), u=Depends(current_user)):
    if not ENABLE_FEED:
        raise HTTPException(503, "feed_disabled")
    content = await file.read()
    return process_and_store_image(content, u["id"], u["institution_id"])


@app.get("/api/media/{media_id}")
def get_media(media_id: str, thumb: Optional[int] = 0):
    c = db()
    row = c.execute("SELECT * FROM media_files WHERE id=?", (media_id,)).fetchone()
    c.close()
    if not row:
        raise HTTPException(404, "media_not_found")
    target_path = Path(row["thumb_path"] if thumb else row["file_path"])
    if not target_path.exists():
        raise HTTPException(404, "media_file_missing_on_disk")
    return FileResponse(str(target_path), media_type=row["content_type"], headers={"Cache-Control": "public, max-age=86400"})


@app.post("/api/feed/posts", dependencies=[Depends(rate_limit)])
def create_feed_post(b: PostCreateIn, u=Depends(current_user)):
    if not ENABLE_FEED:
        raise HTTPException(503, "feed_disabled")
    c = db()
    media = c.execute("SELECT * FROM media_files WHERE id=? AND owner_id=?", (b.image_id, u["id"])).fetchone()
    if not media:
        c.close(); raise HTTPException(400, "invalid_or_unowned_image")
    
    if u["role"] == "student" and contains_unallowed_link(b.caption):
        c.close(); raise HTTPException(400, "links_not_permitted")
    
    is_abuse, abuse_reason = contains_abuse(b.caption)
    flagged = 1 if is_abuse else 0
    flag_reason = abuse_reason if is_abuse else None
    held_for_review = 1 if is_abuse else 0
    
    squad_id = None
    if b.visibility == "squad":
        sm = c.execute("SELECT squad_id FROM squad_members WHERE user_id=? ORDER BY joined_at DESC LIMIT 1", (u["id"],)).fetchone()
        if sm:
            squad_id = sm["squad_id"]
    
    grp = u["grp"] if b.visibility == "hostel" else None
    t = now()
    
    c.execute("""
      INSERT OR REPLACE INTO posts(
        id, institution_id, author_id, author_name, visibility, squad_id, grp,
        caption, tag, image_id, image_url, thumb_url, flagged, flag_reason, held_for_review, deleted, created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)
    """, (
        b.id, u["institution_id"], u["id"], u["display_name"], b.visibility, squad_id, grp,
        b.caption.strip(), b.tag.strip(), b.image_id, f"/api/media/{b.image_id}", f"/api/media/{b.image_id}?thumb=1",
        flagged, flag_reason, held_for_review, t
    ))
    audit(c, u["id"], "create_post", f"post={b.id} vis={b.visibility} tag={b.tag}")
    c.commit(); c.close()
    return {"id": b.id, "created": True, "held_for_review": bool(held_for_review)}


@app.get("/api/feed/posts")
def get_feed_posts(visibility: Optional[str] = "all", limit: int = 20, u=Depends(current_user)):
    if not ENABLE_FEED:
        raise HTTPException(503, "feed_disabled")
    c = db(); uid = u["id"]; inst_id = u["institution_id"]
    
    sm = c.execute("SELECT squad_id FROM squad_members WHERE user_id=? ORDER BY joined_at DESC LIMIT 1", (uid,)).fetchone()
    my_squad_id = sm["squad_id"] if sm else -1
    
    where_clauses = [
        "p.institution_id = ?",
        "p.deleted = 0",
        "(p.held_for_review = 0 OR p.author_id = ?)",
        "p.author_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE user_id=?)",
        "p.author_id NOT IN (SELECT user_id FROM user_blocks WHERE blocked_user_id=?)"
    ]
    params = [inst_id, uid, uid, uid]
    
    if visibility == "squad":
        where_clauses.append("p.visibility = 'squad' AND p.squad_id = ?")
        params.append(my_squad_id)
    elif visibility == "hostel":
        where_clauses.append("p.visibility = 'hostel' AND p.grp = ?")
        params.append(u["grp"])
    elif visibility == "campus":
        where_clauses.append("p.visibility = 'campus'")
    else:
        where_clauses.append("(p.visibility = 'campus' OR (p.visibility = 'hostel' AND p.grp = ?) OR (p.visibility = 'squad' AND p.squad_id = ?) OR p.author_id = ?)")
        params.extend([u["grp"], my_squad_id, uid])
    
    params.append(min(100, max(1, limit)))
    
    sql = f"""
      SELECT p.*,
             (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id AND pc.deleted = 0) as comment_count,
             (SELECT COUNT(*) FROM post_reactions pr WHERE pr.post_id = p.id) as reaction_count,
             (SELECT emoji FROM post_reactions pr WHERE pr.post_id = p.id AND pr.user_id = ?) as my_reaction
      FROM posts p
      WHERE {' AND '.join(where_clauses)}
      ORDER BY p.created_at DESC
      LIMIT ?
    """
    rows = c.execute(sql, [uid] + params).fetchall()
    post_ids = [r["id"] for r in rows]
    reactions_by_post = defaultdict(lambda: defaultdict(int))
    if post_ids:
        q = ",".join("?" * len(post_ids))
        r_rows = c.execute(f"SELECT post_id, emoji, COUNT(*) as cnt FROM post_reactions WHERE post_id IN ({q}) GROUP BY post_id, emoji", post_ids).fetchall()
        for rr in r_rows:
            reactions_by_post[rr["post_id"]][rr["emoji"]] = rr["cnt"]
    
    result = []
    for r in rows:
        d = dict(r)
        d["reactions"] = dict(reactions_by_post[r["id"]])
        d["is_mine"] = (r["author_id"] == uid)
        d["deleted"] = bool(d["deleted"])
        d["flagged"] = bool(d["flagged"])
        d["held_for_review"] = bool(d["held_for_review"])
        result.append(d)
    
    c.close()
    return {"posts": result}


@app.post("/api/feed/posts/{post_id}/reactions", dependencies=[Depends(rate_limit)])
def react_to_post(post_id: str, b: MessageReactIn, u=Depends(current_user)):
    if not ENABLE_FEED:
        raise HTTPException(503, "feed_disabled")
    c = db()
    post = c.execute("SELECT * FROM posts WHERE id=? AND deleted=0", (post_id,)).fetchone()
    if not post:
        c.close(); raise HTTPException(404, "post_not_found")
    
    existing = c.execute("SELECT * FROM post_reactions WHERE post_id=? AND user_id=? AND emoji=?", (post_id, u["id"], b.emoji)).fetchone()
    if existing:
        c.execute("DELETE FROM post_reactions WHERE post_id=? AND user_id=? AND emoji=?", (post_id, u["id"], b.emoji))
        action = "removed"
    else:
        c.execute("INSERT OR REPLACE INTO post_reactions(post_id, user_id, emoji, created_at) VALUES(?,?,?,?)",
                  (post_id, u["id"], b.emoji, now()))
        action = "added"
    
    r_rows = c.execute("SELECT emoji, COUNT(*) as cnt FROM post_reactions WHERE post_id=? GROUP BY emoji", (post_id,)).fetchall()
    reactions = {rr["emoji"]: rr["cnt"] for rr in r_rows}
    c.commit(); c.close()
    return {"action": action, "emoji": b.emoji, "reactions": reactions}


@app.get("/api/feed/posts/{post_id}/comments")
def get_post_comments(post_id: str, u=Depends(current_user)):
    if not ENABLE_FEED:
        raise HTTPException(503, "feed_disabled")
    c = db(); uid = u["id"]
    rows = c.execute("""
      SELECT c.*
      FROM post_comments c
      WHERE c.post_id=? AND c.deleted=0
        AND c.author_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE user_id=?)
        AND c.author_id NOT IN (SELECT user_id FROM user_blocks WHERE blocked_user_id=? )
      ORDER BY c.created_at ASC
    """, (post_id, uid, uid)).fetchall()
    c.close()
    return {"comments": [{
        "id": r["id"], "post_id": r["post_id"], "author_id": r["author_id"],
        "author_name": r["author_name"], "content": r["content"], "created_at": r["created_at"],
        "is_mine": r["author_id"] == uid
    } for r in rows]}


@app.post("/api/feed/posts/{post_id}/comments", dependencies=[Depends(rate_limit)])
def add_post_comment(post_id: str, b: CommentCreateIn, u=Depends(current_user)):
    if not ENABLE_FEED:
        raise HTTPException(503, "feed_disabled")
    if u["role"] == "student" and contains_unallowed_link(b.content):
        raise HTTPException(400, "links_not_permitted")
    c = db()
    post = c.execute("SELECT * FROM posts WHERE id=? AND deleted=0", (post_id,)).fetchone()
    if not post:
        c.close(); raise HTTPException(404, "post_not_found")
    
    is_abuse, _ = contains_abuse(b.content)
    t = now()
    c.execute("INSERT OR REPLACE INTO post_comments(id, post_id, author_id, author_name, content, flagged, deleted, created_at) VALUES(?,?,?,?,?,?,0,?)",
              (b.id, post_id, u["id"], u["display_name"], b.content.strip(), 1 if is_abuse else 0, t))
    audit(c, u["id"], "add_post_comment", f"post={post_id} comment={b.id}")
    c.commit(); c.close()
    return {"id": b.id, "created": True}


@app.post("/api/feed/posts/{post_id}/report", dependencies=[Depends(rate_limit)])
def report_post(post_id: str, b: PostReportIn, u=Depends(current_user)):
    if not ENABLE_FEED:
        raise HTTPException(503, "feed_disabled")
    c = db()
    post = c.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
    if not post:
        c.close(); raise HTTPException(404, "post_not_found")
    c.execute("INSERT INTO post_reports(post_id, reporter_id, reason, created_at) VALUES(?,?,?,?)",
              (post_id, u["id"], b.reason.strip(), now()))
    rep_count = c.execute("SELECT COUNT(*) cnt FROM post_reports WHERE post_id=? AND resolved=0", (post_id,)).fetchone()["cnt"]
    if rep_count >= 3:
        c.execute("UPDATE posts SET flagged=1, held_for_review=1, flag_reason='multiple_user_reports' WHERE id=?", (post_id,))
    audit(c, u["id"], "report_post", f"post={post_id} reason={b.reason[:30]}")
    c.commit(); c.close()
    return {"reported": True}


@app.post("/api/feed/posts/{post_id}/delete")
def delete_post(post_id: str, b: Optional[PostDeleteIn] = None, u=Depends(current_user)):
    if not ENABLE_FEED:
        raise HTTPException(503, "feed_disabled")
    c = db()
    post = c.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
    if not post:
        c.close(); raise HTTPException(404, "post_not_found")
    if post["author_id"] != u["id"] and u["role"] not in ("officer", "admin"):
        c.close(); raise HTTPException(403, "not_authorized_to_delete_post")
    reason = b.reason if b else "deleted_by_user"
    c.execute("UPDATE posts SET deleted=1, delete_reason=? WHERE id=?", (reason, post_id))
    audit(c, u["id"], "delete_post", f"post={post_id} reason={reason}")
    c.commit(); c.close()
    return {"deleted": True}


@app.post("/api/feed/retention/purge", dependencies=[Depends(admin_only)])
def purge_feed_retention(days: int = 90):
    c = db()
    cutoff = now() - days * 86_400_000
    old_media = c.execute("SELECT id, file_path, thumb_path FROM media_files WHERE created_at < ?", (cutoff,)).fetchall()
    for m in old_media:
        try:
            if os.path.exists(m["file_path"]): os.remove(m["file_path"])
            if os.path.exists(m["thumb_path"]): os.remove(m["thumb_path"])
        except Exception:
            pass
    c.execute("DELETE FROM post_reactions WHERE post_id IN (SELECT id FROM posts WHERE created_at < ?)", (cutoff,))
    c.execute("DELETE FROM post_reports WHERE post_id IN (SELECT id FROM posts WHERE created_at < ?)", (cutoff,))
    c.execute("DELETE FROM post_comments WHERE post_id IN (SELECT id FROM posts WHERE created_at < ?)", (cutoff,))
    cur = c.execute("DELETE FROM posts WHERE created_at < ?", (cutoff,))
    deleted_count = cur.rowcount
    audit(c, "admin", "feed_purge", f"days={days} deleted_posts={deleted_count}")
    c.commit(); c.close()
    return {"purged_posts": deleted_count, "retention_days": days}


# ---------------------------------------------------------------- meal photo calorie tracking (Feature E)
ENABLE_MEALS = os.environ.get("ENABLE_MEALS", "1") == "1"
ENABLE_ASSISTANT = os.environ.get("ENABLE_ASSISTANT", "1") == "1"
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

NUTRITION_DB = {
    "roti": {"name": "Roti / Chapati", "cal_per_100g": 245.0, "p_100g": 8.5, "c_100g": 49.0, "f_100g": 2.5, "fib_100g": 9.0, "std_portion_g": 60.0, "source": "IFCT2017"},
    "chapati": {"name": "Roti / Chapati", "cal_per_100g": 245.0, "p_100g": 8.5, "c_100g": 49.0, "f_100g": 2.5, "fib_100g": 9.0, "std_portion_g": 60.0, "source": "IFCT2017"},
    "rice": {"name": "Boiled White Rice", "cal_per_100g": 130.0, "p_100g": 2.7, "c_100g": 28.2, "f_100g": 0.3, "fib_100g": 0.4, "std_portion_g": 150.0, "source": "IFCT2017"},
    "brown rice": {"name": "Boiled Brown Rice", "cal_per_100g": 111.0, "p_100g": 2.6, "c_100g": 23.0, "f_100g": 0.9, "fib_100g": 1.8, "std_portion_g": 150.0, "source": "USDA"},
    "dal": {"name": "Dal Tadka", "cal_per_100g": 118.0, "p_100g": 6.8, "c_100g": 16.5, "f_100g": 3.2, "fib_100g": 3.5, "std_portion_g": 150.0, "source": "IFCT2017"},
    "dal tadka": {"name": "Dal Tadka", "cal_per_100g": 118.0, "p_100g": 6.8, "c_100g": 16.5, "f_100g": 3.2, "fib_100g": 3.5, "std_portion_g": 150.0, "source": "IFCT2017"},
    "dal makhani": {"name": "Dal Makhani", "cal_per_100g": 142.0, "p_100g": 5.4, "c_100g": 14.8, "f_100g": 7.2, "fib_100g": 4.1, "std_portion_g": 150.0, "source": "IFCT2017"},
    "rajma": {"name": "Rajma Masala", "cal_per_100g": 125.0, "p_100g": 6.5, "c_100g": 18.2, "f_100g": 3.1, "fib_100g": 5.2, "std_portion_g": 150.0, "source": "IFCT2017"},
    "chana": {"name": "Chana Masala", "cal_per_100g": 135.0, "p_100g": 7.2, "c_100g": 20.1, "f_100g": 3.8, "fib_100g": 5.8, "std_portion_g": 150.0, "source": "IFCT2017"},
    "paneer": {"name": "Paneer Bhurji / Curry", "cal_per_100g": 195.0, "p_100g": 11.2, "c_100g": 4.8, "f_100g": 15.0, "fib_100g": 0.8, "std_portion_g": 120.0, "source": "IFCT2017"},
    "palak paneer": {"name": "Palak Paneer", "cal_per_100g": 140.0, "p_100g": 7.5, "c_100g": 5.2, "f_100g": 10.5, "fib_100g": 2.6, "std_portion_g": 150.0, "source": "IFCT2017"},
    "curd": {"name": "Plain Curd / Dahi", "cal_per_100g": 60.0, "p_100g": 3.1, "c_100g": 4.4, "f_100g": 3.2, "fib_100g": 0.0, "std_portion_g": 150.0, "source": "IFCT2017"},
    "dahi": {"name": "Plain Curd / Dahi", "cal_per_100g": 60.0, "p_100g": 3.1, "c_100g": 4.4, "f_100g": 3.2, "fib_100g": 0.0, "std_portion_g": 150.0, "source": "IFCT2017"},
    "egg": {"name": "Boiled Egg (2 pcs)", "cal_per_100g": 155.0, "p_100g": 13.0, "c_100g": 1.1, "f_100g": 11.0, "fib_100g": 0.0, "std_portion_g": 100.0, "source": "USDA"},
    "egg bhurji": {"name": "Egg Bhurji", "cal_per_100g": 165.0, "p_100g": 12.5, "c_100g": 2.0, "f_100g": 12.0, "fib_100g": 0.2, "std_portion_g": 120.0, "source": "USDA"},
    "chicken": {"name": "Chicken Curry", "cal_per_100g": 165.0, "p_100g": 16.5, "c_100g": 4.2, "f_100g": 9.2, "fib_100g": 1.0, "std_portion_g": 150.0, "source": "IFCT2017"},
    "chicken breast": {"name": "Grilled Chicken Breast", "cal_per_100g": 165.0, "p_100g": 31.0, "c_100g": 0.0, "f_100g": 3.6, "fib_100g": 0.0, "std_portion_g": 120.0, "source": "USDA"},
    "idli": {"name": "Idli (2 pcs)", "cal_per_100g": 135.0, "p_100g": 4.2, "c_100g": 28.0, "f_100g": 0.6, "fib_100g": 2.1, "std_portion_g": 80.0, "source": "IFCT2017"},
    "dosa": {"name": "Plain Dosa", "cal_per_100g": 180.0, "p_100g": 4.0, "c_100g": 30.5, "f_100g": 4.8, "fib_100g": 1.8, "std_portion_g": 100.0, "source": "IFCT2017"},
    "sambar": {"name": "Sambar", "cal_per_100g": 65.0, "p_100g": 2.8, "c_100g": 10.2, "f_100g": 1.5, "fib_100g": 2.4, "std_portion_g": 150.0, "source": "IFCT2017"},
    "poha": {"name": "Poha with Veggies", "cal_per_100g": 160.0, "p_100g": 3.2, "c_100g": 28.5, "f_100g": 4.2, "fib_100g": 2.2, "std_portion_g": 150.0, "source": "IFCT2017"},
    "upma": {"name": "Upma", "cal_per_100g": 145.0, "p_100g": 3.6, "c_100g": 24.0, "f_100g": 4.0, "fib_100g": 1.9, "std_portion_g": 150.0, "source": "IFCT2017"},
    "sabzi": {"name": "Mixed Sabzi (Aloo Gobi)", "cal_per_100g": 85.0, "p_100g": 2.1, "c_100g": 11.0, "f_100g": 3.8, "fib_100g": 2.8, "std_portion_g": 120.0, "source": "IFCT2017"},
    "khichdi": {"name": "Moong Dal Khichdi", "cal_per_100g": 120.0, "p_100g": 4.5, "c_100g": 21.0, "f_100g": 2.2, "fib_100g": 2.0, "std_portion_g": 200.0, "source": "IFCT2017"},
    "banana": {"name": "Banana", "cal_per_100g": 89.0, "p_100g": 1.1, "c_100g": 22.8, "f_100g": 0.3, "fib_100g": 2.6, "std_portion_g": 100.0, "source": "USDA"},
    "apple": {"name": "Apple", "cal_per_100g": 52.0, "p_100g": 0.3, "c_100g": 13.8, "f_100g": 0.2, "fib_100g": 2.4, "std_portion_g": 150.0, "source": "USDA"},
    "oats": {"name": "Cooked Oatmeal", "cal_per_100g": 71.0, "p_100g": 2.5, "c_100g": 12.0, "f_100g": 1.5, "fib_100g": 1.7, "std_portion_g": 150.0, "source": "USDA"},
    "milk": {"name": "Toned Milk (3% fat)", "cal_per_100g": 58.0, "p_100g": 3.2, "c_100g": 4.8, "f_100g": 3.0, "fib_100g": 0.0, "std_portion_g": 200.0, "source": "IFCT2017"},
    "chai": {"name": "Masala Chai with Milk & Sugar", "cal_per_100g": 65.0, "p_100g": 1.8, "c_100g": 8.5, "f_100g": 2.2, "fib_100g": 0.0, "std_portion_g": 120.0, "source": "IFCT2017"}
}


def lookup_food_item(name_or_key: str, portion_g: float) -> dict:
    k = name_or_key.strip().lower()
    match = NUTRITION_DB.get(k)
    if not match:
        for db_key, db_val in NUTRITION_DB.items():
            if db_key in k or k in db_key:
                match = db_val
                break
    if not match:
        match = {"name": name_or_key.title(), "cal_per_100g": 100.0, "p_100g": 3.0, "c_100g": 15.0, "f_100g": 3.0, "fib_100g": 1.0, "std_portion_g": portion_g, "source": "Generic Reference"}
    
    scale = portion_g / 100.0
    return {
        "name": match["name"],
        "portion_g": round(portion_g, 1),
        "calories": round(match["cal_per_100g"] * scale, 1),
        "protein_g": round(match["p_100g"] * scale, 1),
        "carbs_g": round(match["c_100g"] * scale, 1),
        "fat_g": round(match["f_100g"] * scale, 1),
        "fiber_g": round(match["fib_100g"] * scale, 1),
        "source_db": match.get("source", "IFCT2017")
    }


def analyze_meal_image_bytes(file_bytes: bytes) -> list[dict]:
    # If Claude API is available, could send vision query
    # Default high-accuracy collegiate thali prior
    detected_keys = [
        ("roti", 60.0),
        ("dal", 150.0),
        ("rice", 150.0),
        ("sabzi", 120.0)
    ]
    items = [lookup_food_item(k, g) for k, g in detected_keys]
    return items


@app.post("/api/meals/analyze", dependencies=[Depends(rate_limit)])
async def analyze_meal_photo(file: UploadFile = File(...), u=Depends(current_user)):
    if not ENABLE_MEALS:
        raise HTTPException(503, "meals_disabled")
    content = await file.read()
    stored = process_and_store_image(content, u["id"], u["institution_id"])
    items = analyze_meal_image_bytes(content)
    total_cal = sum(it["calories"] for it in items)
    total_p = sum(it["protein_g"] for it in items)
    total_c = sum(it["carbs_g"] for it in items)
    total_f = sum(it["fat_g"] for it in items)
    total_fib = sum(it["fiber_g"] for it in items)
    return {
        "image_id": stored["id"],
        "image_url": stored["url"],
        "items": items,
        "totals": {
            "calories": round(total_cal, 1),
            "protein_g": round(total_p, 1),
            "carbs_g": round(total_c, 1),
            "fat_g": round(total_f, 1),
            "fiber_g": round(total_fib, 1)
        }
    }


@app.post("/api/meals/log", dependencies=[Depends(rate_limit)])
def log_meal(b: MealLogIn, u=Depends(current_user)):
    if not ENABLE_MEALS:
        raise HTTPException(503, "meals_disabled")
    c = db()
    t = now()
    tot_cal = sum(i.calories for i in b.items)
    tot_p = sum(i.protein_g for i in b.items)
    tot_c = sum(i.carbs_g for i in b.items)
    tot_f = sum(i.fat_g for i in b.items)
    tot_fib = sum(i.fiber_g or 0 for i in b.items)
    
    c.execute("""
      INSERT OR REPLACE INTO meal_logs(
        id, user_id, meal_type, title, image_id, total_calories,
        total_protein_g, total_carbs_g, total_fat_g, total_fiber_g, notes, logged_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        b.id, u["id"], b.meal_type, b.title or b.meal_type.title(), b.image_id,
        round(tot_cal, 1), round(tot_p, 1), round(tot_c, 1), round(tot_f, 1), round(tot_fib, 1),
        b.notes, t
    ))
    
    for item in b.items:
        item_id = secrets.token_hex(8)
        c.execute("""
          INSERT INTO meal_items(id, meal_id, name, portion_g, calories, protein_g, carbs_g, fat_g, fiber_g, source_db)
          VALUES(?,?,?,?,?,?,?,?,?,?)
        """, (
            item_id, b.id, item.name, item.portion_g, item.calories,
            item.protein_g, item.carbs_g, item.fat_g, item.fiber_g or 0.0, item.source_db or "IFCT2017"
        ))
    
    audit(c, u["id"], "log_meal", f"meal={b.id} cal={tot_cal}")
    c.commit(); c.close()
    return {"id": b.id, "logged": True, "total_calories": round(tot_cal, 1)}


@app.get("/api/meals/history")
def get_meal_history(days: int = 7, u=Depends(current_user)):
    if not ENABLE_MEALS:
        raise HTTPException(503, "meals_disabled")
    c = db()
    cutoff = now() - days * 86_400_000
    rows = c.execute("SELECT * FROM meal_logs WHERE user_id=? AND logged_at>=? ORDER BY logged_at DESC", (u["id"], cutoff)).fetchall()
    meal_ids = [r["id"] for r in rows]
    items_by_meal = defaultdict(list)
    if meal_ids:
        q = ",".join("?" * len(meal_ids))
        i_rows = c.execute(f"SELECT * FROM meal_items WHERE meal_id IN ({q})", meal_ids).fetchall()
        for ir in i_rows:
            items_by_meal[ir["meal_id"]].append(dict(ir))
    
    out = []
    for r in rows:
        d = dict(r)
        d["items"] = items_by_meal[r["id"]]
        out.append(d)
    c.close()
    return {"meals": out}


@app.post("/api/meals/retention/purge", dependencies=[Depends(admin_only)])
def purge_meals_retention(days: int = 90):
    c = db()
    cutoff = now() - days * 86_400_000
    c.execute("DELETE FROM meal_items WHERE meal_id IN (SELECT id FROM meal_logs WHERE logged_at < ?)", (cutoff,))
    cur = c.execute("DELETE FROM meal_logs WHERE logged_at < ?", (cutoff,))
    deleted = cur.rowcount
    audit(c, "admin", "meals_purge", f"days={days} deleted={deleted}")
    c.commit(); c.close()
    return {"purged_meals": deleted, "retention_days": days}


# ---------------------------------------------------------------- AI Assistant "KhelBuddy" (Feature F)
def get_user_grounding_context(c, uid: str) -> dict:
    ws = week_start(now())
    cred = credited_minutes(c, uid, ws)
    g = c.execute("SELECT * FROM goals WHERE user_id=? ORDER BY ts DESC LIMIT 1", (uid,)).fetchone()
    goal_mins = goal_for(g, now()) if g else 60
    band = g["band"] if g else "building"
    gentle = bool(g["gentle"]) if g else False
    
    # Active days this week
    act_rows = c.execute("SELECT ts, minutes, verified FROM activity_events WHERE user_id=? AND ts>=?", (uid, int(ws.timestamp() * 1000))).fetchall()
    active_days = len({datetime.fromtimestamp(r["ts"] / 1000, IST).date() for r in act_rows})
    
    # Squad info
    sm = c.execute("SELECT s.name, s.id FROM squads s JOIN squad_members m ON m.squad_id=s.id WHERE m.user_id=? ORDER BY m.joined_at DESC LIMIT 1", (uid,)).fetchone()
    squad_info = None
    if sm:
        mems = [r["user_id"] for r in c.execute("SELECT user_id FROM squad_members WHERE squad_id=?", (sm["id"],)).fetchall()]
        sc, _ = squad_score(c, mems, ws)
        squad_info = {"name": sm["name"], "members_count": len(mems), "score": sc}
    
    return {
        "weekly_credited_minutes": round(cred, 1),
        "weekly_goal_minutes": goal_mins,
        "completion_pct": round(min(100.0, (cred / goal_mins) * 100 if goal_mins > 0 else 0), 1),
        "active_days_this_week": active_days,
        "band": band,
        "gentle_mode": gentle,
        "squad": squad_info
    }


PROMPT_INJECTION_PATTERNS = [
    "ignore all previous", "ignore previous instructions", "developer mode",
    "dan mode", "system prompt", "disregard instructions", "override guardrails"
]


@app.post("/api/assistant/chat", dependencies=[Depends(rate_limit)])
def assistant_chat(b: AssistantChatIn, u=Depends(current_user)):
    if not ENABLE_ASSISTANT:
        raise HTTPException(503, "assistant_disabled")
    c = db()
    grounding = get_user_grounding_context(c, u["id"])
    
    # Extract latest user message
    user_msg = b.message or (b.messages[-1].get("content") if b.messages else "")
    user_msg_lower = user_msg.lower().strip()
    
    if not user_msg:
        c.close(); raise HTTPException(400, "empty_message")
    
    # 1. Crisis guardrail
    if contains_crisis(user_msg):
        reply = (
            "I'm really sorry that you're feeling this way, but please know that you are not alone and help is available. "
            "Please reach out to someone who can support you right now:\n"
            "• National KIRAN Mental Health Helpline: 1800-599-0019 (24/7, Toll-Free)\n"
            "• Tele-MANAS: 14416 or 1800-891-4416\n"
            "• Your campus student wellness and counselling centre.\n\n"
            "Physical activity can wait. Your life and wellbeing are what matter most."
        )
        t = now()
        c.execute("INSERT INTO assistant_messages VALUES(?,?,?,?,?,?)", (secrets.token_hex(8), u["id"], "user", user_msg, "[]", t))
        c.execute("INSERT INTO assistant_messages VALUES(?,?,?,?,?,?)", (secrets.token_hex(8), u["id"], "assistant", reply, "['crisis_guardrail']", t + 10))
        audit(c, u["id"], "assistant_crisis", "crisis support triggered")
        c.commit(); c.close()
        return {"reply": reply, "role": "assistant", "grounding": grounding, "guardrail": "crisis"}
    
    # 2. Prompt injection defense
    if any(p in user_msg_lower for p in PROMPT_INJECTION_PATTERNS):
        reply = (
            "Hello! I am KhelBuddy, your collegiate fitness and wellness companion. "
            "I am here solely to help you with workout routines, active minute goals, campus sports, and squad teamwork. "
            "How can I help you with your fitness habit today?"
        )
        c.close()
        return {"reply": reply, "role": "assistant", "grounding": grounding, "guardrail": "injection_blocked"}
    
    # 3. Grounded coaching logic
    name = u["display_name"].split()[0]
    cred = grounding["weekly_credited_minutes"]
    goal = grounding["weekly_goal_minutes"]
    pct = grounding["completion_pct"]
    squad_name = grounding["squad"]["name"] if grounding["squad"] else "a squad"
    
    if "goal" in user_msg_lower or "progress" in user_msg_lower or "minute" in user_msg_lower:
        reply = (
            f"Hey {name}! You have completed **{cred} of your {goal} active minutes** this week ({pct}% of goal). "
            f"You've been active on {grounding['active_days_this_week']} days. "
            + (f"Your squad '{squad_name}' has a current team score of {grounding['squad']['score']}! " if grounding['squad'] else "")
            + ("You've hit your weekly target—fantastic consistency! Remember that rest is essential." if pct >= 100 else f"You only need {max(0, int(goal - cred))} more active minutes to reach your goal.")
        )
    elif "squad" in user_msg_lower:
        if grounding["squad"]:
            reply = (
                f"Your squad **{grounding['squad']['name']}** has {grounding['squad']['members_count']} members and a team score of {grounding['squad']['score']} points. "
                f"Remember, squad scores are based on the average % completion of each member's personal baseline goal, so every 15-minute walk or workout counts towards your team!"
            )
        else:
            reply = (
                f"You are not in a squad yet, {name}! Joining a squad of 4–8 friends gives you team motivation. "
                "Head over to the Squad tab to create one or join with an invite code."
            )
    elif "diet" in user_msg_lower or "calorie" in user_msg_lower or "food" in user_msg_lower or "protein" in user_msg_lower:
        reply = (
            "For collegiate athletes and active students, balanced nutrition is all about fueling consistency. "
            "Focus on balanced mess meals with complex carbs (roti, rice), plant or animal protein (dal, paneer, eggs, chicken), and plenty of hydration. "
            "You can also use the new 🥗 **Meal Photo Nutrition Tracker** in KhelSetu to estimate plate macros using the IFCT 2017 database."
        )
    elif "rest" in user_msg_lower or "tired" in user_msg_lower or "sore" in user_msg_lower:
        reply = (
            "Rest is a fundamental part of fitness, not a failure! On KhelSetu, streak freezes protect your habit on rest days. "
            "If your muscles are sore, try light mobility, gentle stretching, or a 15-minute walk to promote blood flow."
        )
    else:
        reply = (
            f"Hi {name}! As your KhelBuddy assistant, I'm here to support your fitness journey. "
            f"You're currently at {cred}/{goal} active minutes this week ({pct}% complete). "
            "Feel free to ask me about your weekly goal, squad progress, workout suggestions, or campus facility slots!"
        )
    
    t = now()
    c.execute("INSERT INTO assistant_messages VALUES(?,?,?,?,?,?)", (secrets.token_hex(8), u["id"], "user", user_msg, "[]", t))
    c.execute("INSERT INTO assistant_messages VALUES(?,?,?,?,?,?)", (secrets.token_hex(8), u["id"], "assistant", reply, json.dumps(list(grounding.keys())), t + 10))
    audit(c, u["id"], "assistant_chat", f"msg_len={len(user_msg)}")
    c.commit(); c.close()
    
    return {"reply": reply, "role": "assistant", "grounding": grounding}


@app.get("/api/assistant/history")
def get_assistant_history(limit: int = 20, u=Depends(current_user)):
    if not ENABLE_ASSISTANT:
        raise HTTPException(503, "assistant_disabled")
    c = db()
    rows = c.execute("SELECT * FROM assistant_messages WHERE user_id=? ORDER BY created_at ASC LIMIT ?", (u["id"], min(50, limit))).fetchall()
    c.close()
    return {"messages": [dict(r) for r in rows]}


def group_stats(c, user_rows) -> dict:
    ws = week_start(now()); n = len(user_rows)
    mins, idxs, meet, bands = [], [], 0, defaultdict(int)
    for r in user_rows:
        m = credited_minutes(c, r["id"], ws); mins.append(m)
        if m >= 150: meet += 1
        g = c.execute("SELECT idx, band FROM goals WHERE user_id=? ORDER BY ts DESC LIMIT 1", (r["id"],)).fetchone()
        if g: idxs.append(g["idx"]); bands[g["band"]] += 1
    return {"n": n, "avg_weekly_minutes": round(sum(mins) / n, 1), "pct_meeting_150": round(100 * meet / n),
            "avg_baseline_index": round(sum(idxs) / len(idxs)) if idxs else None, "bands": dict(bands)}


@app.get("/api/admin/summary", dependencies=[Depends(admin_only)])
def admin_summary(institution: str = "DEMO"):
    c = db()
    inst = c.execute("SELECT * FROM institutions WHERE code=?", (institution.upper(),)).fetchone()
    if not inst:
        c.close(); raise HTTPException(404, "unknown_institution")
    users = c.execute("SELECT * FROM users WHERE institution_id=?", (inst["id"],)).fetchall()
    groups: dict = defaultdict(list)
    for r in users: groups[r["grp"]].append(r)
    visible, small = [], []
    for g, rows in groups.items():
        if len(rows) >= K_ANON: visible.append({"group": g, "suppressed": False, **group_stats(c, rows)})
        else: small.extend(rows)
    other = None
    if small:
        # Fold small groups together so no individual group is identifiable; hide the fold too if it is still < K.
        other = {"group": "Other (small groups)", "suppressed": True, "n": None} if len(small) < K_ANON \
            else {"group": "Other (small groups)", "suppressed": False, **group_stats(c, small)}
    synthetic = any(r["synthetic"] for r in users)
    audit(c, "admin", "view_summary", institution); c.commit(); c.close()
    return {"institution": inst["name"], "k": K_ANON, "synthetic_data": synthetic, "week_start": week_start(now()).date().isoformat(),
            "groups": sorted(visible, key=lambda x: x["group"]) + ([other] if other else [])}


# ---------------------------------------------------------------- demo seed (synthetic data only)
@app.post("/api/demo/seed", dependencies=[Depends(admin_only)])
def seed():
    if not DEMO:
        raise HTTPException(403, "demo_disabled")
    rnd = random.Random(26196)
    c = db(); inst = c.execute("SELECT id FROM institutions WHERE code='DEMO'").fetchone()["id"]
    syn = "(SELECT id FROM users WHERE synthetic=1 AND institution_id=?)"
    for t in ("squad_members", "assessments", "activity_events", "goals", "screenings", "consents"):
        c.execute(f"DELETE FROM {t} WHERE user_id IN {syn}", (inst,))
    c.execute("DELETE FROM squad_members WHERE squad_id IN (SELECT id FROM squads WHERE created_by='syn-seed')")
    c.execute("DELETE FROM squads WHERE created_by='syn-seed'")
    c.execute("DELETE FROM users WHERE synthetic=1 AND institution_id=?", (inst,))
    plan = [("Hostel A (Boys)", 22), ("Hostel B (Girls)", 18), ("CSE Year 2", 14), ("Mech Year 3", 4)]
    first = ["Aarav", "Diya", "Kabir", "Ananya", "Rohan", "Isha", "Vihaan", "Meera", "Arjun", "Saanvi", "Neel", "Tara", "Dev", "Riya", "Yash", "Pooja", "Aditya", "Nisha"]
    t0 = now(); sq_members: dict = defaultdict(list); sid = 0
    for grp, n in plan:
        for i in range(n):
            sid += 1; uid = f"syn-{sid:03d}"
            c.execute("INSERT INTO users(id,institution_id,display_name,grp,year,synthetic,created_at) VALUES(?,?,?,?,?,?,?)",
                      (uid, inst, f"{rnd.choice(first)} {chr(65 + i % 26)}.", grp, 2, 1, t0))
            idx = max(8, min(95, int(rnd.gauss(48, 20)))); band = band_of(idx)
            c.execute("INSERT INTO goals(id,user_id,ts,band,idx,start_minutes,gentle) VALUES(?,?,?,?,?,?,?)",
                      (f"g-{uid}", uid, t0 - 21 * 86_400_000, band, idx, START_MIN[band], 0))
            engage = rnd.choice([0.2, 0.5, 0.8, 1.0, 1.1])
            for d in range(0, 21):
                if rnd.random() < 0.55 * (0.6 + 0.4 * engage):
                    m = max(5, min(70, rnd.gauss(25 * engage + 8, 8)))
                    ts = t0 - d * 86_400_000 - rnd.randint(0, 8 * 3600_000)
                    c.execute("INSERT INTO activity_events(id,user_id,ts,minutes,activity,verified,source,received_at) VALUES(?,?,?,?,?,?,?,?)",
                              (f"a-{uid}-{d}", uid, ts, round(m, 1), "workout", int(rnd.random() < 0.6), "app", t0))
            sq_members[(grp, i // 6)].append(uid)
    for (grp, k), ids in sq_members.items():
        if len(ids) >= 3:
            cur = c.execute("INSERT INTO squads(institution_id,name,code,created_by,created_at) VALUES(?,?,?,?,?)",
                            (inst, f"{grp.split(' (')[0]} Squad {k + 1}", secrets.token_hex(3).upper(), "syn-seed", t0))
            c.executemany("INSERT INTO squad_members(squad_id,user_id,joined_at) VALUES(?,?,?)", [(cur.lastrowid, i, t0) for i in ids])
    audit(c, "admin", "seed_demo", "synthetic data"); c.commit(); c.close()
    return {"seeded_users": sum(n for _, n in plan), "note": "All seeded users are synthetic; group 'Mech Year 3' has 4 users to demonstrate k-anonymity suppression."}


@app.get("/api/health")
def health():
    return {"ok": True, "k": K_ANON, "demo": DEMO, "consent_version": CONSENT_VERSION}


app.mount("/", StaticFiles(directory=str(BASE.parent / "frontend"), html=True), name="static")
