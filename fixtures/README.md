# Test fixtures

The real IGV exports used during development are **not included** in this repository:
they contain unpublished sample names and lab file paths.

To run the acceptance suite locally, put your own IGV Desktop export here:

```
fixtures/panel_igv2198.svg            # a single-locus IGV SVG export (3+ tracks)
fixtures/igv_session_B16_USEME.xml    # optional: IGV session XML (configuration only)
fixtures/panel_15tracks_stress.svg    # optional: synthetic stress fixture
```

`npm test` / `npm run test:e2e` expect these files; without them the suites report
"fixture missing" instead of failing silently.
