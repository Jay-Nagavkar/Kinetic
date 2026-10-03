import os, sys, tempfile, time, uuid
os.environ["KHELSETU_DB"] = os.path.join(tempfile.mkdtemp(), "chat_test.db")
os.environ["DEMO"] = "1"
os.environ["K_ANON"] = "10"
os.environ["ENABLE_CHAT"] = "1"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from fastapi.testclient import TestClient
import main

client = TestClient(main.app)
now = lambda: int(time.time() * 1000)
ADMIN = {"X-Admin-Key": "demo-admin"}

def register(name, group="Hostel A (Boys)", inst="DEMO", role="student"):
    r = client.post("/api/register", json={
        "name": name,
        "institution_code": inst,
        "group": group,
        "year": 2,
        "age_confirmed_18": True,
        "consent_version": main.CONSENT_VERSION,
        "purposes": ["fitness_assessment", "activity_tracking", "committee_chat"]
    })
    # If role needs to be officer/admin, update DB directly
    if role != "student":
        c = main.db()
        c.execute("UPDATE users SET role=? WHERE id=?", (role, r.json()["user_id"]))
        c.commit()
        c.close()
    return r

def auth(r):
    return {"Authorization": "Bearer " + r.json()["token"]}

def test_channels_created_and_listed():
    r_stu = register("StudentChat1")
    h_stu = auth(r_stu)
    
    chans = client.get("/api/chat/channels", headers=h_stu).json()["channels"]
    kinds = [c["kind"] for c in chans]
    assert "announcements" in kinds
    assert "ask_committee" in kinds

def test_squad_chat_membership_scoping():
    r1 = register("SquadMember1")
    r2 = register("SquadMember2")
    r_outsider = register("SquadOutsider")
    
    h1, h2, h_out = auth(r1), auth(r2), auth(r_outsider)
    
    # Create squad with r1 and join with r2
    sq = client.post("/api/squads", json={"name": "ChatSquad"}, headers=h1).json()
    client.post("/api/squads/join", json={"code": sq["code"]}, headers=h2)
    
    chans = client.get("/api/chat/channels", headers=h1).json()["channels"]
    sq_chan = next(c for c in chans if c["kind"] == "squad")
    
    # Member 1 sends message
    msg_id = str(uuid.uuid4())
    send_res = client.post(f"/api/chat/channels/{sq_chan['id']}/messages", json={
        "id": msg_id,
        "content": "Hello squad members!"
    }, headers=h1).json()
    assert send_res["sent"] is True
    
    # Member 2 reads message
    msgs = client.get(f"/api/chat/channels/{sq_chan['id']}/messages", headers=h2).json()["messages"]
    assert any(m["content"] == "Hello squad members!" for m in msgs)
    
    # Outsider is denied access
    out_res = client.get(f"/api/chat/channels/{sq_chan['id']}/messages", headers=h_out)
    assert out_res.status_code == 403

def test_announcements_permission():
    r_stu = register("StudentAnn")
    r_off = register("OfficerAnn", role="officer")
    h_stu, h_off = auth(r_stu), auth(r_off)
    
    chans = client.get("/api/chat/channels", headers=h_stu).json()["channels"]
    ann_chan = next(c for c in chans if c["kind"] == "announcements")
    
    # Student cannot post to announcements
    res_stu = client.post(f"/api/chat/channels/{ann_chan['id']}/messages", json={
        "id": str(uuid.uuid4()),
        "content": "Unauthorized announcement"
    }, headers=h_stu)
    assert res_stu.status_code == 403
    
    # Officer can post to announcements
    res_off = client.post(f"/api/chat/channels/{ann_chan['id']}/messages", json={
        "id": str(uuid.uuid4()),
        "content": "Sports Day on Friday at 4 PM!"
    }, headers=h_off).json()
    assert res_off["sent"] is True
    
    # Student can read and react to announcements
    msgs = client.get(f"/api/chat/channels/{ann_chan['id']}/messages", headers=h_stu).json()["messages"]
    ann_msg = next(m for m in msgs if "Sports Day" in m["content"])
    
    react_res = client.post(f"/api/chat/messages/{ann_msg['id']}/reactions", json={"emoji": "🔥"}, headers=h_stu).json()
    assert react_res["reacted"] is True

def test_links_blocking_guardrail():
    r_stu = register("LinkStudent")
    h_stu = auth(r_stu)
    chans = client.get("/api/chat/channels", headers=h_stu).json()["channels"]
    ask_chan = next(c for c in chans if c["kind"] == "ask_committee")
    
    # Unapproved external link rejected
    bad_link_res = client.post(f"/api/chat/channels/{ask_chan['id']}/messages", json={
        "id": str(uuid.uuid4()),
        "content": "Check this spam site: http://shady-phishing-site.com"
    }, headers=h_stu)
    assert bad_link_res.status_code == 400
    assert bad_link_res.json()["detail"] == "links_not_permitted"
    
    # Approved institutional domain permitted
    good_link_res = client.post(f"/api/chat/channels/{ask_chan['id']}/messages", json={
        "id": str(uuid.uuid4()),
        "content": "Please check rules at https://sports.college.ac.in"
    }, headers=h_stu)
    assert good_link_res.status_code == 200

