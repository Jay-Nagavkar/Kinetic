# KhelSetu: Landmark Trace Schema

To benchmark and validate the computer vision engine without storing or streaming raw video pixels, KhelSetu records only timestamped landmark sequences.

---

## JSON Trace Schema

```json
{
  "version": "1.0",
  "source": "volunteer" | "synthetic",
  "device": {
    "model": "Redmi Note 11" | "Pixel 7" | "iPhone 13" | "Simulated",
    "tier": "low" | "mid" | "flagship",
    "browser": "Chrome 128" | "Safari 17"
  },
  "exercise": "squat" | "pushup" | "balance",
  "ground_truth": {
    "reps": 14,
    "valid_reps": 12,
    "rejected_reps": 2,
    "hold_duration_ms": 15400,
    "inflections_ms": [2300, 4500, 6800, 9100, 11400]
  },
  "environment": {
    "lighting": "daylight" | "indoor_tube" | "low_light",
    "clothing": "fitted" | "loose_tshirt" | "traditional",
    "camera_view": "side" | "front" | "diagonal"
  },
  "frames": [
    {
      "t": 0,
      "aspect": 1.333,
      "poses": 1,
      "landmarks": [
        { "x": 0.52, "y": 0.24, "z": -0.12, "visibility": 0.98 },
        "..."
      ],
      "world_landmarks": [
        { "x": 0.05, "y": -0.42, "z": -0.10, "visibility": 0.98 },
        "..."
      ]
    }
  ]
}
```

*Note*: Pixels are never captured or saved. Only geometric point vectors ($x, y, z, \text{visibility}$) are stored in trace files.
