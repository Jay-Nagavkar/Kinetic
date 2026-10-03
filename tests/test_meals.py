import io, os, sys, tempfile, time, uuid
from PIL import Image

_tmp = tempfile.mkdtemp()
os.environ["KHELSETU_DB"] = os.path.join(_tmp, "meals_test.db")
os.environ["KHELSETU_MEDIA_DIR"] = os.path.join(_tmp, "media")
os.environ["DEMO"] = "1"
os.environ["K_ANON"] = "10"
os.environ["ENABLE_MEALS"] = "1"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from fastapi.testclient import TestClient
import main

client = TestClient(main.app)
now = lambda: int(time.time() * 1000)
ADMIN = {"X-Admin-Key": "demo-admin"}


def create_test_image_bytes(format="JPEG", size=(400, 300), color=(180, 100, 40)):
    buf = io.BytesIO()
    img = Image.new("RGB", size, color)
    img.save(buf, format=format)
    return buf.getvalue()


def register(name, group="Hostel A (Boys)"):
    return client.post("/api/register", json={
        "name": name,
        "institution_code": "DEMO",
        "group": group,
        "year": 2,
        "age_confirmed_18": True,
        "consent_version": main.CONSENT_VERSION,
        "purposes": ["fitness_assessment", "activity_tracking", "meal_tracking"]
    })


def auth(r):
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_meal_photo_analysis_and_nutrition_lookup():
    r = register("MealUser1")
    h = auth(r)
    
    img_bytes = create_test_image_bytes()
    res = client.post("/api/meals/analyze", headers=h, files={"file": ("thali.jpg", img_bytes, "image/jpeg")})
    assert res.status_code == 200, res.text
    data = res.json()
    assert "image_id" in data
    assert "items" in data
    assert len(data["items"]) >= 2
    assert "totals" in data
    assert data["totals"]["calories"] > 100
    assert data["totals"]["protein_g"] > 5


def test_meal_logging_and_history():
    r = register("MealUser2")
    h = auth(r)
    
    meal_id = f"meal-{uuid.uuid4()}"
    log_res = client.post("/api/meals/log", headers=h, json={
        "id": meal_id,
        "meal_type": "lunch",
        "title": "Mess Lunch Plate",
        "items": [
            {"name": "Roti / Chapati", "portion_g": 60.0, "calories": 147.0, "protein_g": 5.1, "carbs_g": 29.4, "fat_g": 1.5, "fiber_g": 5.4, "source_db": "IFCT2017"},
            {"name": "Dal Tadka", "portion_g": 150.0, "calories": 177.0, "protein_g": 10.2, "carbs_g": 24.8, "fat_g": 4.8, "fiber_g": 5.2, "source_db": "IFCT2017"}
        ],
        "notes": "Post-workout lunch"
    })
    assert log_res.status_code == 200
    assert log_res.json()["logged"] is True
    assert log_res.json()["total_calories"] == 324.0
    
    # Check history
    hist = client.get("/api/meals/history", headers=h).json()
    assert len(hist["meals"]) == 1
    m = hist["meals"][0]
    assert m["id"] == meal_id
    assert len(m["items"]) == 2
    assert m["total_calories"] == 324.0


def test_meal_export_and_cascade_deletion():
    r = register("MealUser3")
    h = auth(r)
    uid = r.json()["user_id"]
    
    meal_id = f"meal-exp-{uuid.uuid4()}"
    client.post("/api/meals/log", headers=h, json={
        "id": meal_id,
        "meal_type": "dinner",
        "title": "Dinner Bowl",
        "items": [
            {"name": "Boiled White Rice", "portion_g": 150.0, "calories": 195.0, "protein_g": 4.0, "carbs_g": 42.3, "fat_g": 0.5, "fiber_g": 0.6, "source_db": "IFCT2017"}
        ]
    })
    
    # Export
    exp = client.get("/api/me/export", headers=h).json()
    assert "meal_logs" in exp
    assert any(m["id"] == meal_id for m in exp["meal_logs"])
    assert "meal_items" in exp
    assert len(exp["meal_items"]) >= 1
    
    # Delete Account
    del_res = client.post("/api/me/delete", headers=h)
    assert del_res.status_code == 200
    
    c = main.db()
    assert c.execute("SELECT COUNT(*) cnt FROM meal_logs WHERE user_id=?", (uid,)).fetchone()["cnt"] == 0
    assert c.execute("SELECT COUNT(*) cnt FROM meal_items WHERE meal_id=?", (meal_id,)).fetchone()["cnt"] == 0
    c.close()


def test_meal_retention_purge():
    r = register("MealUser4")
    h = auth(r)
    
    meal_id = f"meal-purge-{uuid.uuid4()}"
    client.post("/api/meals/log", headers=h, json={
        "id": meal_id,
        "meal_type": "breakfast",
        "title": "Old Breakfast",
        "items": [
            {"name": "Poha with Veggies", "portion_g": 150.0, "calories": 240.0, "protein_g": 4.8, "carbs_g": 42.7, "fat_g": 6.3, "fiber_g": 3.3, "source_db": "IFCT2017"}
        ]
    })
    
    # Backdate meal
    c = main.db()
    t_old = now() - 100 * 86_400_000
    c.execute("UPDATE meal_logs SET logged_at=? WHERE id=?", (t_old, meal_id))
    c.commit(); c.close()
    
    # Run purge
    purge_res = client.post("/api/meals/retention/purge?days=90", headers=ADMIN)
    assert purge_res.status_code == 200
    assert purge_res.json()["purged_meals"] >= 1
    
    c = main.db()
    assert c.execute("SELECT COUNT(*) cnt FROM meal_logs WHERE id=?", (meal_id,)).fetchone()["cnt"] == 0
    c.close()
