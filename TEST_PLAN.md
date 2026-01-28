# ADA – Manual Test Plan

## Baseline
Version under test: v6.17.8+

---

## Test 1 – Visita Buttons
- Open Visita page
- Click each button:
  - 🎤 Microphone
  - 📁 Carica audio
  - 🧪 Long audio test
  - 🧪 Long text test
  - 📄 Carica testo
Expected: all buttons respond.

---

## Test 2 – Long Audio
- Upload a WebM > 25MB
Expected:
- No "Audio file corrupted"
- Chunking is time-based
- No infinite loops

---

## Test 3 – Debug Mode
- Enable Debug attivo
- Perform audio upload
Expected:
- Detailed logs
- Errors visible in ADA.log
