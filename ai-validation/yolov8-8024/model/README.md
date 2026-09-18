# `model/` — where the checkpoint goes

Put `8024.pt` here on the operator's machine:

```
ai-validation/yolov8-8024/model/8024.pt
```

- Download the audited revision only:
  `revision='0304179670f4838bf0dec1053b963112a16a66cf'`.
- Expected size: `143,955,443` bytes.
- Expected SHA-256:
  `e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98`.
- Run the gate before anything else:

  ```powershell
  python scripts\inspect_checkpoint.py --checkpoint model\8024.pt `
      --json-out reports\checkpoint_inspection.json --dis-out reports\checkpoint_ops.txt
  ```

The binary is ignored by `.gitignore` and must never be committed. This lab has **not**
downloaded it; until the gate runs on the operator's machine, the digest in the audit is the
hub's metadata value, not a locally computed one.
