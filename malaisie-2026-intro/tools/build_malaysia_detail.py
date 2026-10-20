"""Regional detail texture for the Malay peninsula.

Blue Marble 4K colours (extrapolated across a crisp Natural Earth 10m coastline)
+ seeded fbm detail + relief. Output covers LON0..LON1, LAT0..LAT1 (equirectangular).
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

DAY, BUMP, LAND, OUT_COLOR, OUT_BUMP = sys.argv[1:6]
LON0, LON1, LAT0, LAT1 = 97.0, 107.0, -2.0, 9.0
PPD = 360  # pixels per degree
W, H = int((LON1 - LON0) * PPD), int((LAT1 - LAT0) * PPD)

def crop_global(path, mode):
    im = Image.open(path).convert(mode)
    gw, gh = im.size
    box = ((LON0 + 180) / 360 * gw, (90 - LAT1) / 180 * gh, (LON1 + 180) / 360 * gw, (90 - LAT0) / 180 * gh)
    return im.resize((W, H), Image.BICUBIC, box=box)

# --- crisp land mask from Natural Earth 10m ------------------------------------------
mask_img = Image.new("L", (W, H), 0)
draw = ImageDraw.Draw(mask_img)
to_px = lambda lon, lat: ((lon - LON0) * PPD, (LAT1 - lat) * PPD)
land = json.load(open(LAND))
for feat in land["features"]:
    geom = feat["geometry"]
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polys:
        ring = poly[0]
        lons = [p[0] for p in ring]; lats = [p[1] for p in ring]
        if max(lons) < LON0 or min(lons) > LON1 or max(lats) < LAT0 or min(lats) > LAT1:
            continue
        draw.polygon([to_px(*p) for p in ring], fill=255)
        for hole in poly[1:]:
            draw.polygon([to_px(*p) for p in hole], fill=0)
mask_soft = mask_img.filter(ImageFilter.GaussianBlur(1.2))
m = np.asarray(mask_soft, dtype=np.float32) / 255.0

# --- colours: extrapolate land/sea colours across the new coastline ------------------
day = np.asarray(crop_global(DAY, "RGB"), dtype=np.float32) / 255.0
# Classify the blurry Blue Marble pixels: water is blue-dominant.
is_water = ((day[..., 2] > day[..., 1] * 1.02) & (day[..., 2] > day[..., 0] * 1.15)).astype(np.float32)
def norm_blur(col, w, r):
    num = np.stack([np.asarray(Image.fromarray((col[..., c] * w * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), np.float32) for c in range(3)], -1)
    den = np.asarray(Image.fromarray((w * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), np.float32)[..., None]
    out = num / np.maximum(den, 1e-3)
    conf = np.clip(den[..., 0] / 255.0 * 8, 0, 1)
    return out, conf
land_w = (1 - is_water)
lb, lconf = norm_blur(day, land_w, 40)
lb = lb * lconf[..., None] + np.array([0.13, 0.26, 0.12], np.float32) * (1 - lconf[..., None])
land_col = day * land_w[..., None] + lb * (1 - land_w[..., None])
sb, sconf = norm_blur(day, is_water, 40)
sb = sb * sconf[..., None] + np.array([0.05, 0.22, 0.42], np.float32) * (1 - sconf[..., None])
sea_col = day * is_water[..., None] + sb * (1 - is_water[..., None])

# --- seeded value-noise fbm --------------------------------------------------------
rng = np.random.default_rng(2026)
def fbm(octaves, base, falloff=0.5):
    out = np.zeros((H, W), np.float32); amp = 1.0; tot = 0.0
    for o in range(octaves):
        n = base * 2 ** o
        g = rng.random((n + 1, int(n * W / H) + 1)).astype(np.float32)
        up = np.asarray(Image.fromarray(g, mode="F").resize((W, H), Image.BICUBIC), np.float32)
        out += amp * up; tot += amp; amp *= falloff
    return out / tot
n_large = fbm(4, 6)
n_fine = fbm(5, 48, 0.6)

# relief from global elevation (upsampled) + fine noise; ridges along the Titiwangsa range
elev = np.asarray(crop_global(BUMP, "L").filter(ImageFilter.GaussianBlur(6)), np.float32) / 255.0
relief = np.clip(elev * 1.6 + (n_fine - 0.5) * 0.35 * (0.3 + elev) + (n_large - 0.5) * 0.15, 0, 1) * m

# hillshade (light from the east, matching the morning sun)
gy, gx = np.gradient(relief * 60)
shade = np.clip(0.75 - gx * 0.9 + gy * 0.35, 0.35, 1.25)

jungle_dark = np.array([0.07, 0.17, 0.09], np.float32)
jungle_mid = np.array([0.16, 0.30, 0.13], np.float32)
lc = land_col * 0.55 + (jungle_dark + (jungle_mid - jungle_dark) * n_fine[..., None]) * 0.45
lc *= (0.85 + 0.3 * n_large)[..., None]
lc *= shade[..., None]

# shallow water near coasts
dist = np.asarray(mask_img.filter(ImageFilter.GaussianBlur(14)), np.float32) / 255.0
shallow = np.clip(dist * 2.2, 0, 1) * (1 - m)
sc = sea_col * (1 - shallow[..., None] * 0.6) + np.array([0.12, 0.42, 0.45], np.float32) * shallow[..., None] * 0.6
sc *= (0.95 + 0.1 * n_large)[..., None]

col = lc * m[..., None] + sc * (1 - m[..., None])
Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(OUT_COLOR, quality=90)
Image.fromarray((np.clip(relief, 0, 1) * 255).astype(np.uint8)).resize((W // 2, H // 2), Image.BILINEAR).save(OUT_BUMP, quality=90)
print(W, H)
