# input/

Put the panoramic X-ray(s) to analyse here.

Supported: `.png .jpg .jpeg .bmp .tif .tiff .webp`

    python ai-validation\liodon\scripts\run_liodon.py --input input\sample.png
    python ai-validation\liodon\scripts\run_liodon.py --input input\

Panoramic radiographs are wide (typically ~2:1 to 3:1). The runner letterboxes
them to 640x640 and maps boxes back to original pixel coordinates.

Notes
- All processing is local. Nothing is uploaded.
- Panoramic images can contain burned-in patient identifiers — check before
  sharing any output.
- `--input` is resolved relative to where you run the command. An absolute path
  is the least surprising thing to pass.
- `_synthetic_panoramic_test.png` may appear here if you run
  `scripts/make_standin_onnx.py`. It is a fabricated image for pipeline testing,
  not a radiograph, and it is git-ignored.
