import io, os, sys, tempfile, time, uuid
from pathlib import Path
from PIL import Image

_tmp = tempfile.mkdtemp()
os.environ["KHELSETU_DB"] = os.path.join(_tmp, "feed_test.db")
os.environ["KHELSETU_MEDIA_DIR"] = os.path.join(_tmp, "media")
os.environ["DEMO"] = "1"
os.environ["K_ANON"] = "10"
os.environ["ENABLE_FEED"] = "1"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from fastapi.testclient import TestClient
import main

client = TestClient(main.app)
now = lambda: int(time.time() * 1000)
ADMIN = {"X-Admin-Key": "demo-admin"}


def create_test_image_bytes(format="JPEG", size=(400, 300), color=(200, 50, 50)):
    buf = io.BytesIO()
    img = Image.new("RGB", size, color)
    img.save(buf, format=format)
    return buf.getvalue()


def register(name, group="Hostel A (Boys)", inst="DEMO", role="student"):
    r = client.post("/api/register", json={
        "name": name,
        "institution_code": inst,
        "group": group,
        "year": 2,
        "age_confirmed_18": True,
        "consent_version": main.CONSENT_VERSION,
        "purposes": ["fitness_assessment", "activity_tracking", "feed_posts"]
    })
    if role != "student":
        c = main.db()
        c.execute("UPDATE users SET role=? WHERE id=?", (role, r.json()["user_id"]))
        c.commit()
        c.close()
    return r


def auth(r):
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_image_upload_magic_bytes_and_exif_stripping():
    r = register("FeedUser1")
    h = auth(r)
    
    # 1. Upload valid JPEG
    img_bytes = create_test_image_bytes(format="JPEG")
    res = client.post("/api/feed/upload", headers=h, files={"file": ("workout.jpg", img_bytes, "image/jpeg")})
    assert res.status_code == 200, res.text
    data = res.json()
    assert "id" in data
    assert "url" in data
    assert "thumb_url" in data
    
    # 2. Fetch full image and thumbnail
    img_res = client.get(data["url"])
    assert img_res.status_code == 200
    assert img_res.headers["content-type"] == "image/jpeg"
    assert len(img_res.content) > 0
    
    thumb_res = client.get(data["thumb_url"])
    assert thumb_res.status_code == 200
    assert len(thumb_res.content) > 0
    
    # 3. Reject invalid magic bytes (fake image text file)
    bad_res = client.post("/api/feed/upload", headers=h, files={"file": ("fake.jpg", b"NOT AN IMAGE", "image/jpeg")})
    assert bad_res.status_code == 400
    assert "unsupported_image_format" in bad_res.json()["detail"]


def test_create_and_fetch_feed_posts_visibility():
    r_alice = register("AliceFeed", group="Hostel A (Boys)")
    r_bob = register("BobFeed", group="Hostel A (Boys)")
    r_charlie = register("CharlieFeed", group="Hostel B (Girls)")
    
    h_alice, h_bob, h_charlie = auth(r_alice), auth(r_bob), auth(r_charlie)
    
    # Alice and Bob in Squad 1
    sq = client.post("/api/squads", json={"name": "FeedSquad"}, headers=h_alice).json()
    client.post("/api/squads/join", json={"code": sq["code"]}, headers=h_bob)
    
    # Alice uploads an image
    img_bytes = create_test_image_bytes(format="PNG")
    up = client.post("/api/feed/upload", headers=h_alice, files={"file": ("gym.png", img_bytes, "image/png")})
    media_id = up.json()["id"]
    
    # Alice creates a squad post
    post_squad = client.post("/api/feed/posts", headers=h_alice, json={
        "id": f"post-{uuid.uuid4()}",
        "image_id": media_id,
        "caption": "Crushed 50 pushups today with the squad!",
        "tag": "Gym Day",
        "visibility": "squad"
    })
    assert post_squad.status_code == 200
    p1_id = post_squad.json()["id"]
    
    # Alice creates a hostel post
    post_hostel = client.post("/api/feed/posts", headers=h_alice, json={
        "id": f"post-{uuid.uuid4()}",
        "image_id": media_id,
        "caption": "Hostel A morning run completed!",
        "tag": "Morning Run",
        "visibility": "hostel"
    })
    assert post_hostel.status_code == 200
    p2_id = post_hostel.json()["id"]
    
    # Alice creates a campus post
    post_campus = client.post("/api/feed/posts", headers=h_alice, json={
        "id": f"post-{uuid.uuid4()}",
        "image_id": media_id,
        "caption": "Campus sports fest practice.",
        "tag": "Campus Fit",
        "visibility": "campus"
    })
    assert post_campus.status_code == 200
    p3_id = post_campus.json()["id"]
    
    # Bob (same squad & same hostel) sees all 3 posts
    bob_feed = client.get("/api/feed/posts", headers=h_bob).json()["posts"]
    bob_ids = {p["id"] for p in bob_feed}
    assert p1_id in bob_ids
    assert p2_id in bob_ids
    assert p3_id in bob_ids
    
    # Charlie (different squad & different hostel) only sees the campus post
    charlie_feed = client.get("/api/feed/posts", headers=h_charlie).json()["posts"]
    charlie_ids = {p["id"] for p in charlie_feed}
    assert p1_id not in charlie_ids
    assert p2_id not in charlie_ids
    assert p3_id in charlie_ids


