# The face detector

`blaze_face_full_range.onnx` is Google's MediaPipe BlazeFace full-range model (Apache-2.0; Google's model card says it
was trained on Google's own data), converted from TFLite to ONNX so one engine runs it in the helper and the browser.
It is a modified work under the Apache License: see NOTICE at the repository root for its source, checksums and how it
was converted. `packages/api/src/catalog/face-detect.ts` reads it (boxes only; the facial points it computes are never
read). Plan and licence rule: cf-dam-docs `plans/PLAN-FN2-v2.md`, spike `research/SPIKE-FN0.md`.

To convert again (same result to within 1e-4 of the TFLite original):

    python3 -m venv .venv && .venv/bin/pip install tensorflow-cpu==2.16.2 tf2onnx==1.16.1 onnx==1.16.2 "numpy<2"
    curl -LO https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite
    .venv/bin/python -m tf2onnx.convert --tflite blaze_face_full_range.tflite --output blaze_face_full_range.onnx --opset 17

A new model or setting needs a new `FACE_MODEL` id (`face-detect.ts`), which makes cf-dam look at every photo again.
