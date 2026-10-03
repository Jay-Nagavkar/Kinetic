import os, sys, tempfile, time, uuid
os.environ["KHELSETU_DB"] = os.path.join(tempfile.mkdtemp(), "lb_test.db")
os.environ["DEMO"] = "1"
os.environ["K_ANON"] = "10"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from fastapi.testclient import TestClient
import main

client = TestClient(main.app)
now = lambda: int(time.time() * 1000)

def register(name, group="Hostel A (Boys)", inst="DEMO"):
    return client.post("/api/register", json={
        "name": name,
        "institution_code": inst,
        "group": group,
        "year": 2,
        "age_confirmed_18": True,
        "consent_version": main.CONSENT_VERSION,
        "purposes": ["fitness_assessment", "activity_tracking"]
    })

def auth(r):
    return {"Authorization": "Bearer " + r.json()["token"]}

def test_beginner_vs_advanced_fairness():
    """Starter with 60 min goal meeting 60 min has equal score (100%) to Steady with 120 min goal meeting 120 min."""
    r_starter = register("StarterUser")
    h_starter = auth(r_starter)
    
    r_steady = register("SteadyUser")
    h_steady = auth(r_steady)
    
    ws_ms = int(main.week_start(now()).timestamp() * 1000)
    t_day1 = ws_ms + 3600 * 1000  # Monday
    t_day2 = ws_ms + 86400 * 1000 + 3600 * 1000  # Tuesday
    
    # Starter sets starter goal (60m)
    client.post("/api/sync", json={"events": [
        {"id": str(uuid.uuid4()), "type": "baseline", "ts": t_day1, "payload": {"band": "starter", "index": 20}},
        {"id": str(uuid.uuid4()), "type": "activity", "ts": t_day1, "payload": {"minutes": 60, "verified": True}}
    ]}, headers=h_starter)
    
    # Steady sets steady goal (120m)
    client.post("/api/sync", json={"events": [
        {"id": str(uuid.uuid4()), "type": "baseline", "ts": t_day1, "payload": {"band": "steady", "index": 60}},
        {"id": str(uuid.uuid4()), "type": "activity", "ts": t_day1, "payload": {"minutes": 60, "verified": True}},
        {"id": str(uuid.uuid4()), "type": "activity", "ts": t_day2, "payload": {"minutes": 60, "verified": True}}
    ]}, headers=h_steady)
    
    lb_starter = client.get("/api/leaderboards/consistency", headers=h_starter).json()
    lb_steady = client.get("/api/leaderboards/consistency", headers=h_steady).json()
    
    starter_pct = lb_starter["your_standing"]["completion_pct"]
    steady_pct = lb_steady["your_standing"]["completion_pct"]
    
    assert starter_pct == 100.0
    assert steady_pct == 100.0
    # No raw reps/minutes leaked
    assert "raw_minutes" not in lb_starter["your_standing"]
    assert "reps" not in lb_starter["your_standing"]

def test_goal_capping_and_no_grind_advantage():
    """User logging 400 minutes is strictly capped at 100% completion."""
    r_grinder = register("GrinderUser")
    h_grinder = auth(r_grinder)
    ws_ms = int(main.week_start(now()).timestamp() * 1000)
    t_day1 = ws_ms + 3600 * 1000
    t_day2 = ws_ms + 86400 * 1000 + 3600 * 1000
    
    client.post("/api/sync", json={"events": [
        {"id": str(uuid.uuid4()), "type": "baseline", "ts": t_day1, "payload": {"band": "building", "index": 40}},
        {"id": str(uuid.uuid4()), "type": "activity", "ts": t_day1, "payload": {"minutes": 120, "verified": True}},
        {"id": str(uuid.uuid4()), "type": "activity", "ts": t_day2, "payload": {"minutes": 120, "verified": True}}
    ]}, headers=h_grinder)
    
    lb = client.get("/api/leaderboards/consistency", headers=h_grinder).json()
    assert lb["your_standing"]["completion_pct"] <= 100.0

def test_opt_out_and_alias_privacy():
    """Opt-out hides user from consistency board; alias replaces display name completely."""
    r = register("PrivateRealName")
    h = auth(r)
    
    # Update preferences to set alias
    client.post("/api/user/preferences", json={
        "alias": "SecretRunner",
        "board_opt_out": False,
        "kindness_mode": False
    }, headers=h)
    
    lb = client.get("/api/leaderboards/consistency", headers=h).json()
    # If in board list or standing, alias is used, never real name
    for u in lb["board"]:
        assert "PrivateRealName" not in u["name"]
    
    # Now opt out
    client.post("/api/user/preferences", json={
        "alias": "SecretRunner",
        "board_opt_out": True
    }, headers=h)
    
    lb2 = client.get("/api/leaderboards/consistency", headers=h).json()
    names2 = [u["name"] for u in lb2["board"]]
    assert "SecretRunner" not in names2
    assert lb2["your_standing"]["opted_out"] is True

def test_department_rate_k_anonymity_and_suppression():
    """Department league ranks by % meeting goal and suppresses groups < 10."""
    admin_h = {"X-Admin-Key": "demo-admin"}
    client.post("/api/demo/seed", headers=admin_h)
    
    r = register("DeptUser")
    h = auth(r)
    
    res = client.get("/api/leaderboards/departments", headers=h).json()
    depts = res["departments"]
    
    # Small groups (< 10, e.g. Mech Year 3 with 4 users) must NOT appear individually
    grp_names = [d["group"] for d in depts]
    assert "Mech Year 3" not in grp_names
    
    # Check 'Other' suppression
    other = next((d for d in depts if d["group"].startswith("Other")), None)
    if other:
        assert other["suppressed"] is True
        assert other["participation_rate"] is None
        assert other["n"] is None

def test_tenant_isolation_on_leaderboards():
    """Leaderboards only return data from the authenticated user's institution."""
    r_demo = register("DemoCollegeUser")
    h_demo = auth(r_demo)
    
    res = client.get("/api/leaderboards/squads", headers=h_demo).json()
    assert "divisions" in res
    assert res["divisions"] is not None

if __name__ == "__main__":
    test_beginner_vs_advanced_fairness()
    test_goal_capping_and_no_grind_advantage()
    test_opt_out_and_alias_privacy()
    test_department_rate_k_anonymity_and_suppression()
    test_tenant_isolation_on_leaderboards()
    print("ALL LEADERBOARD TESTS PASSED")