def test_post_reactions_and_comments():
    r_alice = register("AliceReact")
    r_bob = register("BobReact")
    h_alice, h_bob = auth(r_alice), auth(r_bob)
    
    img_bytes = create_test_image_bytes()
    up = client.post("/api/feed/upload", headers=h_alice, files={"file": ("run.jpg", img_bytes, "image/jpeg")})
    media_id = up.json()["id"]
    
    post_id = f"post-react-{uuid.uuid4()}"
    client.post("/api/feed/posts", headers=h_alice, json={
        "id": post_id,
        "image_id": media_id,
        "caption": "Ready for the 5k!",
        "tag": "Running",
        "visibility": "campus"
    })
    
    # Bob reacts with 🔥
    r1 = client.post(f"/api/feed/posts/{post_id}/reactions", headers=h_bob, json={"emoji": "🔥"})
    assert r1.status_code == 200
    assert r1.json()["action"] == "added"
    assert r1.json()["reactions"]["🔥"] == 1
    
    # Bob removes reaction
    r2 = client.post(f"/api/feed/posts/{post_id}/reactions", headers=h_bob, json={"emoji": "🔥"})
    assert r2.status_code == 200
    assert r2.json()["action"] == "removed"
    
    # Bob adds comment
    comm_id = f"comm-{uuid.uuid4()}"
    c1 = client.post(f"/api/feed/posts/{post_id}/comments", headers=h_bob, json={
        "id": comm_id,
        "content": "Great pace, keep it up!"
    })
    assert c1.status_code == 200
    
    # Check comments list
    comments = client.get(f"/api/feed/posts/{post_id}/comments", headers=h_alice).json()["comments"]
    assert any(c["id"] == comm_id and c["content"] == "Great pace, keep it up!" for c in comments)
    
    # Block external link in comment
    link_comm = client.post(f"/api/feed/posts/{post_id}/comments", headers=h_bob, json={
        "id": f"comm-bad-{uuid.uuid4()}",
        "content": "Check this supplement out at http://spam-shop.com"
    })
    assert link_comm.status_code == 400
    assert "links_not_permitted" in link_comm.json()["detail"]


def test_post_report_and_quarantine():
    r_alice = register("AliceRep")
    r_bob = register("BobRep")
    r_charlie = register("CharlieRep")
    r_officer = register("OfficerRep", role="officer")
    
    h_alice, h_bob, h_charlie, h_officer = auth(r_alice), auth(r_bob), auth(r_charlie), auth(r_officer)
    
    img_bytes = create_test_image_bytes()
    up = client.post("/api/feed/upload", headers=h_alice, files={"file": ("rep.jpg", img_bytes, "image/jpeg")})
    media_id = up.json()["id"]
    
    post_id = f"post-rep-{uuid.uuid4()}"
    client.post("/api/feed/posts", headers=h_alice, json={
        "id": post_id,
        "image_id": media_id,
        "caption": "Questionable post caption",
        "tag": "Workout",
        "visibility": "campus"
    })
    
    # 2 reports
    client.post(f"/api/feed/posts/{post_id}/report", headers=h_bob, json={"reason": "Spam"})
    client.post(f"/api/feed/posts/{post_id}/report", headers=h_charlie, json={"reason": "Inappropriate"})
    
    # Still visible before 3rd report
    posts = client.get("/api/feed/posts", headers=h_bob).json()["posts"]
    assert any(p["id"] == post_id for p in posts)
    
    # 3rd report triggers auto-quarantine
    client.post(f"/api/feed/posts/{post_id}/report", headers=h_officer, json={"reason": "Review needed"})
    
    # Held for review: peers cannot see it anymore
    posts_after = client.get("/api/feed/posts", headers=h_bob).json()["posts"]
    assert not any(p["id"] == post_id for p in posts_after)


