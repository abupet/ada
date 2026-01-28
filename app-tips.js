// ADA v6.16.2 - Tips & Tricks (dedup ibrido + Ricomincia)

// Memory model (per pet):
// { topics: {"alimentazione": 2, ...}, signatures: [["token1","token2"...], ...], updatedAt: 123 }

function getTipsMemoryKey() {
    try {
        const id = (typeof getCurrentPetId === 'function') ? getCurrentPetId() : null;
        return id ? `ada_tips_memory_pet_${id}` : 'ada_tips_memory_global';
    } catch (_) {
        return 'ada_tips_memory_global';
    }
}

function loadTipsMemory() {
    const key = getTipsMemoryKey();
    try {
        const raw = localStorage.getItem(key);
        const m = raw ? JSON.parse(raw) : null;
        if (m && typeof m === 'object') {
            return {
                topics: (m.topics && typeof m.topics === 'object') ? m.topics : {},
                signatures: Array.isArray(m.signatures) ? m.signatures : [],
                updatedAt: m.updatedAt || null
            };
        }
    } catch (_) {}
    return { topics: {}, signatures: [], updatedAt: null };
}

function saveTipsMemory(mem) {
    const key = getTipsMemoryKey();
    const safe = {
        topics: mem.topics || {},
        signatures: Array.isArray(mem.signatures) ? mem.signatures.slice(-80) : [],
        updatedAt: Date.now()
    };
    try { localStorage.setItem(key, JSON.stringify(safe)); } catch (_) {}
}

function resetTipsMemory() {
    const key = getTipsMemoryKey();
    const petLabel = (document.querySelector('[data-selected-pet-header]')?.textContent || '').trim();
    const msg = petLabel
        ? `Ricominciare da zero i Tips per ${petLabel}?

Questo resetta la memoria (argomenti già suggeriti) solo per questo pet.`
        : `Ricominciare da zero i Tips?

Questo resetta la memoria (argomenti già suggeriti).`;
    if (!confirm(msg)) return;
    try { localStorage.removeItem(key); } catch (_) {}
    tipsData = [];
    renderTips();
    showToast('Memoria Tips resettata', 'success');
}

// ------------------------
// Dedup helpers (tema + similarita "semantic-like" lightweight)
// ------------------------

const _TIP_STOPWORDS = new Set([
    'il','lo','la','i','gli','le','un','uno','una','di','a','da','in','su','per','con','tra','fra','e','o',
    'che','del','dello','della','dei','degli','delle','al','allo','alla','ai','agli','alle','nel','nello','nella','nei','negli','nelle',
    'ed','ma','se','piu','meno','molto','poco','anche','solo','sempre','mai','come','quando','dove','perche','quindi','poi','ancora',
    'pet','cane','gatto','animale','veterinario','veterinaria'
]);

function _normalizeText(s) {
    return (s || '')
        .toString()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}

function _tokenize(s) {
    const t = _normalizeText(s)
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!t) return [];
    return t.split(' ').filter(w => w.length >= 3 && !_TIP_STOPWORDS.has(w));
}

function _toSet(arr) {
    return new Set(Array.isArray(arr) ? arr : []);
}

function _jaccard(setA, setB) {
    if (!setA || !setB) return 0;
    let inter = 0;
    let union = setA.size + setB.size;
    for (const x of setA) {
        if (setB.has(x)) inter += 1;
    }
    union -= inter;
    return union ? (inter / union) : 0;
}

function _signatureFromTip(tip) {
    const tokens = _tokenize((tip?.title || '') + ' ' + (tip?.content || ''));
    // Lightweight signature: top-N most frequent tokens
    const freq = new Map();
    for (const w of tokens) freq.set(w, (freq.get(w) || 0) + 1);
    const top = [...freq.entries()].sort((a,b) => b[1]-a[1]).slice(0, 30).map(x => x[0]);
    return top;
}

function _themeFromTip(tip) {
    const raw = tip?.category || (Array.isArray(tip?.tags) ? tip.tags[0] : '') || 'generale';
    return _normalizeText(raw).replace(/\s+/g, ' ').trim() || 'generale';
}

