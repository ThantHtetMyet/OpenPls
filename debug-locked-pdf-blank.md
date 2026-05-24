# Debug Session: locked-pdf-blank

- Status: OPEN
- Started: 2026-05-24
- Symptom: Locked PDF accepts the password but opens as a blank page.
- Scope: `Lock` flow in `src/app/page.js`

## Hypotheses

1. Encrypted output opens, but page content/resources are lost after save.
2. Encryption save rewrites a valid rebuilt PDF into a viewer-incompatible file.
3. Encryption/version settings decrypt incorrectly in Acrobat/Chrome viewers.
4. The downloaded blob is incomplete only for the lock flow.
5. A library-specific bug affects encrypted saves for certain PDFs.

## Evidence Log

- `pre-fix` logs show encrypted output was generated with non-zero byte length (`38315`) and valid PDF header/trailer markers.
- `pre-fix` self-check reopened the encrypted output in-browser and rendered page 1 with `nonWhitePixels: 0`, confirming the output was already visually blank before external viewers opened it.
- The later "damaged file" symptom was introduced by the debug self-check using the same byte buffer; the downloaded blob became size `0` after buffer detachment.
- Current evidence rejects "broken download" as the original root cause and strongly supports a library/encryption-output issue in the current lock implementation.

## Next Step

- Swap the encryption library to an alternative browser-compatible patch, keep instrumentation, and compare the next generated output.
