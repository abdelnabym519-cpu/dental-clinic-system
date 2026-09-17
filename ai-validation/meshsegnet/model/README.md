# model/

**No model binary is committed to this repository.** Both archives are
git-ignored; download them with the official command below.

## The two official pretrained models

| Jaw | Official filename | Size (bytes) | SHA-256 |
| --- | --- | --- | --- |
| **Lower** (mandible) | `MeshSegNet_Man_15_classes_72samples_lr1e-2_best.zip` | 28,866,886 | `d74c87e0c1cbc47fcedcc6f8574c1ad484dd2e21a98cabfb3465a42a2760a0cf` |
| **Upper** (maxilla) | `MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip` | 28,860,102 | `727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d2` |

`Man` = mandible (lower jaw), `Max` = maxilla (upper jaw). Both are published by
the authors in the `models/` folder of the official repository and are committed
as ordinary git blobs — **not** as release assets, Git-LFS pointers, or external
downloads.

## Official source

```
https://github.com/Tai-Hsien/MeshSegNet
    └── models/MeshSegNet_Man_15_classes_72samples_lr1e-2_best.zip
    └── models/MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip
```

```powershell
python scripts\download_artifacts.py --models
```

The downloader fetches `codeload.github.com/Tai-Hsien/MeshSegNet/tar.gz/refs/heads/master`,
extracts exactly those two members, and verifies each against the SHA-256 above
before accepting it. A mismatch is a hard failure — no substitutes, ever.

## What is inside

Both files are **PyTorch `torch.save()` archives** (a zip container holding
`archive/data.pkl`), not plain zip-of-tar. The official `step5_predict.py`
refers to a `.tar` filename, which no longer matches what the repository ships;
load them directly with `torch.load()`.

| Field | Value |
| --- | --- |
| Framework | PyTorch — load with `torch.load(path, map_location="cpu")` |
| Top-level keys | `epoch`, `model_state_dict`, `optimizer_state_dict`, `losses`, `mdsc`, `msen` |
| `model_state_dict` entries | 151 |
| Output head | `output_conv.weight` shape `(15, 128, 1)` → **15 classes** |
| Parameters | 1,799,140 (≈7.2 MB fp32) |
| Trained epochs | 500 (`epoch = 499`) |
| Training data | 72 samples |

Roughly 21 MB of each 28.8 MB archive is `optimizer_state_dict`, which inference
does not need.

## Loading it

```python
import torch
from meshsegnet import MeshSegNet          # official architecture, unmodified

ckpt = torch.load("MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip", map_location="cpu")
model = MeshSegNet(num_classes=15, num_channels=15)
model.load_state_dict(ckpt["model_state_dict"])   # strict=True by default
model.eval()
```

`strict=True` succeeding with **0 missing and 0 unexpected keys** is the proof
that the artifact really is a MeshSegNet checkpoint for this architecture. Any
substitute, truncated download, or wrong-jaw file fails here.

## Licence

The MeshSegNet code and the published weights are released under the
**MIT License**, Copyright (c) 2020 Chunfeng Lian & Tai-Hsien Wu — see
`LICENSE` in the official repository. The archives are kept out of git and
downloaded on demand; see `../MODEL_PROVENANCE.md`.