function _dedupTips(candidateTips, mem) {
    const usedThemes = new Set(Object.keys(mem.topics || {}).map(_normalizeText));
    const memSigs = (mem.signatures || []).map(_toSet);

    const accepted = [];
    const acceptedSigs = [];

    const SIM_THRESHOLD = 0.72; // jaccard approx for near-paraphrase / same idea

    for (const tip of (candidateTips || [])) {
        const theme = _themeFromTip(tip);
        const sigArr = _signatureFromTip(tip);
        const sigSet = _toSet(sigArr);

        // 1) Theme-level dedup (avoid repeating same topic)
        const themeHit = usedThemes.has(theme) || accepted.some(t => _themeFromTip(t) === theme);
        if (themeHit) continue;

        // 2) Similarity to previous tips (memory)
        let tooSimilar = false;
        for (const s of memSigs) {
            if (_jaccard(sigSet, s) >= SIM_THRESHOLD) { tooSimilar = true; break; }
        }
        if (tooSimilar) continue;

        // 3) Similarity within this batch
        for (const s of acceptedSigs) {
            if (_jaccard(sigSet, s) >= SIM_THRESHOLD) { tooSimilar = true; break; }
        }
        if (tooSimilar) continue;

        accepted.push(tip);
        acceptedSigs.push(sigSet);
    }

    return accepted;
}

function _updateMemoryWithTips(mem, tips) {
    mem.topics = mem.topics || {};
    mem.signatures = Array.isArray(mem.signatures) ? mem.signatures : [];

    for (const tip of (tips || [])) {
        const theme = _themeFromTip(tip);
        mem.topics[theme] = (mem.topics[theme] || 0) + 1;
        mem.signatures.push(_signatureFromTip(tip));
    }
    mem.updatedAt = Date.now();
}

// ------------------------
// Generate personalized tips (with memory + dedup)
// ------------------------

async function _callTipsLLM(prompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 3600,
            response_format: { type: 'json_object' }
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const content = (data.choices?.[0]?.message?.content || '').trim();

    let parsed = null;
    try {
        parsed = JSON.parse(content);
    } catch (_) {
        const m = content.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
    }

    if (typeof trackChatUsageOrEstimate === 'function') {
        trackChatUsageOrEstimate('gpt-4o', prompt, content, data.usage);
    }

    return Array.isArray(parsed?.tips) ? parsed.tips : [];
}

