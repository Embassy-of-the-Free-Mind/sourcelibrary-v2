| arm | pass | items/h | s/item | peak VRAM MiB | notes |
|---|---|---|---|---|---|
| bge-m3 | full | 191086 |  | 2652 | {'dim': 1024, 'median_tokens': 893, 'torch_peak_reserved_mib': 2308} |
| bge-m3-2k | full | 111570 |  | 3614 | {'dim': 1024, 'median_tokens': 893, 'torch_peak_reserved_mib': 3270} |
| clip-b32 | full | 736358 |  | 802 | {'dim': 512, 'gpu_only_items_per_s': 3098.3, 'torch_peak_reserved_mib': 450} |
| dots-ocr | full | 725 | 4.965 | 20136 | {'errors': 0, 'mean_out_tok': 1926, 'hit_cap': 11, 'load_secs': 80} |
| dots-ocr | beside |  |  |  | {'not_run': 'server did not start at util 0.38'} |
| dots-ocr-tight | full | 998 | 3.609 | 9960 | {'errors': 0, 'mean_out_tok': 1645, 'hit_cap': 7, 'load_secs': 45} |
| dots-ocr-tight.fail-8k | full | 0 | 0.615 | 8382 | {'errors': 100, 'mean_out_tok': None, 'hit_cap': 0, 'load_secs': 45} |
| glm-ocr | full | 1462 | 2.462 | 21516 | {'errors': 0, 'mean_out_tok': 1177, 'hit_cap': 13, 'load_secs': 70} |
| glm-ocr | beside | 1295 | 2.78 | 10710 | {'errors': 0, 'mean_out_tok': 1179, 'hit_cap': 13, 'load_secs': 40} |
| glm-ocr@b30 | beside | 1232 | 2.921 | 8792 | {'errors': 0, 'mean_out_tok': 1139, 'hit_cap': 12, 'load_secs': 25} |
| ll-qwen25vl7b-awq | ll-img | 1541 | 2.336 | 20160 | {'errors': 0, 'mean_out_tok': None, 'hit_cap': 0} |
| ll-qwen25vl7b-awq | ll-text | 10249 | 0.351 | 20160 | {'errors': 0, 'mean_out_tok': None, 'hit_cap': 0} |
| mineru25-pro | full | 3488 | 1.032 | 20164 | {'errors': 0, 'mean_out_tok': None, 'hit_cap': 0, 'load_secs': 135} |
| mineru25-pro | beside | 3410 | 1.056 | 9026 | {'errors': 0, 'mean_out_tok': None, 'hit_cap': 0, 'load_secs': 30} |
| olmocr2-fp8 | full | 1092 | 3.297 | 20656 | {'errors': 0, 'mean_out_tok': 677, 'hit_cap': 0, 'load_secs': 70} |
| olmocr2-fp8 | beside |  |  |  | {'not_run': 'server did not start at util 0.38'} |
| olmocr2-fp8-tight | full |  |  |  | {'not_run': 'server did not start at util 0.38'} |
| paddle-vl | layout0 | 3715 |  | 9448 | {'errors': 0} |
| paddle-vl | layout1 | 3163 |  | 16904 | {'errors': 0} |
| paddle-vl@b33 | layout0 | 3589 |  | 5380 | {'errors': 0} |
| qwen25vl7b-awq | full | 853 | 4.222 | 20494 | {'errors': 0, 'mean_out_tok': 1126, 'hit_cap': 13, 'load_secs': 160} |
| qwen25vl7b-awq | beside |  |  |  | {'not_run': 'server did not start at util 0.38'} |
| qwen25vl7b-awq-tight | full | 849 | 4.243 | 10278 | {'errors': 0, 'mean_out_tok': 1150, 'hit_cap': 15, 'load_secs': 55} |
| qwen25vl7b-awq-tight.fail-nocap | full |  |  |  | {'not_run': 'server did not start at util 0.38'} |
| qwen3-14b-awq | full | 5644 | 0.638 | 19488 | {'errors': 0, 'mean_out_tok': 22, 'hit_cap': 0, 'load_secs': 75} |
| qwen3-14b-awq | beside |  |  |  | {'not_run': 'server did not start at util 0.38'} |
| qwen3-8b-awq | full | 11004 | 0.327 | 19768 | {'errors': 0, 'mean_out_tok': 36, 'hit_cap': 0, 'load_secs': 160} |
| qwen3-8b-awq | beside | 10384 | 0.347 | 9522 | {'errors': 0, 'mean_out_tok': 35, 'hit_cap': 0, 'load_secs': 35} |
| qwen3-8b-awq@b30 | beside |  |  |  | {'not_run': 'server did not start at util 0.30'} |
| qwen3-8b-awq@b34 | beside |  |  |  | {'not_run': 'server did not start at util 0.34'} |
| qwen3-8b-awq@b36 | beside | 8725 | 0.413 | 8012 | {'errors': 1, 'mean_out_tok': 36, 'hit_cap': 0, 'load_secs': 60} |
| qwen3-emb-0.6b | full | 83886 |  | 6534 | {'dim': 1024, 'median_tokens': 791, 'torch_peak_reserved_mib': 6188} |
| qwen3-emb-0.6b-2k | full | 46919 |  | 11880 | {'dim': 1024, 'median_tokens': 791, 'torch_peak_reserved_mib': 11534} |
| qwen3-emb-4b | full | 18737 |  | 17182 | {'dim': 2560, 'median_tokens': 791, 'torch_peak_reserved_mib': 16836} |
| qwen3-emb-4b-2k | full | 13370 |  | 12994 | {'dim': 2560, 'median_tokens': 791, 'torch_peak_reserved_mib': 12648} |
| siglip2-base | full | 789919 |  | 1432 | {'dim': 768, 'gpu_only_items_per_s': 844.0, 'torch_peak_reserved_mib': 1080} |
| siglip2-so400m | full | 150212 |  | 4164 | {'dim': 1152, 'gpu_only_items_per_s': 45.1, 'torch_peak_reserved_mib': 3812} |
