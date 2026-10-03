#!/usr/bin/env python3
"""
KhelSetu Ingestion Benchmark Script.
Measures synchronous SQLite ingestion throughput (requests/sec and latency) for /api/sync.
"""
import time, uuid, os, tempfile, sys
from pathlib import Path

# Setup isolated test DB
os.environ["KHELSETU_DB"] = os.path.join(tempfile.mkdtemp(), "bench.db")
os.environ["DEMO"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from fastapi.testclient import TestClient
import main

def benchmark_ingestion(num_batches=100, batch_size=10):
    client = TestClient(main.app)
    # Register user
    r = client.post("/api/register", json={
        "name": "BenchUser", "institution_code": "DEMO", "group": "Hostel A (Boys)",
        "year": 2, "age_confirmed_18": True, "consent_version": "2026-10-v1",
        "purposes": ["fitness_assessment", "activity_tracking"]
    })
    token = r.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    events_payload = []
    now_ms = int(time.time() * 1000)
    for i in range(batch_size):
        events_payload.append({
            "id": str(uuid.uuid4()),
            "type": "activity",
            "ts": now_ms - (i * 3600_000),
            "payload": {"minutes": 25.0, "activity": "workout", "verified": True}
        })
    
    print(f"\n========================================================")
    print(f"  KhelSetu Sync Benchmark ({num_batches} batches of {batch_size} events)")
    print(f"========================================================\n")
    
    start_time = time.perf_counter()
    latencies = []
    
    for b in range(num_batches):
        t0 = time.perf_counter()
        res = client.post("/api/sync", json={"events": events_payload}, headers=headers)
        t1 = time.perf_counter()
        latencies.append((t1 - t0) * 1000)
        assert res.status_code == 200
    
    total_time = time.perf_counter() - start_time
    total_events = num_batches * batch_size
    throughput_reqs = num_batches / total_time
    throughput_events = total_events / total_time
    avg_latency = sum(latencies) / len(latencies)
    p95_latency = sorted(latencies)[int(len(latencies) * 0.95)]
    
    print(f"Total Time:          {total_time:.3f} s")
    print(f"Total Events Ingested: {total_events}")
    print(f"Throughput:          {throughput_reqs:.1f} req/s ({throughput_events:.1f} events/s)")
    print(f"Average Latency:     {avg_latency:.2f} ms")
    print(f"P95 Latency:         {p95_latency:.2f} ms")
    print(f"Engine:              FastAPI + SQLite (sync)")
    print(f"\n[MEASURED RESULT]: Quoted in docs/HONEST_CLAIMS.md\n")

if __name__ == "__main__":
    benchmark_ingestion()
