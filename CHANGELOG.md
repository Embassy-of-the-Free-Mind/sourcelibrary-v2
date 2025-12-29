# Changelog

All notable changes to Source Library will be documented in this file.

## [Unreleased]

### Fixed
- **Gemini Batch API file upload** - Use `text/plain` MIME type as workaround for known Google API bug where `application/jsonl` returns malformed response missing the `file` key. See [googleapis/python-genai#1590](https://github.com/googleapis/python-genai/issues/1590)
- **Batch job status endpoint** - Use `/batches` endpoint instead of `/batchJobs` (404)
- **Batch state normalization** - Map `BATCH_STATE_*` to `JOB_STATE_*` for consistent status handling

## [2025-12-29]

### Added
- Image archiving and Gemini Batch API for OCR (50% cost savings)
- Script to sync book page counts

### Fixed
- Book page counts not updating after imports/processing

### Changed
- Search Source Library by question topic, not just author
- Include Source Library URLs in persona citations