function _buildTipsPrompt({ patient, lifestyle, allowedSources, memoryThemes, memoryTitles, requestType }) {
    const sourcesBullet = allowedSources.map(s => `- ${s}`).join('\n');
    const usedThemesLine = memoryThemes.length ? memoryThemes.join(', ') : 'Nessuno';
    const avoidTitlesLine = memoryTitles.length ? memoryTitles.slice(0, 12).join(' | ') : 'Nessuno';

    const requestHint = requestType === 'add_more'
        ? 'Genera consigli *aggiuntivi* (nuovi) che NON ripetano quelli gia forniti e che coprano aree diverse.'
        : 'Genera 6-8 consigli ("Tips & Tricks") INTERESSANTI e CURIOSI per questo pet.';

    return `${requestHint}

PROFILO PET:
Nome: ${patient.petName || 'il pet'}
Specie: ${patient.petSpecies || 'N/D'}
Razza: ${patient.petBreed || 'N/D'}
Eta: ${patient.petAge || 'N/D'}
Sesso: ${patient.petSex || 'N/D'}
Peso: ${patient.petWeight || 'N/D'} kg

STILE DI VITA:
Ambiente: ${lifestyle.lifestyle || 'N/D'}
Conviventi: ${lifestyle.household || 'N/D'}
Livello attivita: ${lifestyle.activityLevel || 'N/D'}
Alimentazione: ${lifestyle.dietType || 'N/D'}
Preferenze alimentari: ${lifestyle.dietPreferences || 'N/D'}
Condizioni note: ${lifestyle.knownConditions || 'Nessuna'}
Note comportamentali: ${lifestyle.behaviorNotes || 'N/D'}
Localita: ${lifestyle.location || 'N/D'}

MEMORIA (per evitare ripetizioni):
- Temi gia suggeriti: ${usedThemesLine}
- Titoli gia suggeriti (evita parafrasi simili): ${avoidTitlesLine}

VINCOLI IMPORTANTI:
1. LINGUA: Tutto in italiano
2. PERSONALIZZAZIONE: Ogni tip deve essere specifico per questo pet
3. NO BRAND: Non citare MAI nomi di cliniche o brand privati (es. AniCura, BluVet) nel testo
4. SICUREZZA: Se tocchi temi sanitari, aggiungi "Se noti sintomi o dubbi, chiedi al veterinario."
5. LUNGHEZZA: Ogni tip deve essere almeno 70 parole
6. TONO: Curioso, interessante, positivo ma informativo
7. DEDUP: NON ripetere temi gia suggeriti; proporre nuove aree; NON fare parafrasi molto simili
8. DIVERSITA FONTI: NON usare piu del 50% delle fonti dallo stesso sito web. Distribuisci le fonti equamente.
9. FONTI: sourceUrl deve essere UNA delle fonti autorizzate qui sotto (esattamente).

CATEGORIE DA COPRIRE (almeno 5 categorie diverse):
- Curiosita sulla razza/specie
- Alimentazione e snack sani
- Giochi e arricchimento ambientale
- Cura quotidiana e benessere
- Comportamento e comunicazione
- Sicurezza in casa/fuori
- Salute preventiva (senza allarmismi)

FONTI AUTORIZZATE (usa almeno 3 fonti diverse):
${sourcesBullet}

Rispondi SOLO con JSON valido nel formato:
{
  "tips": [
    {
      "title": "Titolo accattivante",
      "content": "Testo del consiglio (minimo 70 parole, senza citare brand)",
      "category": "Categoria/tema (es. alimentazione, parassiti, cute, comportamento...)",
      "priority": "alto/medio/basso",
      "tags": ["tag1", "tag2"],
      "reason": "Perche e adatto a questo pet (1-2 frasi)",
      "sourceUrl": "URL fonte (una delle fonti autorizzate)",
      "translatedFrom": null
    }
  ]
}`;
}

