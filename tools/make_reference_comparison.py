#!/usr/bin/env python3
"""Round-7 visual self-audit board.

LEFT  = "REFERENCE TARGET — anatomical 2.5D human dentition": the authoritative
        written spec (original reference file unavailable in this sandbox —
        this is explicitly NOT a pixel comparison).
RIGHT = the current rendered Odontogram at HEAD.

Usage: python3 tools/make_reference_comparison.py [--out tools/preview/reference-comparison.png]
"""
import argparse
from PIL import Image, ImageDraw, ImageFont

SPEC = [
    "realistic human tooth proportions",
    "organic crown silhouettes (no icon geometry)",
    "smooth continuous enamel shading",
    "sculpted cusp anatomy (continuous surfaces)",
    "recessed occlusal grooves / fossae",
    "substantial anatomical roots",
    "realistic root taper and curvature",
    "natural crown-to-root transition",
    "subtle 2.5D highlights and shadows",
    "no flat icon appearance",
    "no isolated \u201cspot\u201d highlights",
]


def font(size: int, bold: bool = False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    try:
        return ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/{name}", size)
    except OSError:
        return ImageFont.load_default()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cur", default="tools/preview/arch-healthy.png")
    ap.add_argument("--out", default="tools/preview/reference-comparison.png")
    args = ap.parse_args()

    W, H = 2480, 1440
    board = Image.new("RGB", (W, H), "#FFFFFF")
    d = ImageDraw.Draw(board)

    lw = 1000  # left panel width
    gutter = 36
    cur = Image.open(args.cur).convert("RGB")
    panel_h = H - 150
    panel_w = W - 24 - (24 + lw + gutter)
    scale = min(panel_h / cur.height, panel_w / cur.width)
    cur_s = cur.resize((round(cur.width * scale), round(cur.height * scale)), Image.LANCZOS)

    # headers
    d.rectangle([0, 0, W, 64], fill="#0F172A")
    d.text((24, 16), "ROUND 7 — VISUAL SELF-AUDIT  (benchmark = written spec; NOT a pixel comparison)",
           font=font(28, True), fill="#FFFFFF")

    # LEFT: spec card
    x0, y0 = 24, 96
    d.rounded_rectangle([x0, y0, x0 + lw, y0 + panel_h], radius=18, outline="#94A3B8", width=3)
    d.text((x0 + 28, y0 + 26), "REFERENCE TARGET", font=font(40, True), fill="#0F172A")
    d.text((x0 + 28, y0 + 80), "anatomical 2.5D human dentition", font=font(30, True), fill="#334155")
    ty = y0 + 150
    for item in SPEC:
        d.ellipse([x0 + 34, ty + 10, x0 + 44, ty + 20], fill="#B45309")
        d.text((x0 + 60, ty), item, font=font(27), fill="#1F2937")
        ty += 52
    d.text((x0 + 28, y0 + panel_h - 130), "Original reference file unavailable in sandbox.",
           font=font(23), fill="#64748B")
    d.text((x0 + 28, y0 + panel_h - 96), "This panel restates the authoritative written spec;",
           font=font(23), fill="#64748B")
    d.text((x0 + 28, y0 + panel_h - 62), "audit below is a self-assessment against it.",
           font=font(23), fill="#64748B")

    # RIGHT: current render
    xr = x0 + lw + gutter
    d.rounded_rectangle([xr, y0, W - 24, y0 + panel_h], radius=18, outline="#0F766E", width=3)
    ix = xr + ((W - 24 - xr - cur_s.width) // 2)
    board.paste(cur_s, (ix, y0 + 12))
    d.text((xr + 24, y0 + panel_h - 44), "CURRENT @ HEAD — rendered ToothSVG markup (resvg)",
           font=font(26, True), fill="#0F766E")

    board.save(args.out)
    print(f"wrote {args.out} size={board.size}")


if __name__ == "__main__":
    main()
