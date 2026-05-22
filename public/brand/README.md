# Source Library Brand Kit

Generated 2026-05-19

## Configurations

| Name | Description |
|------|-------------|
| `logo-full` | Full logo: icon + wordmark |
| `logo-full-beta` | Full logo with Beta superscript (matches live site header) |
| `logo-compact` | Compact logo: icon + wordmark, tighter |
| `icon-only` | Icon only: concentric circles |
| `wordmark-only` | Wordmark only: SOURCELIBRARY text |
| `logo-stacked` | Stacked: icon above wordmark |

## Color Schemes

| Name | Foreground | Background |
|------|-----------|------------|
| `white-on-dark` | white | #1a1612 |
| `black-on-white` | #1a1612 | white |
| `white-on-transparent` | white | transparent |
| `black-on-transparent` | #1a1612 | transparent |

## SVG Files (12)

Vector outlines, font-independent.

- `svg/logo-full--white-on-dark.svg`
- `svg/logo-full--black-on-white.svg`
- `svg/logo-full-beta--white-on-dark.svg`
- `svg/logo-full-beta--black-on-white.svg`
- `svg/logo-compact--white-on-dark.svg`
- `svg/logo-compact--black-on-white.svg`
- `svg/icon-only--white-on-dark.svg`
- `svg/icon-only--black-on-white.svg`
- `svg/wordmark-only--white-on-dark.svg`
- `svg/wordmark-only--black-on-white.svg`
- `svg/logo-stacked--white-on-dark.svg`
- `svg/logo-stacked--black-on-white.svg`

## PNG Files (192)

Heights: 32, 48, 64, 96, 128, 192, 256, 512px. Naming: `{config}--{scheme}--{height}h.png`

## Quick Reference

| Use case | Recommended file |
|----------|-----------------|
| Website header (dark bg) | `svg/logo-full--white-on-dark.svg` |
| Website header (light bg) | `svg/logo-full--black-on-white.svg` |
| Beta-branded header (dark bg) | `svg/logo-full-beta--white-on-dark.svg` |
| Beta-branded header (light bg) | `svg/logo-full-beta--black-on-white.svg` |
| Favicon | `png/icon-only--black-on-white--32h.png` |
| Social media avatar | `png/icon-only--white-on-dark--512h.png` |
| Social media banner | `png/logo-full--white-on-dark--512h.png` |
| Print (dark bg) | `svg/logo-full--white-on-dark.svg` |
| Print (light bg) | `svg/logo-full--black-on-white.svg` |
| Watermark / overlay | `png/logo-full--white-on-transparent--256h.png` |
| Email signature | `png/logo-compact--black-on-transparent--48h.png` |
| App icon | `png/icon-only--white-on-dark--192h.png` |

## Brand Colors

Sourced from `src/app/globals.css` (CSS variables under `:root`).

### Neutrals

| Name | Hex | Variable | Usage |
|------|-----|----------|-------|
| Cream | `#fdfcf9` | `--bg-cream` | Primary page background |
| Warm | `#f5f0e8` | `--bg-warm` | Secondary surface (cards, panels) |
| Dark | `#1a1612` | `--bg-dark` / `--text-primary` | Dark backgrounds, primary text |
| White | `#ffffff` | — | Light text on dark, light surfaces |

### Accents

| Name | Hex | Variable | Usage |
|------|-----|----------|-------|
| Rust | `#9e4a3a` | `--accent-rust` | Primary CTA, links, key actions |
| Gold | `#c9a86c` | `--accent-gold` | Highlights, decorative emphasis |
| Gold (dark) | `#9e7c3c` | `--accent-gold-dark` | Gold on light backgrounds |
| Sage | `#8b9a7d` | `--accent-sage` | Secondary accents, success-adjacent |
| Sage (dark) | `#5e6d52` | `--accent-sage-dark` | Sage on light backgrounds |
| Violet | `#7c5db5` | `--accent-violet` | Special-case accent (rarely used) |

### Borders

| Name | Hex | Variable | Usage |
|------|-----|----------|-------|
| Border light | `#e8e4dc` | `--border-light` | Hairlines, subtle dividers |
| Border medium | `#d4cfc4` | `--border-medium` | Stronger dividers, card edges |

### Text

| Name | Hex | Variable | Usage |
|------|-----|----------|-------|
| Primary | `#1a1612` | `--text-primary` | Body, headings |
| Muted | `#6b6560` | `--text-muted` | Captions, secondary text (5.2:1 on cream) |
| Faint | `#8a8480` | `--text-faint` | Tertiary text (4.5:1 on cream) |

## Typography

The site uses four font families from Google Fonts, each with a distinct role.

| Role | Family | Variable | Weights | Used for |
|------|--------|----------|---------|----------|
| Sans | **Inter** | `--font-sans` | 300, 400, 500, 600 | UI, navigation, **logo**, buttons, headers |
| Body serif | **Newsreader** | `--font-body` | 400, 500, italic 400/500 (opsz 6–72) | Long-form reading prose, book pages |
| Display serif | **Cormorant Garamond** | `--font-serif` | 400, 500, 600 | Section headings, editorial display |
| Hero display | **Playfair Display** | `--font-display` | 400, 600, 700 | Top-of-page hero titles, large display |

### Logo wordmark specifics

- **Family**: Inter
- **"Source"**: weight 600 (semibold)
- **"Library"**: weight 300 (light)
- **"Beta"** (when shown): weight 300, 0.6em, normal case, tracking-normal, opacity 0.8, vertical offset −0.5em
- **Case**: uppercase
- **Tracking**: 0.05em (Tailwind `tracking-wider`)

### Script fonts (content, not brand)

Used inside the reader for non-Latin scripts; not part of brand identity:

- **Noto Naskh Arabic** / **Noto Sans Arabic** — Arabic text
- **Noto Sans Hebrew** / **Noto Rashi Hebrew** — Hebrew text