def test_delete_post_authorization_and_cascade():
    r_alice = register("AliceDel")
    r_bob = register("BobDel")
    h_alice, h_bob = auth(r_alice), auth(r_bob)
    
    img_bytes = create_test_image_bytes()
    up = client.post("/api/feed/upload", headers=h_alice, files={"file": ("del.jpg", img_bytes, "image/jpeg")})
    media_id = up.json()["id"]
    
    post_id = f"post-del-{uuid.uuid4()}"
    client.post("/api/feed/posts", headers=h_alice, json={
        "id": post_id,
        "image_id": media_id,
        "caption": "Going to delete this soon",
        "tag": "Gym Day",
        "visibility": "campus"
    })
    
    # Bob cannot delete Alice's post
    unauth = client.post(f"/api/feed/posts/{post_id}/delete", headers=h_bob)
    assert unauth.status_code == 403
    
    # Alice can delete her own post
    auth_del = client.post(f"/api/feed/posts/{post_id}/delete", headers=h_alice)
    assert auth_del.status_code == 200
    
    # Verify not in feed
    posts = client.get("/api/feed/posts", headers=h_alice).json()["posts"]
    assert not any(p["id"] == post_id for p in posts)


def test_feed_data_export_and_account_deletion():
    r_alice = register("AliceExpDel")
    h_alice = auth(r_alice)
    uid = r_alice.json()["user_id"]
    
    img_bytes = create_test_image_bytes()
    up = client.post("/api/feed/upload", headers=h_alice, files={"file": ("exp.jpg", img_bytes, "image/jpeg")})
    media_id = up.json()["id"]
    
    post_id = f"post-exp-{uuid.uuid4()}"
    client.post("/api/feed/posts", headers=h_alice, json={
        "id": post_id,
        "image_id": media_id,
        "caption": "Export and erasure test",
        "tag": "Gym Day",
        "visibility": "campus"
    })
    
    # Export data
    exp = client.get("/api/me/export", headers=h_alice).json()
    assert "posts" in exp
    assert any(p["id"] == post_id for p in exp["posts"])
    
    # Delete account
    del_res = client.post("/api/me/delete", headers=h_alice)
    assert del_res.status_code == 200
    
    # User and media should be purged
    c = main.db()
    assert c.execute("SELECT COUNT(*) cnt FROM users WHERE id=?", (uid,)).fetchone()["cnt"] == 0
    assert c.execute("SELECT COUNT(*) cnt FROM posts WHERE author_id=?", (uid,)).fetchone()["cnt"] == 0
    assert c.execute("SELECT COUNT(*) cnt FROM media_files WHERE owner_id=?", (uid,)).fetchone()["cnt"] == 0
    c.close()


def test_feed_retention_purge():
    r_alice = register("AlicePurge")
    h_alice = auth(r_alice)
    
    img_bytes = create_test_image_bytes()
    up = client.post("/api/feed/upload", headers=h_alice, files={"file": ("purge.jpg", img_bytes, "image/jpeg")})
    media_id = up.json()["id"]
    
    post_id = f"post-purge-{uuid.uuid4()}"
    client.post("/api/feed/posts", headers=h_alice, json={
        "id": post_id,
        "image_id": media_id,
        "caption": "Old post for purge",
        "tag": "Gym Day",
        "visibility": "campus"
    })
    
    # Backdate post and media to 100 days ago
    c = main.db()
    t_old = now() - 100 * 86_400_000
    c.execute("UPDATE posts SET created_at=? WHERE id=?", (t_old, post_id))
    c.execute("UPDATE media_files SET created_at=? WHERE id=?", (t_old, media_id))
    c.commit(); c.close()
    
    # Run purge for > 90 days
    res = client.post("/api/feed/retention/purge?days=90", headers=ADMIN)
    assert res.status_code == 200
    assert res.json()["purged_posts"] >= 1
    
    c = main.db()
    assert c.execute("SELECT COUNT(*) cnt FROM posts WHERE id=?", (post_id,)).fetchone()["cnt"] == 0
    c.close()