async function generateTipsTricks() {
    const t0 = performance.now();
    showProgress(true);

    const patient = getPatientData();
    const lifestyle = getLifestyleData();

    // Load memory (per pet)
    const mem = loadTipsMemory();
    const memoryThemes = Object.keys(mem.topics || {}).slice(0, 30);
    const memoryTitles = (Array.isArray(tipsData) ? tipsData : []).map(t => t.title).filter(Boolean);

    // Clear previous tips (visual)
    tipsData = [];
    renderTips();

    const allowedSources = [
        'https://www.avma.org',
        'https://www.aaha.org',
        'https://www.aspca.org',
        'https://www.rspca.org.uk',
        'https://www.akc.org',
        'https://icatcare.org',
        'https://www.vet.cornell.edu',
        'https://www.anicura.it',
        'https://www.enpa.org',
        'https://www.purina.it',
        'https://www.royalcanin.com/it',
        'https://www.bluvet.it',
        'https://www.fecava.org',
        'https://www.enci.it',
        'https://www.anmvi.it',
        'https://www.petmd.com'
    ];

    const forbiddenTerms = ['anicura', 'bluvet', 'ani cura'];
    const allowedDomains = allowedSources.map(s => {
        try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return ''; }
    }).filter(Boolean);

    function sanitizeTips(rawTips) {
        return (rawTips || []).map(tip => {
            const safe = { ...tip };

            // Remove forbidden brand mentions from visible text
            ['title', 'content', 'reason'].forEach(k => {
                if (typeof safe[k] !== 'string') return;
                let v = safe[k];
                for (const term of forbiddenTerms) {
                    v = v.replace(new RegExp(term, 'gi'), 'struttura veterinaria');
                }
                safe[k] = v;
            });

            // Validate source url
            if (typeof safe.sourceUrl === 'string' && safe.sourceUrl.trim()) {
                try {
                    const host = new URL(safe.sourceUrl).hostname.replace(/^www\./, '');
                    if (!allowedDomains.some(d => host === d || host.endsWith('.' + d))) {
                        safe.sourceUrl = null;
                    }
                } catch (_) {
                    safe.sourceUrl = null;
                }
            } else {
                safe.sourceUrl = null;
            }

            return safe;
        });
    }

    try {
        // First pass
        const prompt1 = _buildTipsPrompt({
            patient, lifestyle,
            allowedSources,
            memoryThemes,
            memoryTitles,
            requestType: 'first'
        });

        let rawTips = await _callTipsLLM(prompt1);
        rawTips = sanitizeTips(rawTips);

        let accepted = _dedupTips(rawTips, mem);

        // If too few tips after dedup, ask for more (one extra attempt)
        if (accepted.length < 5) {
            const avoidTitles = accepted.map(t => t.title).filter(Boolean);
            const prompt2 = _buildTipsPrompt({
                patient, lifestyle,
                allowedSources,
                memoryThemes: [...new Set([...memoryThemes, ...accepted.map(_themeFromTip)])],
                memoryTitles: [...new Set([...memoryTitles, ...avoidTitles])],
                requestType: 'add_more'
            });
            let moreTips = await _callTipsLLM(prompt2);
            moreTips = sanitizeTips(moreTips);
            const merged = [...accepted, ...moreTips];
            accepted = _dedupTips(merged, mem);
        }

        tipsData = accepted.slice(0, 7);
        renderTips();

        // Update + persist memory
        _updateMemoryWithTips(mem, tipsData);
        saveTipsMemory(mem);

        const dt = ((performance.now() - t0) / 1000).toFixed(1);
        showToast(`Tips generati in ${dt} s`, 'success');

    } catch (e) {
        if (typeof logError === 'function') logError('Tips & Tricks', e.message);
        showToast('Errore: ' + e.message, 'error');
    } finally {
        showProgress(false);
    }
}

// Render tips cards
function renderTips() {
    const container = document.getElementById('tipsTricksList');
    if (!container) return;
    const speakBtn = document.getElementById('btnSpeakTips');

    if (!Array.isArray(tipsData) || tipsData.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center; padding: 40px;">Premi "Genera" per ricevere consigli personalizzati per il tuo pet</p>';
        if (speakBtn) speakBtn.disabled = true;
        return;
    }

    if (speakBtn) speakBtn.disabled = false;
    container.innerHTML = tipsData.map(tip => {
        const pr = (tip.priority || 'medio').toString().toLowerCase();
        const prLabel = pr.toUpperCase();
        return `
        <div class="tip-card">
            <div class="tip-card-header">
                <div class="tip-card-title">${tip.title || 'Consiglio'}</div>
                <span class="tip-card-priority ${pr}">${prLabel}</span>
            </div>
            <div class="tip-card-content">${tip.content || ''}</div>
            ${tip.translatedFrom ? `<div class="tip-translated-note">📝 Tradotto da: ${tip.translatedFrom}</div>` : ''}
            <div class="tip-card-meta">
                <span class="tip-card-category">${tip.category || 'Generale'}</span>
                ${(tip.tags || []).map(tag => `<span class="tip-card-tag">${tag}</span>`).join('')}
            </div>
            <div class="tip-card-reason">💡 <strong>Perché per il tuo pet:</strong> ${tip.reason || 'Consiglio personalizzato'}</div>
            <div class="tip-card-footer">
                <span class="tip-card-source">${tip.sourceUrl ? 'Fonte verificata' : 'Fonte non indicata'}</span>
                ${tip.sourceUrl ? `<a href="${tip.sourceUrl}" target="_blank" class="tip-card-link">🔗 Approfondisci</a>` : ''}
            </div>
        </div>
        `;
    }).join('');
}
