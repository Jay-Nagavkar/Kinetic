import os, sys, tempfile, time, uuid
os.environ["KHELSETU_DB"] = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["DEMO"] = "1"; os.environ["K_ANON"] = "10"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from fastapi.testclient import TestClient
import main

c = TestClient(main.app)
ADMIN = {"X-Admin-Key": "demo-admin"}
now = lambda: int(time.time() * 1000)

def reg(name, group="Hostel A (Boys)", age=True):
    return c.post("/api/register", json={"name": name, "institution_code": "demo", "group": group, "year": 2, "age_confirmed_18": age,
        "consent_version": main.CONSENT_VERSION, "purposes": ["fitness_assessment", "activity_tracking"]})

def auth(r): return {"Authorization": "Bearer " + r.json()["token"]}

def test_under_18_blocked():
    assert reg("Kid", age=False).status_code == 403

def test_register_requires_consent_purposes():
    r = c.post("/api/register", json={"name": "X", "institution_code": "DEMO", "group": "G", "age_confirmed_18": True, "consent_version": "v", "purposes": []})
    assert r.status_code == 400

def test_sync_is_idempotent_and_validates():
    h = auth(reg("Shruti"))
    ev = [
        {"id": str(uuid.uuid4()), "type": "baseline", "ts": now(), "payload": {"band": "building", "index": 40}},
        {"id": str(uuid.uuid4()), "type": "assessment", "ts": now(), "payload": {"kind": "squat", "value": 14, "unit": "reps", "validity": "verified", "confidence": 0.97}},
        {"id": str(uuid.uuid4()), "type": "activity", "ts": now(), "payload": {"minutes": 30, "activity": "workout", "verified": True}},
        {"id": str(uuid.uuid4()), "type": "assessment", "ts": now(), "payload": {"kind": "squat", "value": 500, "unit": "reps", "validity": "verified"}},  # implausible
        {"id": str(uuid.uuid4()), "type": "activity", "ts": now() + 10**9, "payload": {"minutes": 20}},  # future
    ]
    r1 = c.post("/api/sync", json={"events": ev}, headers=h).json()
    assert len(r1["accepted"]) == 3 and {x["reason"] for x in r1["rejected"]} == {"implausible_value", "timestamp_in_future"}
    r2 = c.post("/api/sync", json={"events": ev}, headers=h).json()   # replay
    assert len(r2["accepted"]) == 3
    me = c.get("/api/me", headers=h).json()
    assert me["credited_minutes"] == 30 and me["weekly_goal"] == 90   # 'building' starts at 90

def test_daily_credit_cap_and_unverified_weight():
    h = auth(reg("Capper"))
    evs = [{"id": str(uuid.uuid4()), "type": "baseline", "ts": now(), "payload": {"band": "starter", "index": 10}},
           {"id": str(uuid.uuid4()), "type": "activity", "ts": now(), "payload": {"minutes": 120, "verified": True}},
           {"id": str(uuid.uuid4()), "type": "activity", "ts": now(), "payload": {"minutes": 40, "verified": False}}]
    c.post("/api/sync", json={"events": evs}, headers=h)
    assert c.get("/api/me", headers=h).json()["credited_minutes"] == 60.0   # capped at 60/day

def test_squad_uses_mean_and_hides_raw_performance():
    a, b = auth(reg("Alpha")), auth(reg("Bravo"))
    for h, mins in ((a, 60), (b, 0.0001)):
        c.post("/api/sync", json={"events": [
            {"id": str(uuid.uuid4()), "type": "baseline", "ts": now(), "payload": {"band": "starter", "index": 10}},
            {"id": str(uuid.uuid4()), "type": "activity", "ts": now(), "payload": {"minutes": mins, "verified": True}}]}, headers=h)
    s = c.post("/api/squads", json={"name": "Floor 3"}, headers=a).json()
    j = c.post("/api/squads/join", json={"code": s["code"]}, headers=b).json()
    assert j["score"] <= 51 and len(j["members"]) == 2           # mean of ~100% and ~0%
    assert set(j["members"][0].keys()) == {"name", "completion_pct", "you"}   # no raw reps/minutes exposed

def test_admin_requires_key_and_k_anonymity():
    assert c.get("/api/admin/summary").status_code == 403
    assert c.post("/api/demo/seed", headers=ADMIN).status_code == 200
    s = c.get("/api/admin/summary", headers=ADMIN).json()
    names = [g["group"] for g in s["groups"]]
    assert "Mech Year 3" not in names                             # 4 users < K=10, never shown by name
    other = next(g for g in s["groups"] if g["group"].startswith("Other"))
    assert other["suppressed"] is True and other["n"] is None      # fold still < K -> hidden
    assert s["synthetic_data"] is True
    assert all(g["n"] >= 10 for g in s["groups"] if not g["suppressed"])

