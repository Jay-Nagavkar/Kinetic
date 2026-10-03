#!/usr/bin/env bash
# Downloads the MediaPipe Pose Landmarker (lite) model once, so the PWA can run fully offline afterwards.
set -euo pipefail
cd "$(dirname "$0")/../frontend/vendor/models"
URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
echo "Downloading pose_landmarker_lite.task ..."
curl -fL --retry 3 -o pose_landmarker_lite.task "$URL"
ls -lh pose_landmarker_lite.task
echo "Done. Hard-refresh the app once while online so the service worker caches it."
