"""
Turns the owner's building photos into model input tensors for build-references.ts.
  python -I tools/recognition/prepare.py <photos dir> <out dir>
<photos dir> holds one folder per building, named as in labels.json. Each photo is cropped and
scaled exactly like the app does with a camera frame (the centre square, 224 px; see
src/services/scan/visualRecognizer.ts), normalised with the ImageNet mean/std and written as raw
float32 CHW. Byte-identical copies («photo (2).jpg») are skipped. Needs Pillow and numpy.
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image, ImageOps

SIZE = 224
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
items, seen = [], set()
for label in sorted(os.listdir(src)):
    folder = os.path.join(src, label)
    if not os.path.isdir(folder):
        continue
    for name in sorted(os.listdir(folder)):
        path = os.path.join(folder, name)
        raw = open(path, 'rb').read()
        digest = hashlib.sha1(raw).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        image = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
        w, h = image.size
        side = min(w, h)
        left, top = (w - side) // 2, (h - side) // 2
        square = image.crop((left, top, left + side, top + side)).resize((SIZE, SIZE), Image.BILINEAR)
        tensor = (np.asarray(square, dtype=np.float32) / 255 - MEAN) / STD
        file = f'{len(items):03d}.bin'
        tensor.transpose(2, 0, 1).astype(np.float32).tofile(os.path.join(out, file))
        items.append({'label': label, 'photo': name, 'tensor': file})

with open(os.path.join(out, 'items.json'), 'w', encoding='utf8') as f:
    json.dump(items, f, ensure_ascii=False, indent=1)
print(f'{len(items)} photos -> {out}')
