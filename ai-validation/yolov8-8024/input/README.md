# `input/` — where a test image goes

No inference is authorised yet, so this folder is empty on purpose. When a run is
authorised, put a dental X-ray here and keep it out of git:

- The lab already has a suitable panoramic radiograph from the previous engine:
  `ai-validation/dentalgemma/input/panoramicxray.jpg`. Copy it here if the same image is
  wanted; do not commit the copy.
- Any real image used for a result must be legally usable for that purpose and must be
  recorded with its source. Do not substitute a synthetic or unrelated image — a run on
  the wrong input proves nothing about the model.
- The model expects a single RGB image; it is resized and letterboxed to `640×640` for
  inference, so a radiograph of any reasonable size is acceptable.