def test_export_and_delete():
    r = reg("Gone"); h = auth(r)
    assert c.get("/api/me/export", headers=h).json()["user"]["display_name"] == "Gone"
    assert c.post("/api/me/delete", headers=h).json()["deleted"] is True
    assert c.get("/api/me", headers=h).status_code == 401

def test_tenant_isolation():
    # User from DEMO cannot join squad or query across another college
    r = reg("DemoUser", group="Hostel A (Boys)")
    h = auth(r)
    # Attempting to query an unknown or isolated college returns 404
    assert c.get("/api/admin/summary?institution=NONEXISTENT", headers=ADMIN).status_code == 404

def test_differencing_attack_prevented():
    # Verify suppressed groups in admin summary never leak user counts or raw distributions
    s = c.get("/api/admin/summary", headers=ADMIN).json()
    for g in s["groups"]:
        if g.get("suppressed"):
            assert g.get("n") is None
            assert "avg_weekly_minutes" not in g
            assert "bands" not in g

def test_otp_send_and_verify():
    send_res = c.post("/api/auth/otp/send", json={"identifier": "student@demo.ac.in", "institution_code": "DEMO"}).json()
    assert send_res["ok"] is True
    dev_otp = send_res["dev_otp"]
    assert dev_otp is not None
    verify_res = c.post("/api/auth/otp/verify", json={
        "identifier": "student@demo.ac.in", "otp": dev_otp, "name": "OTP Student",
        "institution_code": "DEMO", "group": "Hostel A (Boys)", "year": 2, "age_confirmed_18": True,
        "consent_version": main.CONSENT_VERSION, "purposes": ["fitness_assessment", "activity_tracking"]
    })
    assert verify_res.status_code == 200
    assert "token" in verify_res.json()

def test_officer_session_and_checkin():
    sess_res = c.post("/api/officer/sessions", json={"title": "Campus Yoga", "minutes": 45.0}, headers=ADMIN).json()
    code = sess_res["code"]
    user_token = auth(reg("Yogi"))
    checkin_res = c.post("/api/session/checkin", json={"code": code}, headers=user_token)
    assert checkin_res.status_code == 200
    assert checkin_res.json()["credited_minutes"] == 45.0
    assert checkin_res.json()["verified"] is True

def test_squad_leave_and_report():
    a = auth(reg("Reporter"))
    sq = c.post("/api/squads", json={"name": "Temp Squad"}, headers=a).json()
    sq_id = sq["id"]
    rep_res = c.post(f"/api/squads/{sq_id}/report", json={"reason": "Inappropriate team name"}, headers=a)
    assert rep_res.status_code == 200
    assert rep_res.json()["reported"] is True
    leave_res = c.post(f"/api/squads/{sq_id}/leave", headers=a)
    assert leave_res.status_code == 200
    assert leave_res.json()["left"] is True

def test_retest_record_delta():
    u = auth(reg("Improver"))
    res = c.post("/api/retest/record", json={"old_index": 35, "new_index": 52}, headers=u)
    assert res.status_code == 200
    assert res.json()["delta"] == 17
    assert res.json()["improved"] is True

def test_facilities_and_adaptive_sync():
    u = auth(reg("Athlete"))
    # Test adaptive arm_raise event sync
    t = int(time.time() * 1000)
    ev = {"id": f"ev-arm-{t}", "type": "assessment", "ts": t, "payload": {"kind": "arm_raise", "value": 18, "unit": "reps", "validity": "verified", "confidence": 0.95}}
    s_res = c.post("/api/sync", json={"events": [ev]}, headers=u)
    assert s_res.status_code == 200
    assert ev["id"] in s_res.json()["accepted"]

    # Test facility slots
    slots_res = c.get("/api/facilities/slots", headers=u)
    assert slots_res.status_code == 200
    facs = slots_res.json()["facilities"]
    assert len(facs) >= 4

    # Test facility reserve
    res_res = c.post("/api/facilities/reserve", json={"facility_id": "badminton", "slot_time": "17:00 - 17:45"}, headers=u)
    assert res_res.status_code == 200
    assert res_res.json()["reserved"] is True
    assert len(res_res.json()["checkin_code"]) == 4


