---
stage: ocr
measure: none
languages: [mn]
scripts: [Mong]
canons: [mongolian-kanjur]
n_books: 5
n_pages: 5
verdict: "Gate 1 fails: IMU-MnOCR is not downloadable to us (application + signed agreement, free only to universities and research institutes, no third-party dissemination), and its real lines are modern typeset prose, not woodblock; its training half is text only."
status: undecided
decision: "No GPU training started. Whether to apply to IMU, or to commission Kanjur line ground truth instead, is Derek's call (#5664, #6871 row 6)"
superseded_by: null
issue: [5664, 6871]
---
## 2026-10-18 · Does the Inner Mongolia University line dataset give a Mongolian Kanjur reader something to train on? (#5664)

PRIOR ART: `2026-10-04-mongol-kanjur-ocr-probe-5664.md` and `2026-10-16-mongol-kanjur-argon-opus-probe-5664.md` (no engine reads the Kanjur; their 10 pages and `pages.json` reused here); the 2026-10-04 desk research on #5664 and the 2026-10-17 research comment on #6871 (the IMU lead). No earlier entry in this log looks at the IMU data itself.

**Answer: no, and the gate fails before any GPU work.** This is step 1 of the #6871 row 6 plan: data, then a frozen Kanjur set, then a LoRA. It stops here, as the brief says.

**What the dataset is.** The paper is Bai, Wang, Zhang, Bao, Wei and Gao, *Segmentation-free Traditional Mongolian OCR and its Public Dataset*, Data Intelligence (2025), doi:10.3724/2096-7004.di.2025.0046. I read it in full. The dataset is **IMU-MnOCR**, distributed through the lab's portal (mglip.com/corpus, corpus id 20230513094533). Three facts change the plan:
- **Only the 10,000 test lines come with images.** The 80,000 training lines are released as **text only** (`train/corpus.txt`), "used for image generation". The paper's own models train on synthetic renders of that text. So IMU gives no real *training* images at all. It gives a modern-print test set and a modern-prose text corpus.
- **The real lines come from "over 200 Mongolian books covering various themes",** keyed by 20 typists. They are modern Inner Mongolian publications.
- **The synthesis code is not public.** The repository the paper cites, `github.com/IMU-M-Lab/MnOCR-baseline`, returns 404. The org has one other repo (speech).

**What blocks the download.** There is no download link. The portal's detail page has a form with these fields: name, phone, e-mail, affiliation, reasons, an introduction, and an uploaded PDF of the signed 《协议》 ("Agreement"), posted to `182.42.92.12:81/uploadAgreement`. The only public file is a sample zip (`/static/samples/20230513094533.zip`, 282 KB): 9 corpus lines, 10 test-line images with labels, and the terms. Applying means signing an agreement for the organisation. That is outward-facing and binding, so I did not apply. A draft e-mail is below.

**Licence, verbatim** (`资源说明.txt` in the sample, §四 Terms; the Chinese is authoritative under term 6):

> 1、该语料库资源不用于商业目的。
> 2、不将语料库内容扩散给第三方。
> 3、在发表论文和申报成果时须声明"使用了蒙古文智能信息处理技术国家地方联合工程研究中心、内蒙古自治区蒙古文信息处理技术重点实验室的内蒙古大学印刷蒙古文识别语料库(IMU-MnOCR)"，并且发信给csfeilong@imu.edu.cn,说明发表论文题目，出处等情况； 若本页已注明"论文引用",则必须在您的文章中引用我们列出的论文。
> 4、本语料库最终解释权归蒙古文智能信息处理技术国家地方联合工程研究中心、内蒙古自治区蒙古文信息处理技术重点实验室所有。
> 5、本实验室共享资源的完整数据和程序库的完整版本只免费提供给"高校和科研院所"用于科学研究，对于独立个人或者商业公司的申请恕不免费提供。
> 6、条款如有变更，以最新网络版本为准。
>
> 1. This corpus resource is not used for commercial purposes.
> 2. Do not disseminate corpus content to third parties.
> 3. When publishing the paper and applying for the results, it is necessary to declare that "Inner Mongolia University Printed Mongolian Text Recognition Corpus(IMU-MnOCR) of National & Local Joint Engineering Research Center of Intelligent Information Processing Technology for Mongolian and Inner Mongolia Key Laboratory of Mongolian Information Processing Technology was used", and send a letter to csfeilong@imu.edu.cn, stating the title of the published paper , source, etc.; If "Citation" is indicated on this page, you must cite the paper we list in your article.
> 4. The final interpretation right of this corpus belongs to National & Local Joint Engineering Research Center of Intelligent Information Processing Technology for Mongolian and Inner Mongolia Key Laboratory of Mongolian Information Processing Technology.
> 5. The complete data and the complete version of the program library of the shared resources of this laboratory are only provided free of charge to "universities and research institutes" for scientific research, and are not provided free of charge for applications by independent individuals or commercial companies.
> 6. If the terms are changed, the latest online version shall prevail.

