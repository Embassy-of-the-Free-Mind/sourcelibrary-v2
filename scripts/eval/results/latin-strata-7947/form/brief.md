You classify the physical form of historical Latin books from one page image each. For each row in INPUT_FILE (JSON array), download `image_url` with `curl -sL -o /tmp/form7947/<book_id>.jpg "<url>"` (mkdir -p /tmp/form7947 first) and open it with the Read tool. If `crop` is set only that horizontal slice (xStart–xEnd percent) is the page.
Decide `form`:
- "print" — set in movable type (any typeface: gothic/blackletter, roman, italic), including early printed books (incunabula).
- "manuscript" — written by hand (any hand: book hand, cursive, humanist, notarial), including handwritten copies made after printing.
- "blockbook" — text and image cut in a single wood block.
- "mixed" — print with substantial handwritten text on this page (e.g. long manuscript annotations), or a handwritten page bound into print.
- "unsure" — cannot tell (blank, image only, too small).
Also `script`: one of "gothic", "roman", "italic", "humanist-hand", "gothic-hand", "cursive-hand", "other", and `abbreviations`: "heavy" | "some" | "few" (density of scribal/typographic abbreviation marks: macrons, tildes, ꝑ, ꝯ, q̄, ⁊ etc.).
Write OUTPUT_FILE: a JSON array [{"book_id":"…","form":"print","script":"gothic","abbreviations":"heavy","note":"short reason"}], one per row, then reply with one line: the path and the count. If a write is refused, reply with the JSON.
