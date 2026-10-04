import io
import os
import uuid

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps

app = FastAPI(title="Pixel AI Backend", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")
FIX_DIR = os.path.join(OUTPUT_DIR, "fix_batch")
STYLE_DIR = os.path.join(OUTPUT_DIR, "reference_style")
for d in (FIX_DIR, STYLE_DIR):
    os.makedirs(d, exist_ok=True)

app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")


async def open_image(upload: UploadFile):
    """Upload ko memory me khol kar RGB image (EXIF rotation ke saath) deta hai."""
    try:
        img = Image.open(io.BytesIO(await upload.read()))
        return ImageOps.exif_transpose(img).convert("RGB")
    except Exception:
        return None


def average_color(img: Image.Image):
    r, g, b = img.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    return r, g, b


@app.get("/")
def home():
    return {"status": "success", "message": "Pixel AI Backend is running"}


@app.get("/health")
def health():
    return {"status": "healthy", "service": "Pixel AI"}


@app.post("/image-info")
async def image_info(file: UploadFile = File(...)):
    img = Image.open(io.BytesIO(await file.read()))
    return {"filename": file.filename, "width": img.width, "height": img.height,
            "format": img.format, "mode": img.mode}


@app.post("/fix-batch/analyze")
async def analyze_batch(files: list[UploadFile] = File(...)):
    sizes, dims = [], set()
    for f in files:
        img = await open_image(f)
        if img:
            sizes.append(img.size)
            dims.add(img.size)

    improvements = []
    if len(dims) > 1:
        improvements.append({"type": "dimensions", "title": "Inconsistent dimensions",
                             "description": f"{len(dims)} different sizes found in the batch.",
                             "severity": "high"})
    ratios = {round(w / h, 1) for w, h in sizes}
    if len(ratios) > 1:
        improvements.append({"type": "crop", "title": "Crop consistency",
                             "description": "Aspect ratios differ, images need consistent cropping.",
                             "severity": "medium"})
    if len(sizes) >= 2:
        improvements.append({"type": "alignment", "title": "Visual alignment",
                             "description": "Images will be centered on a common canvas.",
                             "severity": "medium"})
    improvements.append({"type": "background", "title": "Background consistency",
                         "description": "Background will be standardized to white.",
                         "severity": "low"})

    return {"success": True, "imagesAnalyzed": len(sizes), "improvements": improvements,
            "improvementCount": len(improvements),
            "message": f"{len(improvements)} improvements found"}


@app.post("/fix-batch/fix")
async def fix_batch(files: list[UploadFile] = File(...)):
    target, results = 1000, []
    for f in files:
        img = await open_image(f)
        if not img:
            continue
        img.thumbnail((target, target), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (target, target), "white")
        canvas.paste(img, ((target - img.width) // 2, (target - img.height) // 2))
        name = f"{uuid.uuid4().hex}.jpg"
        canvas.save(os.path.join(FIX_DIR, name), "JPEG", quality=95)
        results.append({"originalName": f.filename, "outputUrl": f"/outputs/fix_batch/{name}"})

    return {"success": True, "consistencyScore": 96, "processedImages": len(results),
            "results": results, "message": "Batch fixed successfully"}


@app.post("/reference-style/analyze-style")
async def analyze_reference_style(reference: UploadFile = File(...)):
    img = await open_image(reference)
    if not img:
        return {"success": False, "message": "Invalid image"}
    r, g, b = average_color(img)
    brightness = (r + g + b) // 3
    tone = "Bright" if brightness > 180 else "Balanced" if brightness > 110 else "Dark"
    return {"success": True, "style": {
        "tone": tone, "averageColor": {"r": r, "g": g, "b": b},
        "width": img.width, "height": img.height,
        "styleDNA": ["Color Tone", "Brightness", "Visual Balance", "Composition"]}}


@app.post("/reference-style/apply-reference-style")
async def apply_reference_style(reference: UploadFile = File(...),
                                images: list[UploadFile] = File(...)):
    ref = await open_image(reference)
    if not ref:
        return {"success": False, "message": "Invalid reference image", "results": []}
    tint_color = average_color(ref)

    results = []
    for f in images:
        img = await open_image(f)
        if not img:
            continue
        # 75% original + 25% reference color (fast, no per-pixel python loop)
        styled = Image.blend(img, Image.new("RGB", img.size, tint_color), 0.25)
        name = f"{uuid.uuid4().hex}.jpg"
        styled.save(os.path.join(STYLE_DIR, name), "JPEG", quality=95)
        results.append({"originalName": f.filename, "outputUrl": f"/outputs/reference_style/{name}"})

    return {"success": True, "processedImages": len(results), "results": results}
