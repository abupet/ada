# ADA – AbuPet AI 

Repository dell’app ADA (AbuPet AI).

---

## Prerequisiti

- Node.js (consigliato LTS)
- npm
- Playwright (installato come dev dependency nel repo)

---

## Installazione

Dalla root del repository:

```bash
npm install
npx playwright install
```

---

## Configurazione ambiente (.env)

I file `.env` contengono configurazioni locali e/o segreti e **non devono essere committati**.

1. Crea il file `.env` partendo dall’esempio:

```bash
# Windows PowerShell
Copy-Item .env.example .env
```

2. Modifica `.env` secondo le tue esigenze locali.

---

## Avvio server locale

I test E2E si aspettano l’app disponibile a:

```
http://localhost:4173/index.html
```

Avvia il server in **un terminale**:

```bash
npm run serve
```

⚠️ Lascia questo terminale aperto mentre esegui i test.

---

## Test E2E (Playwright)

### Smoke tests

In **un secondo terminale** (con il server già avviato):

```bash
npm run test:smoke
```

---

### Smoke tests con STRICT_NETWORK

Questa modalità blocca **tutte le richieste di rete esterne**, eccetto quelle esplicitamente consentite.
Serve per verificare che l’app e i test non dipendano implicitamente da internet.

```bash
npm run test:smoke:strict
```

Allowlist attuale necessaria per il corretto funzionamento dei test:

- `cdnjs.cloudflare.com`  
  (Chart.js, jszip, jspdf)

---

### Regression tests

```bash
npm run test:regression
```

---

### Suite CI (policy + smoke + regression)

```bash
npm run test:ci
```

### Suite CI con test long

```bash
npm run test:ci:real
```

### Solo test long

```bash
npm run test:ci:long
```

---

### Smoke su app deployata

```bash
npm run test:deployed
```

---

## Output dei test

Playwright genera automaticamente:

- `test-results/`  
  (screenshot, video e trace per i test falliti)
- `playwright-report/`  
  (report HTML interattivo)

Per aprire l’ultimo report:

```bash
npx playwright show-report
```

---

## Note su Windows

- In passato, lavorare in cartelle sincronizzate (es. OneDrive) può causare errori `EPERM`
  durante la creazione/cancellazione di `test-results/`.
- Il repository è ora posizionato in:
  ```
  C:\MyRepo\ada
  ```
  per evitare questi problemi.

---
