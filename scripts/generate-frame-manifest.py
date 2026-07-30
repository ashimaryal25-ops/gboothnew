"""Generate src/data/frame-themes.ts from Chloe's frame PNGs in public/frames.

Slot rectangles are detected from the alpha channel: the photo windows are the
large fully-transparent regions. Run this after adding or replacing a frame.
"""
import json, os, sys
from PIL import Image
import numpy as np
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SINGLE = os.path.join(ROOT, "public/frames/single")
PRINT = os.path.join(ROOT, "public/frames/print")

# theme -> label, and per photo-count the source filenames.
# NOTE: two filenames are misnomers and were verified visually --
# frontend "baseball" is the FOOTBALL art, backend "softball" is the LACROSSE art.
THEMES = [
    ("animal",     "Animals",    {3: ("animal pic3.png", "backend-animal-3pic.png"),
                                  4: ("animal pic 4.png", "backend-animal-4pic.png")}),
    ("apple",      "Apple",      {2: ("apple sale pic2.png", "backend-apple-2pic.png"),
                                  3: ("apple pic3.png", "backend-apple-3pic.png"),
                                  4: ("apple sale pic 4.png", "backend-apple-4pic.png")}),
    ("basketball", "Basketball", {2: ("Basketball pic2.png", "backend-basketball-2pic.png"),
                                  3: ("basketball pic3.png", "backend-basketball-3pic.png"),
                                  4: ("basketball pic 4.png", "backend-basketball-4pic.png")}),
    ("brit",       "Pattern",    {2: ("Britan pattern2.png", "backend-brit-2pic.png"),
                                  3: ("brittan pattern 3.png", "backend-brit-3pic.png"),
                                  4: ("brittan pic4.png", "backend-brit-4pic.png")}),
    ("circuit",    "Circuit",    {2: ("circuit2.png", "backend-circuit-2pic.png"),
                                  3: ("circuit pic 3.png", "backend-circuit-3pic.png"),
                                  4: ("circuit pic4.png", "backend-circuit-4pic.png")}),
    ("doodle",     "Doodles",    {2: ("cute doodle pic2.png", "backend-doodle-2pic.png"),
                                  3: ("cute doodle pic3.png", "backend-doodle-3pic.png"),
                                  4: ("cute doodle pic 4.png", "backend-doodle-4pic.png")}),
    ("football",   "Football",   {2: ("baseball pic2.png", "backend-football-2pic.png"),
                                  3: ("baseball pic3.png", "backend-football-3pic.png"),
                                  4: ("baseball pic4.png", "backend-football-4pic.png")}),
    ("lacrosse",   "Lacrosse",   {2: ("lacrosse pic2.png", "backend-softball-2pic.png"),
                                  3: ("lacrosse pic3.png", "backend-softball-3pic.png"),
                                  4: ("lacrosse pic 4.png", "backend-softball-4pic.png")}),
    ("penhall",    "Penn Hall",  {2: ("penhall pic2.png", "backend-penhall-2pic.png"),
                                  3: ("pen hall 3 pic.png", "backend-penhall-3pic.png"),
                                  4: ("pen hall pic 4.png", "backend-penhall-4pic.png")}),
    ("picnic",     "Picnic",     {2: ("Picnic2.png", "backend-picnic-2pic.png"),
                                  3: ("picnic 3 strip.png", "backend-picnic-3pic.png"),
                                  4: ("picnic4pic.png", "backend-picnic-4pic.png")}),
    ("polka",      "Polka Dot",  {2: ("polkadot 2pic.png", "backend-polkadot-2pic.png"),
                                  3: ("polka dot pic3.png", "backend-polka-3pic.png"),
                                  4: ("polka dot4.png", "backend-polka-4pic.png")}),
    ("soccer",     "Soccer",     {2: ("soccer 2pic.png", "backend-soccer-2pic.png"),
                                  3: ("soccer pic3.png", "backend-soccer-3pic.png"),
                                  4: ("soccer pic 4.png", "backend-soccer-4pic.png")}),
    ("tech",       "Tech",       {2: ("tech2.png", "backend-tech-2pic.png"),
                                  3: ("tech pic3.png", "backend-tech-3pic.png"),
                                  4: ("tech pic4.png", "backend-tech-4pic.png")}),
    ("window",     "Windows",    {3: ("window pic3.png", "backend-window-3pic.png"),
                                  4: ("window pic 4.png", "backend-window-4pic.png")}),
]