Three consequences for us:
- Term 5: Source Library is neither a university nor a research institute, so free access is not assured.
- Term 2: no sample image or line is committed here, because this repo is public.
- Terms 1–2 together: a model trained on IMU data and then run as a production lane is outside "research". That would be Derek's call.

**By eye: the 10 public real lines beside 5 Kanjur pages.** Only 10 real lines are public, not the 20 the brief asked for. The Kanjur pages are v001 f280a, v047 f193a, v049 f2a (a decorated opening), v077 f392a and v098 f3a, at full resolution, with column crops contrast-stretched and turned to the IMU line orientation.

| | IMU-MnOCR real lines | Mongolian Kanjur (Beijing, 1720) |
|---|---|---|
| script | Uyghur-Mongol (Uchin), shaped Unicode | same script; same letter skeletons and tail direction once rotated |
| print | modern books, a uniform digital typeface | carved woodblock in calligraphic style: long thin tail swashes, heavy spine, wide word gaps |
| ink / ground | black on white, high contrast, near-binary | mostly red (cinnabar) ink on toned, stained paper, low contrast |
| layout | single cropped lines, already rotated | 22–31 vertical columns a side inside ruled frames, with a Chinese margin; needs column segmentation |
| content | modern prose: dialogue, place names, a footnote marker ①, 《》, —, ( ), ? | 18th-century Buddhist translation idiom; `::` punctuation and ❖ ornaments |
| orthography | modern Inner Mongolian standard Unicode spelling | classical; Galik letters expected for Sanskrit and Tibetan names (not confirmed by eye on these 5 pages) |

**Gate 1: fails.** The script is the same, but the real lines are not Kanjur-like print. They differ in typeface, ink, contrast, layout and register, so they cannot stand in for the Kanjur in training or in evaluation. They would only measure how a model does on modern books. The 80K training lines are modern prose with no images, so training on them means synthetic rendering either way. For synthetic rendering, an open text corpus and an open font serve as well as IMU's corpus, without the licence.

**What would move this forward.** These are suggestions; none was run.
1. **Real Kanjur lines.** About 10 pages (≈300 columns) transcribed by a Mongolist. This is the 2026-10-04 recommendation again. Those lines are the only evaluation that measures the target, and the seed set a LoRA needs. Synthetic lines only add to them.
2. **IMU's 2011 Kanjur word-spotting set,** about 5,500 word images from this same print tradition. It was cited in the 2026-10-04 desk research and is not verified to exist publicly. It is the one IMU asset that resembles the target, so the e-mail below asks for it first.
3. **A synthetic-only trial**, the ManchuAI-OCR recipe: render open Classical Mongolian Unicode text in an open font with woodblock-style degradation. This works only if (1) or a frozen meaning-check set exists to score it. Without real lines, any score would be against our own renders.

**Draft e-mail (not sent; sending it is Derek's call):**

> To: csfeilong@imu.edu.cn
> Subject: IMU-MnOCR and Kanjur word images — a request from Source Library (non-profit digital library)
>
> Dear Professor Bao,
>
> I write from Source Library (sourcelibrary.org), a non-profit digital library of historical primary sources run with the Embassy of the Free Mind in Amsterdam. We hold scans of the complete 1720 Beijing woodblock Mongolian Kanjur (108 volumes, from BDRC, W4CZ5370) and would like to make it readable. No current OCR system reads it.
>
> We read your Data Intelligence paper on segmentation-free traditional Mongolian OCR and the IMU-MnOCR terms with interest. Two questions:
>
> 1. Your group's earlier work on word spotting in the Mongolian Kanjur used about 5,500 word images. Are those images and labels, or any line-level ground truth from Kanjur or other woodblock prints, available for research use?
> 2. We are a non-profit library, not a university. Can we apply for IMU-MnOCR under the published terms? Would a recogniser trained with it be usable for non-commercial publication of transcriptions of the Kanjur? We would of course cite the corpus and your paper.
>
> We would gladly share our Kanjur folio identifications, text-to-volume mapping and any results with your group.
>
> With thanks and best regards,
> [name], Source Library

**Spend:** $0. Web, the paper PDF and the public sample only. **No GPU used, nothing written to Mongo or any production store.** The sample zip and comparison crops stay in job scratch (`/mnt/HC_Volume_105839809/jobs/mongol-reader-5664/`) and are not committed, under term 2.

*Replicated?* Not applicable: a desk check and a by-eye comparison, not a measurement.
