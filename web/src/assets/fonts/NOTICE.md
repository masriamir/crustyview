# Third-party font

`px437-ibm-vga-9x16-subset.woff2` is a **subset** of **Web437 IBM VGA 9x16** from
[The Ultimate Oldschool PC Font Pack](https://int10h.org/oldschool-pc-fonts/) v2.2,
by **VileR**.

- **Copyright** (c) 2016–2020 VileR
- **License:** [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)

## Modification

This file has been **modified**: the glyph set was subset to the ten letters of the
`crustyview` wordmark in both cases, and the format converted to WOFF2. Subsetting is a
transformation rather than a format change, so this file is Adapted Material and remains
under CC BY-SA 4.0 — it is **not** covered by the repository's own license (MIT OR
Apache-2.0). ShareAlike is scoped to this file and does not extend to the surrounding
source.

Reproduce it with:

```bash
python3 -m fontTools.subset \
  "Web437_IBM_VGA_9x16.woff" \
  --text="crustyviewCRUSTYVIEW" \
  --flavor=woff2 \
  --layout-features='' \
  --no-hinting \
  --output-file=px437-ibm-vga-9x16-subset.woff2
```

The source file is `woff - Web (webfonts)/Web437_IBM_VGA_9x16.woff` inside
`oldschool_pc_font_pack_v2.2_web.zip`.

Both cases are deliberate: the rendered wordmark is uppercased with `text-transform`, so
the uppercase glyphs are the ones actually drawn, while the lowercase ones back the DOM
text and any future untransformed use.