def test_wellbeing_crisis_and_abuse_filters():
    r_stu = register("SupportStudent")
    r_off = register("ModOfficer", role="officer")
    h_stu, h_off = auth(r_stu), auth(r_off)
    
    chans = client.get("/api/chat/channels", headers=h_stu).json()["channels"]
    ask_chan = next(c for c in chans if c["kind"] == "ask_committee")
    
    # Crisis keywords triggers calm notice and flags for counsellor review
    crisis_res = client.post(f"/api/chat/channels/{ask_chan['id']}/messages", json={
        "id": str(uuid.uuid4()),
        "content": "I am feeling hopeless and thinking about self harm"
    }, headers=h_stu).json()
    assert crisis_res["sent"] is True
    assert crisis_res["crisis_notice"] is not None
    assert "counselling centre" in crisis_res["crisis_notice"]
    
    # Abuse keywords hold message for review
    abuse_id = str(uuid.uuid4())
    abuse_res = client.post(f"/api/chat/channels/{ask_chan['id']}/messages", json={
        "id": abuse_id,
        "content": "You are an idiot and a bastard"
    }, headers=h_stu).json()
    assert abuse_res["held_for_review"] is True
    
    # Officer sees flagged messages in moderation queue
    queue = client.get("/api/moderation/queue", headers=h_off).json()["queue"]
    flagged_ids = [m["id"] for m in queue]
    assert abuse_id in flagged_ids
    
    # Officer resolves by approving or deleting
    resolve_res = client.post(f"/api/moderation/messages/{abuse_id}/resolve", json={"action": "delete", "reason": "offensive language"}, headers=h_off).json()
    assert resolve_res["resolved"] is True

def test_block_user_hides_content():
    r_userA = register("UserA")
    r_userB = register("UserB")
    hA, hB = auth(r_userA), auth(r_userB)
    
    sq = client.post("/api/squads", json={"name": "BlockSquad"}, headers=hA).json()
    client.post("/api/squads/join", json={"code": sq["code"]}, headers=hB)
    
    sq_chan = next(c for c in client.get("/api/chat/channels", headers=hA).json()["channels"] if c["kind"] == "squad")
    
    # User B sends message
    client.post(f"/api/chat/channels/{sq_chan['id']}/messages", json={
        "id": str(uuid.uuid4()),
        "content": "Message from User B"
    }, headers=hB)
    
    # User A blocks User B
    client.post("/api/chat/users/block", json={"blocked_user_id": r_userB.json()["user_id"]}, headers=hA)
    
    # Messages from B are hidden from A
    msgs = client.get(f"/api/chat/channels/{sq_chan['id']}/messages", headers=hA).json()["messages"]
    assert not any(m["content"] == "Message from User B" for m in msgs)

def test_offline_idempotency_and_retention_purge():
    r_stu = register("OfflineStudent")
    h_stu = auth(r_stu)
    chans = client.get("/api/chat/channels", headers=h_stu).json()["channels"]
    ask_chan = next(c for c in chans if c["kind"] == "ask_committee")
    
    msg_id = str(uuid.uuid4())
    payload = {"id": msg_id, "content": "Queued message sent twice"}
    
    # Send once
    r1 = client.post(f"/api/chat/channels/{ask_chan['id']}/messages", json=payload, headers=h_stu).json()
    # Send retry with same UUID
    r2 = client.post(f"/api/chat/channels/{ask_chan['id']}/messages", json=payload, headers=h_stu).json()
    assert r1["sent"] is True and r2["sent"] is True
    
    # Only 1 record in database
    msgs = client.get(f"/api/chat/channels/{ask_chan['id']}/messages", headers=h_stu).json()["messages"]
    matching = [m for m in msgs if m["id"] == msg_id]
    assert len(matching) == 1
    
    # Retention purge
    purge_res = client.post("/api/chat/retention/purge?days=0", headers=ADMIN).json()
    assert "purged_messages" in purge_res

def test_export_and_delete_includes_chat():
    r = register("ChatDeleteUser")
    h = auth(r)
    chans = client.get("/api/chat/channels", headers=h).json()["channels"]
    ask_chan = next(c for c in chans if c["kind"] == "ask_committee")
    
    client.post(f"/api/chat/channels/{ask_chan['id']}/messages", json={
        "id": str(uuid.uuid4()),
        "content": "My private committee message"
    }, headers=h)
    
    exp = client.get("/api/me/export", headers=h).json()
    assert len(exp["chat_messages"]) >= 1
    
    del_res = client.post("/api/me/delete", headers=h).json()
    assert del_res["deleted"] is True

if __name__ == "__main__":
    test_channels_created_and_listed()
    test_squad_chat_membership_scoping()
    test_announcements_permission()
    test_links_blocking_guardrail()
    test_wellbeing_crisis_and_abuse_filters()
    test_block_user_hides_content()
    test_offline_idempotency_and_retency_purge = test_offline_idempotency_and_retention_purge()
    test_export_and_delete_includes_chat()
    print("ALL CHAT TESTS PASSED")