MIN_AREA = 20000


def slots(path):
    """Large transparent regions = photo windows. Returns (w, h, [rect...])."""
    im = Image.open(path).convert("RGBA")
    alpha = np.array(im)[:, :, 3]
    lab, n = ndimage.label(alpha < 16)
    out = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(ys) < MIN_AREA:
            continue
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
        w, h = x1 - x0 + 1, y1 - y0 + 1
        if w < 100 or h < 100 or w > im.width * 0.95:
            continue  # skip edge bleed bands
        out.append({"x": x0, "y": y0, "w": w, "h": h})

    # Fully transparent rows/cols at each edge. Several exported sheets stop
    # short of the paper edge (every print sheet misses ~20px at the top; a
    # couple miss ~50px on the right). Left transparent they would print as
    # white slivers along the strip edges, so the renderer clamps the artwork
    # outward into these bands instead.
    trans_rows = (alpha < 16).all(axis=1)
    trans_cols = (alpha < 16).all(axis=0)

    def lead(v):
        i = 0
        while i < len(v) and v[i]:
            i += 1
        return int(i)

    edges = {
        "top": lead(trans_rows),
        "bottom": lead(trans_rows[::-1]),
        "left": lead(trans_cols),
        "right": lead(trans_cols[::-1]),
    }
    return im.width, im.height, out, edges


def main():
    entries, problems = [], []
    for key, label, variants in THEMES:
        for count in sorted(variants):
            sname, pname = variants[count]
            sp, pp = os.path.join(SINGLE, sname), os.path.join(PRINT, pname)
            if not os.path.exists(sp) or not os.path.exists(pp):
                problems.append(f"{key}/{count}: missing file")
                continue
            sw, sh, ss, sbleed = slots(sp)
            pw, ph, ps, pbleed = slots(pp)
            ss.sort(key=lambda r: r["y"])
            left = sorted([r for r in ps if r["x"] + r["w"] / 2 < pw / 2], key=lambda r: r["y"])
            right = sorted([r for r in ps if r["x"] + r["w"] / 2 >= pw / 2], key=lambda r: r["y"])
            if len(ss) != count or len(left) != count or len(right) != count:
                problems.append(
                    f"{key}/{count}: detected single={len(ss)} left={len(left)} right={len(right)} (want {count})"
                )
                continue
            entries.append({
                "key": key, "label": label, "photoCount": count,
                "single": {"src": f"/frames/single/{sname}", "w": sw, "h": sh,
                            "slots": ss, "bleed": sbleed},
                "print": {"src": f"/frames/print/{pname}", "w": pw, "h": ph,
                           "slots": {"left": left, "right": right}, "bleed": pbleed},
            })

    for p in problems:
        print("WARN", p, file=sys.stderr)

    body = json.dumps(entries, indent=2)
    ts = f"""// GENERATED by scripts/generate-frame-manifest.py -- do not edit by hand.
// Slot rects are detected from each PNG's alpha channel (the transparent photo windows).

export type FrameSlot = {{ x: number; y: number; w: number; h: number }};

/** Fully transparent rows/cols at each edge of the artwork; the renderer
 *  clamps the art outward into them so they don't print as white slivers. */
export type FrameBleed = {{ top: number; bottom: number; left: number; right: number }};

export type FrameTheme = {{
  key: string;
  label: string;
  photoCount: number;
  single: {{ src: string; w: number; h: number; slots: FrameSlot[]; bleed: FrameBleed }};
  print: {{
    src: string;
    w: number;
    h: number;
    slots: {{ left: FrameSlot[]; right: FrameSlot[] }};
    bleed: FrameBleed;
  }};
}};

export const FRAME_THEMES: FrameTheme[] = {body};

export function framesForCount(count: number): FrameTheme[] {{
  return FRAME_THEMES.filter((t) => t.photoCount === count);
}}

export function findFrame(key: string, count: number): FrameTheme | undefined {{
  return FRAME_THEMES.find((t) => t.key === key && t.photoCount === count);
}}
"""
    dest = os.path.join(ROOT, "src/data/frame-themes.ts")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"wrote {dest}: {len(entries)} variants, {len(problems)} problems")


if __name__ == "__main__":
    main()
