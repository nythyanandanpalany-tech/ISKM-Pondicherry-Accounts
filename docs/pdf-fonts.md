# The report PDF, and the fonts it embeds

`lib/pdf.ts` builds the daily seva report as a genuine PDF — vector text and shapes laid out
page by page, not a screenshot of the screen. Everything in the file is selectable, searchable,
copyable into an email, readable by a screen reader, and sharp at any zoom or paper size.

## Why fonts had to be embedded

jsPDF's fourteen built-in faces are WinAnsi-encoded. WinAnsi has no **₹** (U+20B9), and none of
the Sanskrit transliteration the app uses — `Prasādam`, `Pūjā`, `abhiṣeka`, `Śrīla Prabhupāda`.
Any of those would have come out as a blank box or the wrong letter on a document the temple
files as a record. So three subsetted faces ship in `public/fonts/` and are embedded in each
PDF instead:

| File | Used for |
| --- | --- |
| `NotoSans-Regular.ttf` | body text, notes, footers, the `॥ Hare Krishna ॥` ornament |
| `NotoSans-SemiBold.ttf` | amounts, totals, member subtotals |
| `NotoSerif-Bold.ttf` | the registered name on the letterhead and the section headings |

They are fetched on the first click of **Download PDF** and cached for the session, and
`lib/pdf.ts` itself is imported dynamically — so neither the generator nor ~150 kB of fonts
costs anything on first paint. `lib/tests/pdf.test.mjs` fails if a file goes missing or a
glyph the report needs is not in the subset.

Noto Serif rather than Martel (the app's display face on screen) for one reason: Martel has no
dot-below diacritics, so a centre that put `Śrī` or `Ṭhākura` in `lib/brand.ts` would get
blanks on its own letterhead. Noto Serif covers the whole set.

## Why the ornament is romanised

The screen shows `॥ हरे कृष्ण ॥`. A PDF has no text shaper: Devanagari needs conjuncts and
reordered matras that only a shaping engine can form, and jsPDF draws glyphs in code-point
order, so `कृष्ण` would come out visibly wrong. The PDF therefore sets the double dandas —
which need no shaping — around `brand.greeting` in Latin. Latin diacritics are fine anywhere
else in the document, because they are precomposed single code points.

## Rebuilding the subsets

Only needed if the report starts using characters outside the ranges below.

```bash
python3 -m pip install --user fonttools brotli
python3 scripts/build-pdf-fonts.py
```

The script downloads the upstream Noto variable fonts from `github.com/google/fonts`, pins each
to one weight, and strips everything but Basic Latin, Latin-1 Supplement, Latin Extended-A,
Latin Extended Additional, the common dashes and quotes, the currency symbols (₹ among them)
and the two dandas. That takes ~2 MB of variable font down to ~46 kB a face.

Both families are SIL Open Font License 1.1; `public/fonts/OFL.txt` is the licence, and it has
to stay next to them.
