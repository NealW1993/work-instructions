# Bundled application fonts

These unmodified, complete variable TrueType files come from the primary [Google Fonts repository](https://github.com/google/fonts) at commit `86aced91de05cd4f96a06838124cca45be337b2b`, retrieved on 2026-11-07. No glyphs or language coverage were removed. Keeping the files in the repository allows `next/font/local` to build and serve them without contacting Google Fonts.

- [Space Grotesk upstream files](https://github.com/google/fonts/tree/86aced91de05cd4f96a06838124cca45be337b2b/ofl/spacegrotesk): `SpaceGrotesk[wght].ttf`, weight 300–700, normal style. License: [SpaceGrotesk-OFL.txt](./SpaceGrotesk-OFL.txt).
- [Source Sans 3 upstream files](https://github.com/google/fonts/tree/86aced91de05cd4f96a06838124cca45be337b2b/ofl/sourcesans3): `SourceSans3[wght].ttf` and `SourceSans3-Italic[wght].ttf`, weight 200–900, normal and italic styles. License: [SourceSans3-OFL.txt](./SourceSans3-OFL.txt).

Both families use the SIL Open Font License 1.1. Their accompanying copyright and license files are retained verbatim. Only the local filenames were simplified; the font bytes match the upstream Git blobs.

| Local file | SHA-256 |
| --- | --- |
| SpaceGrotesk-Variable.ttf | `acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72` |
| SourceSans3-Variable.ttf | `042fe2cc0b933e328410d7acbd0aa6a1873dca5aef81875f4bc214b08825c7b9` |
| SourceSans3-Italic-Variable.ttf | `39e3ab05ccd7cb94907c31005bb5bec1d5432f0b096a2b782976e217a540eb6c` |
| SpaceGrotesk-OFL.txt | `564ce565c371c5e5bbf286006565a7c9aa55a9f56e7ca58d56e05d649dd61a72` |
| SourceSans3-OFL.txt | `09746787287a289323b0ec3cff4d1a4a801331b82b7207c1e186f5d26619a392` |

When updating, use a pinned upstream commit, retain both licenses, verify the font weight ranges and update the hashes above. Do not replace these full files with a language subset unless the application's language requirements have been reviewed.
