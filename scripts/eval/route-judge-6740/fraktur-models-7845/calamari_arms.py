# PRIOR ART: none for Calamari in this repo (git grep calamari: only the #7845 survey and bench notes) — the line crops
# come from kraken_arms.py segment, so every Calamari arm reads exactly the lines the Kraken arms read (S1).
"""#7845: Calamari 2.3.1 over the stored S1 line crops, the model's checkpoints voting (calamari's default voter).
Run with the job's Calamari venv (`venv-calamari/bin/python -I`, tensorflow-cpu 2.15.1).

  calamari_arms.py --out=DIR --ids=FILE --model-dir=DIR --arm=NAME [--threads=8]
      reads DIR/lines/S1/<id>/*.png, writes DIR/arms/<arm>/<id>.txt and DIR/arms/<arm>/timing.jsonl

tfaip's data pipeline spawns worker processes, so everything runs under the __main__ guard (without it each worker
re-runs the script and the job never ends). One pipeline process keeps the lines in input order.
"""
import glob, json, os, sys, time


def main():
    args = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
    threads = int(args.get('threads', 8))
    os.environ['CUDA_VISIBLE_DEVICES'] = ''
    os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
    import numpy as np
    import tensorflow as tf
    tf.config.threading.set_intra_op_parallelism_threads(threads)
    tf.config.threading.set_inter_op_parallelism_threads(2)
    from PIL import Image
    from calamari_ocr.ocr.predict.predictor import MultiPredictor, PredictorParams

    out, arm = args['out'], args['arm']
    ids = [l.strip() for l in open(args['ids']) if l.strip()]
    ckpts = sorted(glob.glob(os.path.join(args['model-dir'], '*.ckpt.json')))
    assert ckpts, 'no checkpoints'
    pp = PredictorParams(silent=True, progress_bar=False)
    pp.device.gpus = []
    pp.pipeline.num_processes = 1
    pp.pipeline.batch_size = 16
    pred = MultiPredictor.from_paths(checkpoints=ckpts, predictor_params=pp)
    d = os.path.join(out, 'arms', arm)
    os.makedirs(d, exist_ok=True)
    for i in ids:
        f = os.path.join(d, f'{i}.txt')
        if os.path.exists(f):
            continue
        files = sorted(glob.glob(os.path.join(out, 'lines', args.get('lines', 'S1'), i, '*.png')))
        t0 = time.time()
        texts = []
        if files:
            ims = [np.array(Image.open(p).convert('L')) for p in files]
            # outputs = (each checkpoint's prediction, the voted prediction); yielded in input order
            texts = [s.outputs[1].sentence for s in pred.predict_raw(ims)]
            assert len(texts) == len(files), f'{i}: {len(texts)} predictions for {len(files)} lines'
        secs = time.time() - t0
        open(f, 'w').write('\n'.join(t for t in texts if t.strip()) + '\n')
        with open(os.path.join(d, 'timing.jsonl'), 'a') as fh:
            fh.write(json.dumps({'id': i, 'lines': len(files), 'secs': round(secs, 2), 'checkpoints': len(ckpts)}) + '\n')
        print(arm, i, len(files), f'{secs:.1f}s', flush=True)


if __name__ == '__main__':
    main()
