
**Arm outputs are packed** one JSONL per arm (`arms/<arm>.jsonl`, one line `{file, data}` per page) so the PR stays under GitHub's 300-file diff limit. To run `negfix.mjs` or `report.mjs` again, unpack a file into `arms/<arm>/<file>` first.
