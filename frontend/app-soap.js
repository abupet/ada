// ADA v6.16.2 - SOAP Generation with Structured Outputs

let lastSOAPResult = null;
let correctionRecorder = null;
let correctionChunks = [];

// Remove UI headers/noise that should not reach the model
function sanitizeTranscriptionText(raw) {
    return (raw || '')
        // remove warning banner lines
        .replace(/^⚠️[^\n]*\n+/g, '')
        .trim();
}


// ============================================
// USAGE TRACKING (Tokens/Usage)
// ============================================

function trackChatUsageOrEstimate(model, promptText, completionText, usage) {
    // Prefer server-reported usage if available
    if (usage && typeof trackChatUsage === 'function') {
        try {
            trackChatUsage(model, usage);
            return;
        } catch (_) {
            // fall through
        }
    }

    if (typeof ensureApiUsageShape === 'function') ensureApiUsageShape();

    const est = (t) => (typeof estimateTokensFromText === 'function') ? estimateTokensFromText(t || '') : Math.ceil((t || '').length / 4);
    const inTokens = est(promptText);
    const outTokens = est(completionText);

    const m = String(model || '');
    if (m.includes('mini')) {
        apiUsage.gpt4o_mini_input_tokens += inTokens;
        apiUsage.gpt4o_mini_output_tokens += outTokens;
    } else {
        apiUsage.gpt4o_input_tokens += inTokens;
        apiUsage.gpt4o_output_tokens += outTokens;
    }

    if (typeof saveApiUsage === 'function') saveApiUsage();
    if (typeof updateCostDisplay === 'function') updateCostDisplay();
}

let _cachedWhiteLogoDataUrl = null;
function getWhiteAnicuraLogoDataUrl() {
    if (_cachedWhiteLogoDataUrl) return _cachedWhiteLogoDataUrl;

    const logoImg = document.getElementById('anicuraLogoImg');
    if (!logoImg) return null;

    const w = logoImg.naturalWidth || logoImg.width;
    const h = logoImg.naturalHeight || logoImg.height;
    if (!w || !h) return null;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(logoImg, 0, 0, w, h);

    try {
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        const target = [30, 58, 95]; // approx AniCura blue

        for (let i = 0; i < d.length; i += 4) {
            const a = d[i + 3];
            if (a === 0) continue;

            const r = d[i], g = d[i + 1], b = d[i + 2];
            const dist = Math.abs(r - target[0]) + Math.abs(g - target[1]) + Math.abs(b - target[2]);

            const looksBlue = (b > r + 18) && (b > g + 8) && (b > 55);
            if (dist < 190 || looksBlue) {
                d[i] = 255;
                d[i + 1] = 255;
                d[i + 2] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
    } catch (_) {
        // If CORS blocks pixel access, just return the original dataURL
    }

    try {
        _cachedWhiteLogoDataUrl = canvas.toDataURL('image/png');
        return _cachedWhiteLogoDataUrl;
    } catch (_) {
        return logoImg.src || null;
    }
}

function addAnicuraLogoToPdf(doc, x, y, maxW, maxH) {
    const logoImg = document.getElementById('anicuraLogoImg');
    if (!logoImg) return;

    const dataUrl = getWhiteAnicuraLogoDataUrl() || logoImg.src;
    const w0 = logoImg.naturalWidth || 1;
    const h0 = logoImg.naturalHeight || 1;

    const ratio = w0 / h0;
    const boxRatio = maxW / maxH;
    let w = maxW, h = maxH;
    if (ratio > boxRatio) {
        w = maxW;
        h = maxW / ratio;
    } else {
        h = maxH;
        w = maxH * ratio;
    }

    doc.addImage(dataUrl, 'PNG', x, y, w, h);
}



function formatSegmentsForPrompt(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return '';

    function fmtNum(x) {
        const n = Number(x);
        if (!Number.isFinite(n)) return '0.0';
        return (Math.round(n * 10) / 10).toFixed(1);
    }

    return segments.map(seg => {
        const idx = (seg.segment_index !== undefined && seg.segment_index !== null) ? seg.segment_index : '';
        const start = fmtNum(seg.start);
        const end = fmtNum(seg.end);
        const speaker = (seg.speaker || 'sconosciuto').toString().trim();
        const role = (seg.role || 'unknown').toString().trim();
        const t = (seg.text || '').toString().replace(/\s+/g, ' ').trim();
        return `[SEG ${idx}] (${start}-${end}) ${speaker} [${role}]: ${t}`;
    }).join('\n');
}

function isSoapAllEmpty(soap) {
    const S = soap?.S || soap?.s;
    const O = soap?.O || soap?.o;
    const A = soap?.A || soap?.a;
    const P = soap?.P || soap?.p;

    const isBlankStr = (x) => (typeof x === 'string') ? (x.trim().length === 0) : false;
    const emptyArr = (x) => !Array.isArray(x) || x.length === 0;

    // If any section is a non-empty string, not empty
    if (typeof S === 'string' && !isBlankStr(S)) return false;
    if (typeof O === 'string' && !isBlankStr(O)) return false;
    if (typeof A === 'string' && !isBlankStr(A)) return false;
    if (typeof P === 'string' && !isBlankStr(P)) return false;

    // Structured checks (best-effort)
    const sOk = S && (S.chief_complaint || !emptyArr(S.history) || !emptyArr(S.symptoms) || !emptyArr(S.medications_current) || S.text);
    const oOk = O && ((O.vitals && Object.values(O.vitals).some(v => v)) || !emptyArr(O.physical_exam) || !emptyArr(O.tests_performed) || !emptyArr(O.test_results) || O.text);
    const aOk = A && (!emptyArr(A.problem_list) || !emptyArr(A.differentials) || A.diagnosis || A.text);
    const pOk = P && (!emptyArr(P.treatment_plan) || !emptyArr(P.diagnostics_planned) || !emptyArr(P.follow_up) || !emptyArr(P.client_instructions) || P.text);

    return !(sOk || oOk || aOk || pOk);
}


// ============================================
// SOAP GENERATION WITH STRUCTURED OUTPUTS
// ============================================

function isAbortErrorSoap(err) {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    const msg = String(err.message || '').toLowerCase();
    return msg.includes('abort');
}

async function generateSOAP(options = {}) {
    const opts = options || {};
    const auto = !!opts.auto;
    const signalFromOpts = opts.signal || undefined;
    let createdAbortScope = false;
    let signal = signalFromOpts;

    // For manual generation, create an abort scope so the Visita 'Annulla' button can stop the request
    if (!auto && !signal && typeof beginVisitAbortScope === 'function') {
        const c = beginVisitAbortScope();
        createdAbortScope = true;
        signal = c ? c.signal : undefined;
        try {
            const btnCancel = document.getElementById('btnCancel');
            if (btnCancel) btnCancel.disabled = false;
        } catch (e) {}
    }

    const t0 = performance.now();

    const transcriptionTextRaw = document.getElementById('transcriptionText').value;
    const transcriptionText = sanitizeTranscriptionText(transcriptionTextRaw);
    if (!transcriptionText) {
        showToast('Nessuna trascrizione disponibile', 'error');
        return;
    }

    // Button id in DOM is "btnGenerateSoap" (page Visita)
    const btn = document.getElementById('btnGenerateSoap');
    const oldLabel = btn ? btn.textContent : null;
    if (!auto && btn) {
        btn.disabled = true;
        btn.textContent = 'Generazione referto in corso...';
    }

    showProgress(true);
    const statusEl = document.getElementById('recordingStatus');
    if (statusEl) {
        statusEl.textContent = auto
            ? 'Ho completato la trascrizione della registrazione. Sto generando il referto.'
            : '⏳ Generazione SOAP...';
    }

    try {
        const soapResult = await generateSOAPStructured(transcriptionText, { signal });
        lastSOAPResult = soapResult;

        
        let finalSoapResult = soapResult;
// Display in form
        displaySOAPResult(finalSoapResult);

        // v6.16.4: se S/O/A risultano vuoti con testo presente, riprova con fallback ultra-robusto
        try {
            const sVal = (document.getElementById('soap-s')?.value || '').trim();
            const oVal = (document.getElementById('soap-o')?.value || '').trim();
            const aVal = (document.getElementById('soap-a')?.value || '').trim();
            if (!sVal && !oVal && !aVal && transcriptionText && transcriptionText.length > 400) {
                console.warn('SOAP missing S/O/A; retrying with text-only fallback');
                const retryResult = await generateSOAPFallbackTextOnly(transcriptionText, '', { signal });
                if (retryResult) {
                    finalSoapResult = retryResult;
                    lastSOAPResult = retryResult;
                    displaySOAPResult(finalSoapResult);
                }
            }
        } catch (e) {}

        // 8B: Extract template-specific fields + checklist (NO inventions)
        try {
            await extractTemplateExtrasAndChecklistFromText(transcriptionText, finalSoapResult, { signal });
        } catch (e) {
            // Non-blocking: keep SOAP even if extractor fails
            console.warn('8B extractor failed:', e);
        }

        if (auto && statusEl) statusEl.textContent = 'Ho completato la generazione del referto';

        // Navigate to SOAP page when generation completes
        if (typeof navigateToPage === 'function') navigateToPage('soap');

        const dt = ((performance.now() - t0) / 1000).toFixed(1);
        showToast(`Referto SOAP generato in ${dt} s`, 'success');

    } catch (error) {
        if (isAbortErrorSoap(error) || (signal && signal.aborted)) {
            // Silent abort: let caller handle UI
            throw error;
        }
        console.error('SOAP generation error:', error);
        logError('GENERA REFERTO', error.message);
        showToast('Errore: ' + error.message, 'error');
        if (statusEl) statusEl.textContent = '❌ Errore generazione';
    } finally {
        showProgress(false);
        if (createdAbortScope && typeof endVisitAbortScope === 'function') {
            try { endVisitAbortScope(); } catch (e) {}
            try {
                const btnCancel = document.getElementById('btnCancel');
                if (btnCancel) btnCancel.disabled = true;
            } catch (e) {}
        }
        if (!auto && btn) {
            btn.disabled = false;
            if (oldLabel) btn.textContent = oldLabel;
        }
    }
}

async function generateSOAPFromPaste() {
    // Backward-compatible: if a dedicated textarea exists use it, otherwise fall back to transcriptionText.
    const pasteEl = document.getElementById('pasteText');
    const sourceEl = pasteEl || document.getElementById('transcriptionText');
    const pasteText = (sourceEl?.value || '').toString().trim();

    if (!pasteText) {
        showToast('Inserisci il testo del colloquio', 'error');
        return;
    }

    // IMPORTANT: avoid using stale segments from previous transcriptions
    if (typeof transcriptionSegments !== 'undefined') transcriptionSegments = [];

    // Process pasted text as segments
    const ta = document.getElementById('transcriptionText');
    if (ta) ta.value = pasteText;

    lastTranscriptionResult = { text: pasteText, segments: [] };
    lastTranscriptionDiarized = false;

    await generateSOAP();
}

async function generateSOAPStructured(transcriptionText, options = {}) {
    const signal = (options || {}).signal || undefined;

    // Build structured input with segments if available
    let inputContent = '';
    
    // Collect segments from either global transcriptionSegments or lastTranscriptionResult
    const segmentsSource = (typeof transcriptionSegments !== 'undefined' && Array.isArray(transcriptionSegments) && transcriptionSegments.length > 0)
        ? transcriptionSegments
        : (lastTranscriptionResult && Array.isArray(lastTranscriptionResult.segments) ? lastTranscriptionResult.segments : []);

    const segmentsText = segmentsSource.length > 0 ? formatSegmentsForPrompt(segmentsSource) : '';

    // Check if we have real segments from transcription
    if (segmentsSource.length > 0) {
        inputContent = `TRASCRIZIONE VISITA VETERINARIA (segmenti con timestamp):

SEGMENTI (usa i numeri dentro [SEG ...] come supporting_segment_ids):
${segmentsText}

ISTRUZIONI:
- Il ruolo tra parentesi quadre è un INDIZIO, non un vincolo. Se è "unknown" o sembra errato, usa comunque il contenuto.
- Estrai informazioni cliniche da TUTTI i segmenti e assegnale correttamente a S/O/A/P.
- Usa supporting_segment_ids quando possibile; se non possibile usa [] ma NON lasciare i campi vuoti se l'informazione è presente.
- Compila almeno: motivo visita, anamnesi/sintomi principali, osservazioni/esame obiettivo, assessment/ipotesi se esplicitate, piano/istruzioni se presenti.`;
    } else {
        // Fallback to text-only input
        inputContent = `TRASCRIZIONE VISITA VETERINARIA (testo continuo):
${transcriptionText}

ISTRUZIONI IMPORTANTI:
- Genera un referto SOAP *completo* basandoti ESCLUSIVAMENTE sul testo sopra.
- NON lasciare S/O/A vuoti se nel testo sono presenti informazioni pertinenti.
- S: motivo visita, andamento, sintomi, terapie seguite, osservazioni del proprietario.
- O: esame obiettivo, test (es. scotch test), risultati, parametri, reperti.
- A: diagnosi o ipotesi (se esplicitate), interpretazione clinica, problemi principali.
- P: terapia, istruzioni, dieta, follow-up e controlli.
- Se un dettaglio manca, omettilo, ma riassumi comunque le informazioni presenti.`;
    }

    try {
        // Try with strict schema first
        try {
            if (typeof logDebug === 'function') {
                logDebug('SOAP_API_START', {
                    endpoint: '/api/chat',
                    model: 'gpt-4o',
                    temperature: 0.3,
                    inputChars: (inputContent || '').length
                });
            }
        } catch (e) {}

        const response = await fetchApi('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: SOAP_SYSTEM_INSTRUCTIONS },
                    { role: 'user', content: inputContent }
                ],
                response_format: {
                    type: 'json_schema',
                    json_schema: SOAP_JSON_SCHEMA
                },
                temperature: 0.3
            }),
            signal
        });

        try {
            if (typeof logDebug === 'function') {
                logDebug('SOAP_API_RESPONSE', {
                    status: response.status,
                    ok: response.ok
                });
            }
        } catch (e) {}
        
        if (!response.ok) {
            const errText = await response.text();
            console.error('Strict schema failed:', errText);
            // Try fallback without strict schema
            return await generateSOAPFallback(inputContent, transcriptionText, segmentsText, { signal });
        }
        
        const data = await response.json();
        
        if (data.error) {
            console.error('API error:', data.error);
            return await generateSOAPFallback(inputContent, transcriptionText, segmentsText, { signal });
        }
        
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('Risposta vuota dal modello');
        }
        
        // Parse JSON
        const soapResult = JSON.parse(content);

        // If strict schema produced an empty skeleton, use a more robust fallback
        if (isSoapAllEmpty(soapResult)) {
            console.warn('SOAP empty with strict schema; using robust fallback');
            return await generateSOAPFallbackTextOnly(transcriptionText, segmentsText, { signal });
        }

        // Track usage (prefer real token counts)
        trackChatUsageOrEstimate(
            'gpt-4o',
            SOAP_SYSTEM_INSTRUCTIONS + "\n\nRispondi SOLO con un oggetto JSON valido, senza markdown o altro testo.\n\n" + inputContent,
            content,
            data.usage
        );
        
        return soapResult;
        
    } catch (error) {
        console.error('generateSOAPStructured error:', error);
        return await generateSOAPFallback(inputContent, transcriptionText, segmentsText, { signal });
    }
}

// Fallback without strict schema
async function generateSOAPFallback(inputContent, transcriptionText, segmentsText, options = {}) {
    const signal = (options || {}).signal || undefined;

    console.log('Using SOAP fallback without strict schema');
    
    const response = await fetchApi('/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: SOAP_SYSTEM_INSTRUCTIONS + '\n\nRispondi SOLO con un oggetto JSON valido, senza markdown o altro testo.' },
                { role: 'user', content: inputContent }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.3
        }),
        signal
    });
    
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
        throw new Error(data.error.message);
    }
    
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('Risposta vuota dal modello');
    }
    
    // Parse JSON
    const soapResult = JSON.parse(content);

    if (isSoapAllEmpty(soapResult)) {
        console.warn('SOAP empty in fallback; using text-only fallback');
        return await generateSOAPFallbackTextOnly(transcriptionText || '', segmentsText || '', { signal });
    }

    
    // Track usage (prefer real token counts)
    trackChatUsageOrEstimate('gpt-4o', SOAP_SYSTEM_INSTRUCTIONS + "\n\nRispondi SOLO con un oggetto JSON valido, senza markdown o altro testo.\n\n" + inputContent, content, data.usage);
    
    return soapResult;
}



// Ultra-robust fallback: returns string-based S/O/A/P so the UI is never empty
async function generateSOAPFallbackTextOnly(transcriptionText, segmentsText, options = {}) {
    const signal = (options || {}).signal || undefined;

    console.log('Using SOAP ultra fallback (text-only)');

    const source = (segmentsText && segmentsText.trim().length > 0)
        ? `SEGMENTI:
${segmentsText}`
        : `TRASCRIZIONE:
${transcriptionText}`;

    const prompt = `${source}

Crea un referto SOAP in italiano.

REGOLE:
- Non inventare diagnosi o farmaci non citati.
- Se un dettaglio manca, omettilo, ma NON lasciare tutte le sezioni vuote se ci sono informazioni utili.
- Usa frasi brevi o bullet.

Rispondi SOLO con JSON valido con questa forma ESATTA:
{"S":"...","O":"...","A":"...","P":"..."}`;

    const response = await fetchApi('/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
                { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2
        }),
        signal
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Risposta vuota dal modello');

    const soapResult = JSON.parse(content);
    // Track usage (prefer real token counts)
    trackChatUsageOrEstimate('gpt-4o', prompt, content, data.usage);

    return soapResult;
}

function displaySOAPResult(soap) {
    if (!soap) {
        console.error('SOAP result is null');
        return;
    }
    
    console.log('Displaying SOAP result:', JSON.stringify(soap, null, 2));
    
    // S - Soggettivo
    let sText = '';
    const sSection = soap.S || soap.s || soap.soggettivo || soap.Soggettivo || soap.subjective;
    if (sSection) {
        if (typeof sSection === 'string') {
            sText = sSection;
        } else {
            if (sSection.chief_complaint) sText += `Motivo visita: ${sSection.chief_complaint}\n\n`;
            if (Array.isArray(sSection.history) && sSection.history.length) {
                sText += `Anamnesi:\n${sSection.history.map(h => `• ${h}`).join('\n')}\n\n`;
            }
            if (Array.isArray(sSection.symptoms) && sSection.symptoms.length) {
                sText += 'Sintomi:\n';
                sSection.symptoms.forEach(sym => {
                    if (typeof sym === 'string') {
                        sText += `• ${sym}\n`;
                    } else {
                        sText += `• ${sym.name || sym.symptom || JSON.stringify(sym)}`;
                        if (sym.onset) sText += ` (insorgenza: ${sym.onset})`;
                        if (sym.duration) sText += ` (durata: ${sym.duration})`;
                        if (sym.severity) sText += ` (gravità: ${sym.severity})`;
                        sText += '\n';
                    }
                });
                sText += '\n';
            }
            if (sSection.diet) sText += `Dieta: ${sSection.diet}\n`;
            if (sSection.environment) sText += `Ambiente: ${sSection.environment}\n`;
            if (Array.isArray(sSection.medications_current) && sSection.medications_current.length) {
                sText += '\nFarmaci in corso:\n';
                sSection.medications_current.forEach(med => {
                    if (typeof med === 'string') {
                        sText += `• ${med}\n`;
                    } else {
                        sText += `• ${med.drug_name || med.name || JSON.stringify(med)}`;
                        if (med.dose_text) sText += ` ${med.dose_text}`;
                        if (med.frequency) sText += ` ${med.frequency}`;
                        sText += '\n';
                    }
                });
            }
            if (Array.isArray(sSection.allergies) && sSection.allergies.length) {
                sText += `\nAllergie: ${sSection.allergies.join(', ')}\n`;
            }
            // Handle text field
            if (sSection.text) sText += sSection.text;
            if (sSection.contenuto) sText += sSection.contenuto;
        }
    }
    document.getElementById('soap-s').value = sText.trim() || '';
    
    // O - Oggettivo
    let oText = '';
    const oSection = soap.O || soap.o || soap.oggettivo || soap.Oggettivo || soap.objective;
    if (oSection) {
        if (typeof oSection === 'string') {
            oText = oSection;
        } else {
            if (oSection.vitals && typeof oSection.vitals === 'object') {
                oText += 'Parametri vitali:\n';
                const v = oSection.vitals;
                if (v.weight) oText += `• Peso: ${v.weight}\n`;
                if (v.temperature) oText += `• Temperatura: ${v.temperature}\n`;
                if (v.heart_rate) oText += `• FC: ${v.heart_rate}\n`;
                if (v.resp_rate) oText += `• FR: ${v.resp_rate}\n`;
                if (v.mm_color) oText += `• Mucose: ${v.mm_color}\n`;
                if (v.crt) oText += `• TRC: ${v.crt}\n`;
                oText += '\n';
            }
            if (Array.isArray(oSection.physical_exam) && oSection.physical_exam.length) {
                oText += 'Esame obiettivo:\n';
                oSection.physical_exam.forEach(e => oText += `• ${typeof e === 'string' ? e : e.finding || JSON.stringify(e)}\n`);
                oText += '\n';
            }
            if (Array.isArray(oSection.tests_performed) && oSection.tests_performed.length) {
                oText += 'Esami eseguiti:\n';
                oSection.tests_performed.forEach(t => oText += `• ${typeof t === 'string' ? t : t.test || JSON.stringify(t)}\n`);
                oText += '\n';
            }
            if (Array.isArray(oSection.test_results) && oSection.test_results.length) {
                oText += 'Risultati esami:\n';
                oSection.test_results.forEach(r => oText += `• ${typeof r === 'string' ? r : r.result || JSON.stringify(r)}\n`);
            }
            if (oSection.text) oText += oSection.text;
            if (oSection.contenuto) oText += oSection.contenuto;
        }
    }
    document.getElementById('soap-o').value = oText.trim() || '';
    
    // A - Assessment
    let aText = '';
    const aSection = soap.A || soap.a || soap.assessment || soap.Assessment || soap.analisi;
    if (aSection) {
        if (typeof aSection === 'string') {
            aText = aSection;
        } else {
            if (Array.isArray(aSection.problem_list) && aSection.problem_list.length) {
                aText += 'Problemi:\n';
                aSection.problem_list.forEach(p => {
                    if (typeof p === 'string') {
                        aText += `• ${p}\n`;
                    } else {
                        aText += `• ${p.problem || p.name || JSON.stringify(p)}`;
                        if (p.status) aText += ` (${p.status})`;
                        aText += '\n';
                    }
                });
                aText += '\n';
            }
            if (Array.isArray(aSection.differentials) && aSection.differentials.length) {
                aText += `Diagnosi differenziali: ${aSection.differentials.join(', ')}\n\n`;
            }
            if (aSection.diagnosis) aText += `Diagnosi: ${aSection.diagnosis}\n\n`;
            if (aSection.triage_urgency) {
                aText += `Urgenza: ${String(aSection.triage_urgency).toUpperCase()}\n\n`;
            }
            if (Array.isArray(aSection.uncertainties_and_conflicts) && aSection.uncertainties_and_conflicts.length) {
                aText += 'Incertezze/Conflitti:\n';
                aSection.uncertainties_and_conflicts.forEach(u => {
                    aText += `• ${u.topic || u}: ${u.conflict_summary || ''}\n`;
                });
            }
            if (aSection.text) aText += aSection.text;
            if (aSection.contenuto) aText += aSection.contenuto;
        }
    }
    document.getElementById('soap-a').value = aText.trim() || '';
    
    // P - Piano
    let pText = '';
    const pSection = soap.P || soap.p || soap.piano || soap.Piano || soap.plan;
    if (pSection) {
        if (typeof pSection === 'string') {
            pText = pSection;
        } else {
            if (Array.isArray(pSection.diagnostics_planned) && pSection.diagnostics_planned.length) {
                pText += 'Esami pianificati:\n';
                pSection.diagnostics_planned.forEach(d => pText += `• ${typeof d === 'string' ? d : d.test || d}\n`);
                pText += '\n';
            }
            if (Array.isArray(pSection.treatment_plan) && pSection.treatment_plan.length) {
                pText += 'Piano terapeutico:\n';
                pSection.treatment_plan.forEach(t => {
                    if (typeof t === 'string') {
                        pText += `• ${t}\n`;
                    } else {
                        pText += `• ${t.action || t.drug || t.treatment || JSON.stringify(t)}`;
                        if (t.dose_text) pText += ` - ${t.dose_text}`;
                        if (t.duration) pText += ` per ${t.duration}`;
                        if (t.notes) pText += ` (${t.notes})`;
                        pText += '\n';
                    }
                });
                pText += '\n';
            } else if (pSection.treatment_plan && typeof pSection.treatment_plan === 'string') {
                pText += `Piano terapeutico: ${pSection.treatment_plan}\n\n`;
            }
            if (Array.isArray(pSection.client_instructions) && pSection.client_instructions.length) {
                pText += 'Istruzioni proprietario:\n';
                pSection.client_instructions.forEach(i => pText += `• ${typeof i === 'string' ? i : i.instruction || i}\n`);
                pText += '\n';
            }
            if (Array.isArray(pSection.follow_up) && pSection.follow_up.length) {
                pText += 'Follow-up:\n';
                pSection.follow_up.forEach(f => {
                if (typeof f === 'string') {
                    pText += `• ${f}
`;
                } else if (f && typeof f === 'object') {
                    const parts = [];
                    // Support both EN + IT keys
                    if (f.action) parts.push(f.action);
                    if (f.azione) parts.push(f.azione);
                    if (f.text) parts.push(f.text);
                    if (f.testo) parts.push(f.testo);
                    if (f.note) parts.push(f.note);
                    if (f.nota) parts.push(f.nota);
                    if (f.description) parts.push(f.description);
                    if (f.descrizione) parts.push(f.descrizione);
                    if (f.date) parts.push('Data: ' + f.date);
                    if (f.data) parts.push('Data: ' + f.data);
                    const out = parts.filter(Boolean).join(' — ') || JSON.stringify(f);
                    pText += `• ${out}
`;
                } else {
                    pText += `• ${String(f)}
`;
                }
            });
                pText += '\n';
            }
            if (Array.isArray(pSection.red_flags) && pSection.red_flags.length) {
                pText += '⚠️ Red flags:\n';
                pSection.red_flags.forEach(r => pText += `• ${typeof r === 'string' ? r : r.flag || r}\n`);
            }
            if (pSection.text) pText += pSection.text;
            if (pSection.contenuto) pText += pSection.contenuto;
        }
    }
    document.getElementById('soap-p').value = pText.trim() || '';
    
    // Update template title
    document.getElementById('soapTemplateTitle').textContent = templateTitles[currentTemplate] || 'Referto SOAP';
    
    // Show audit info if present
    if (soap.audit) {
        let auditInfo = '';
        if (soap.audit.coverage_notes?.length) {
            auditInfo += 'Note copertura: ' + soap.audit.coverage_notes.join('; ') + '\n';
        }
        if (soap.audit.low_confidence_items?.length) {
            auditInfo += 'Bassa confidenza: ' + soap.audit.low_confidence_items.join('; ');
        }
        if (auditInfo) {
            console.log('SOAP Audit:', auditInfo);
        }
    }
    
    // Show disclaimers
    if (soap.meta?.disclaimers?.length) {
        const disclaimerText = soap.meta.disclaimers.join('\n');
        console.log('Disclaimers:', disclaimerText);
    }
}

// ============================================
// 8B: TEMPLATE EXTRAS + CHECKLIST EXTRACTOR (NO inventions)
// ============================================

function _get8BTemplateConfig() {
    try {
        if (typeof TEMPLATE_CONFIGS !== 'undefined' && TEMPLATE_CONFIGS && TEMPLATE_CONFIGS[currentTemplate]) {
            return TEMPLATE_CONFIGS[currentTemplate];
        }
    } catch (e) {}
    return null;
}

function _build8BExtractionSchema(cfg) {
    const extrasProps = {};
    const checklistProps = {};

    const extras = Array.isArray(cfg?.extraFields) ? cfg.extraFields : [];
    const checklistItems = Array.isArray(cfg?.checklistItems) ? cfg.checklistItems : [];

    extras.forEach(f => {
        extrasProps[f.key] = { type: 'string', description: f.label || f.key };
    });
    checklistItems.forEach(it => {
        checklistProps[it.key] = { type: ['boolean', 'null'], description: it.label || it.key };
    });

    return {
        name: 'ada_template_extractor_8b',
        strict: true,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                extras: {
                    type: 'object',
                    additionalProperties: false,
                    properties: extrasProps,
                    required: Object.keys(extrasProps)
                },
                checklist: {
                    type: 'object',
                    additionalProperties: false,
                    properties: checklistProps,
                    required: Object.keys(checklistProps)
                }
            },
            required: ['extras', 'checklist']
        }
    };
}

async function extractTemplateExtrasAndChecklistFromText(transcriptionText, soapResult, options = {}) {
    const signal = (options || {}).signal || undefined;
    const cfg = _get8BTemplateConfig();
    if (!cfg) return;

    const extras = Array.isArray(cfg.extraFields) ? cfg.extraFields : [];
    const checklistItems = Array.isArray(cfg.checklistItems) ? cfg.checklistItems : [];
    if (!extras.length && !checklistItems.length) return;

    const schema = _build8BExtractionSchema(cfg);
    const templateName = (typeof templateTitles !== 'undefined' && templateTitles[currentTemplate]) ? templateTitles[currentTemplate] : String(currentTemplate);

    const fieldList = extras.map(f => `- ${f.label} (key: ${f.key})`).join('\n') || '(nessuno)';
    const checklistList = checklistItems.map(i => `- ${i.label} (key: ${i.key})`).join('\n') || '(nessuno)';

    const soapPreview = soapResult ? `\n\nSOAP (solo contesto, NON inventare oltre):\nS: ${JSON.stringify(soapResult.S || soapResult.s || '')}\nO: ${JSON.stringify(soapResult.O || soapResult.o || '')}\nA: ${JSON.stringify(soapResult.A || soapResult.a || '')}\nP: ${JSON.stringify(soapResult.P || soapResult.p || '')}` : '';

    const prompt = `Sei un estrattore dati per referti veterinari.
DEVI estrarre SOLO informazioni esplicitamente presenti nel testo.
NON inventare, NON completare con conoscenza clinica, NON dedurre.

Regole:
- Per ogni extra (stringa): se nel testo NON c'è evidenza, restituisci stringa vuota "".
- Se una informazione è già presente nel SOAP, NON ripeterla negli extra: lascia la stringa vuota.
- Per ogni checklist item: 
  - true SOLO se nel testo è chiaramente indicato che è stato eseguito/rilevato.
  - false SOLO se nel testo è chiaramente indicato che NON è stato eseguito/è negativo.
  - null se NON è deducibile dal testo.

Template: ${templateName}

Extra fields:
${fieldList}

Checklist:
${checklistList}

TESTO (unica fonte):
"""
${transcriptionText}
"""
${soapPreview}
`;

    const response = await fetchApi('/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'Rispondi SOLO con JSON conforme allo schema. Nessun testo extra.' },
                { role: 'user', content: prompt }
            ],
            response_format: {
                type: 'json_schema',
                json_schema: schema
            },
            temperature: 0.0
        }),
        signal
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Extractor HTTP ${response.status}: ${errText.substring(0, 180)}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Risposta vuota (extractor)');

    const result = JSON.parse(content);
    const extrasOut = (result && result.extras && typeof result.extras === 'object') ? result.extras : {};
    const checklistOut = (result && result.checklist && typeof result.checklist === 'object') ? result.checklist : {};

    const normalizeText = (value) => String(value || '')
        .toLowerCase()
        .replace(/[\s\W_]+/g, ' ')
        .trim();
    const soapCombined = normalizeText(
        `${soapResult?.S || soapResult?.s || ''} ${soapResult?.O || soapResult?.o || ''} ${soapResult?.A || soapResult?.a || ''} ${soapResult?.P || soapResult?.p || ''}`
    );
    Object.keys(extrasOut || {}).forEach(key => {
        const raw = (extrasOut[key] || '').toString().trim();
        const norm = normalizeText(raw);
        if (!raw || norm.length < 8) return;
        if (soapCombined.includes(norm)) {
            extrasOut[key] = '';
        }
    });

    // Push into UI state
    if (typeof setTemplateExtractionResult === 'function') {
        setTemplateExtractionResult(extrasOut, checklistOut);
    } else {
        // Fallback
        try { currentTemplateExtras = extrasOut; } catch (e) {}
        try { currentSOAPChecklist = checklistOut; } catch (e) {}
    }
}

// ============================================
// SAVE & EXPORT
// ============================================

function saveSOAP() {
    if (typeof migrateLegacyHistoryDataIfNeeded === 'function') {
        try { migrateLegacyHistoryDataIfNeeded(); } catch (e) {}
    }

    const nowIso = new Date().toISOString();

    const soapData = {
        s: (document.getElementById('soap-s')?.value || '').toString(),
        o: (document.getElementById('soap-o')?.value || '').toString(),
        a: (document.getElementById('soap-a')?.value || '').toString(),
        p: (document.getElementById('soap-p')?.value || '').toString()
    };

    const ownerExplanation = (document.getElementById('ownerExplanation')?.value || '').toString();

    // Base title derived from selected template (manual archivio)
    const baseTitle = (typeof templateTitles !== 'undefined' && templateTitles[currentTemplate])
        ? templateTitles[currentTemplate]
        : 'Referto';

    // If we are editing an existing archived record, update by id; otherwise create a NEW one.
    const editingId = (typeof currentEditingHistoryId !== 'undefined' && currentEditingHistoryId) ? currentEditingHistoryId : null;
    const existingIndex = editingId ? (historyData || []).findIndex(r => r && r.id === editingId) : -1;

    let recordId = editingId;
    let createdAt = nowIso;
    let titleDisplay = baseTitle;

    if (existingIndex >= 0) {
        const existing = historyData[existingIndex] || {};
        recordId = existing.id || recordId;
        createdAt = existing.createdAt || existing.date || createdAt;
        titleDisplay = existing.titleDisplay || titleDisplay;
    } else {
        if (typeof _generateArchiveId === 'function') recordId = _generateArchiveId();
        else recordId = 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);

        if (typeof _computeDedupTitle === 'function') titleDisplay = _computeDedupTitle(baseTitle);
        else titleDisplay = baseTitle;
    }

    const record = {
        id: recordId,
        titleDisplay,
        createdAt,
        templateKey: currentTemplate,
        soapData,

        // Additional metadata
        extras: { ...(currentTemplateExtras || {}) },
        checklist: { ...currentSOAPChecklist },
        patient: getPatientData(),
        diarized: lastTranscriptionDiarized,
        structuredResult: lastSOAPResult,
        ownerExplanation: ownerExplanation.trim() ? ownerExplanation : ''
    };

    // Back-compat fields
    record.template = record.templateKey;
    record.date = record.createdAt;
    record.s = record.soapData.s;
    record.o = record.soapData.o;
    record.a = record.soapData.a;
    record.p = record.soapData.p;

    if (existingIndex >= 0) {
        historyData[existingIndex] = { ...historyData[existingIndex], ...record };
        showToast('Referto aggiornato', 'success');
        currentEditingSOAPIndex = existingIndex;
        currentEditingHistoryId = recordId;
    } else {
        historyData.push(record);
        currentEditingSOAPIndex = historyData.length - 1;
        currentEditingHistoryId = recordId;
        showToast('Referto salvato in archivio', 'success');
    }

    saveData();
    updateHistoryBadge();
    renderHistory();
}

function exportTXT() {
    const soap = {
        s: (document.getElementById('soap-s')?.value || '').toString().trim(),
        o: (document.getElementById('soap-o')?.value || '').toString().trim(),
        a: (document.getElementById('soap-a')?.value || '').toString().trim(),
        p: (document.getElementById('soap-p')?.value || '').toString().trim()
    };

    const patient = getPatientData();
    const vetName = (typeof getVetName === 'function') ? (getVetName() || '').toString().trim() : '';
    const templateTitle = (typeof templateTitles !== 'undefined' && templateTitles[currentTemplate]) ? templateTitles[currentTemplate] : 'Referto';

    const out = [];
    out.push(`REFERTO: ${templateTitle.toUpperCase()}`);
    out.push('='.repeat(50));
    out.push('');

    const metaParts = [];
    if (patient?.petName) metaParts.push(`Paziente: ${patient.petName}`);
    if (patient?.petSpecies) metaParts.push(`Specie: ${patient.petSpecies}`);
    if (patient?.ownerName) metaParts.push(`Proprietario: ${patient.ownerName}`);
    if (metaParts.length) out.push(metaParts.join(' | '));
    if (vetName) out.push(`Veterinario: ${vetName}`);
    out.push(`Data: ${new Date().toLocaleDateString('it-IT')}`);
    out.push('');

    // Template-specific extras + checklist
    const cfg = (typeof _get8BTemplateConfig === 'function') ? _get8BTemplateConfig() : null;
    const extrasObj = (typeof currentTemplateExtras === 'object' && currentTemplateExtras) ? currentTemplateExtras : {};
    const checklistObj = (typeof currentSOAPChecklist === 'object' && currentSOAPChecklist) ? currentSOAPChecklist : {};

    const extrasLines = [];
    if (cfg && Array.isArray(cfg.extraFields) && cfg.extraFields.length) {
        for (const f of cfg.extraFields) {
            const v = (extrasObj?.[f.key] || '').toString().trim();
            if (v) extrasLines.push(`${f.label}: ${v}`);
        }
    } else {
        for (const [k, v0] of Object.entries(extrasObj || {})) {
            const v = (v0 || '').toString().trim();
            if (v) extrasLines.push(`${k}: ${v}`);
        }
    }
    if (extrasLines.length) {
        out.push('DATI CLINICI SPECIALISTICI');
        out.push('-'.repeat(30));
        out.push(...extrasLines);
        out.push('');
    }

    const checklistLines = [];
    if (cfg && Array.isArray(cfg.checklistItems) && cfg.checklistItems.length) {
        for (const it of cfg.checklistItems) {
            const st = checklistObj?.[it.key];
            if (st === true) checklistLines.push(`✓ ${it.label}`);
            else if (st === false) checklistLines.push(`✗ ${it.label}`);
        }
    } else {
        for (const [k, st] of Object.entries(checklistObj || {})) {
            if (st === true) checklistLines.push(`✓ ${k}`);
            else if (st === false) checklistLines.push(`✗ ${k}`);
        }
    }
    if (checklistLines.length) {
        out.push('CHECKLIST');
        out.push('-'.repeat(30));
        out.push(...checklistLines);
        out.push('');
    }

    const blocks = [
        ['SOGGETTIVO', soap.s],
        ['OGGETTIVO', soap.o],
        ['ANALISI CLINICA', soap.a],
        ['PIANO', soap.p]
    ];

    for (const [title, content] of blocks) {
        if (!content) continue; // omit empty blocks
        out.push(title);
        out.push('-'.repeat(30));
        out.push(content);
        out.push('');
    }

    const filename = 'referto_' + (patient?.petName || 'paziente') + '.txt';
    downloadFile(out.join('\n').trimEnd() + "\n", filename, 'text/plain');
}


function exportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const patient = getPatientData();
    const vetName = (typeof getVetName === 'function') ? (getVetName() || '').toString().trim() : '';

    const templateTitle = (typeof templateTitles !== 'undefined' && templateTitles[currentTemplate]) ? templateTitles[currentTemplate] : 'Referto';

    const soap = {
        s: (document.getElementById('soap-s')?.value || '').toString().trim(),
        o: (document.getElementById('soap-o')?.value || '').toString().trim(),
        a: (document.getElementById('soap-a')?.value || '').toString().trim(),
        p: (document.getElementById('soap-p')?.value || '').toString().trim()
    };

    // Header
    doc.setFillColor(30, 58, 95);
    doc.rect(0, 0, 210, 35, 'F');

    // Logo (AniCura) — più in basso
    try {
        addAnicuraLogoToPdf(doc, 10, 9, 35, 22);
    } catch (e) {}

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text('Referto: ' + templateTitle, 120, 15, { align: 'center' });
    doc.setFontSize(9);
    // Patient info (no placeholders)
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    let y = 44;

    const metaParts = [];
    if (patient?.petName) metaParts.push(`Paziente: ${patient.petName}`);
    if (patient?.petSpecies) metaParts.push(`Specie: ${patient.petSpecies}`);
    if (patient?.ownerName) metaParts.push(`Proprietario: ${patient.ownerName}`);
    metaParts.push(`Data: ${new Date().toLocaleDateString('it-IT')}`);
    if (metaParts.length) {
        doc.text(metaParts.join(' | '), 15, y);
        y += 10;
    }
    if (vetName) {
        doc.text(`Veterinario: ${vetName}`, 15, y);
        y += 10;
    }

    const sections = [
        { letter: 'S', title: 'Soggettivo', color: [30, 58, 95], content: soap.s },
        { letter: 'O', title: 'Oggettivo', color: [45, 90, 135], content: soap.o },
        { letter: 'A', title: 'Analisi clinica', color: [194, 78, 23], content: soap.a },
        { letter: 'P', title: 'Piano', color: [245, 157, 29], content: soap.p }
    ];

    const ensurePage = () => {
        if (y > 280) { doc.addPage(); y = 20; }
    };

    // SOAP sections (omit empty)
    for (const section of sections) {
        if (!section.content) continue;
        if (y > 250) { doc.addPage(); y = 20; }

        doc.setFillColor(...section.color);
        doc.circle(20, y, 5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.text(section.letter, 20, y + 1, { align: 'center' });

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text(section.title, 30, y + 1);
        doc.setFont(undefined, 'normal');

        // più spazio sotto cerchio S/O/A/P
        y += 11;

        doc.setFontSize(10);
        const lines = doc.splitTextToSize(section.content, 180);
        for (const line of lines) {
            ensurePage();
            doc.text(line, 15, y);
            y += 5;
        }
        y += 6;
    }

    // Template extras + checklist (omit empties always)
    const cfg = (typeof _get8BTemplateConfig === 'function') ? _get8BTemplateConfig() : null;
    const extrasObj = (typeof currentTemplateExtras === 'object' && currentTemplateExtras) ? currentTemplateExtras : {};
    const checklistObj = (typeof currentSOAPChecklist === 'object' && currentSOAPChecklist) ? currentSOAPChecklist : {};

    const extrasPairs = [];
    if (cfg && Array.isArray(cfg.extraFields) && cfg.extraFields.length) {
        for (const f of cfg.extraFields) {
            const v = (extrasObj?.[f.key] || '').toString().trim();
            if (v) extrasPairs.push([f.label, v]);
        }
    }

    const checklistPairs = [];
    if (cfg && Array.isArray(cfg.checklistItems) && cfg.checklistItems.length) {
        for (const it of cfg.checklistItems) {
            const st = checklistObj?.[it.key];
            if (st === true) checklistPairs.push(['✓', it.label]);
            else if (st === false) checklistPairs.push(['✗', it.label]);
        }
    }

    const addHeading = (title) => {
        if (y > 260) { doc.addPage(); y = 20; }
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text(title, 15, y);
        doc.setFont(undefined, 'normal');
        y += 8;
    };

    if (extrasPairs.length) {
        addHeading('Dati clinici specialistici');
        doc.setFontSize(10);
        for (const [label, value] of extrasPairs) {
            const line = `${label}: ${value}`;
            const lines = doc.splitTextToSize(line, 180);
            for (const l of lines) {
                ensurePage();
                doc.text(l, 15, y);
                y += 5;
            }
            y += 1;
        }
        y += 6;
    }

    if (checklistPairs.length) {
        addHeading('Checklist');
        doc.setFontSize(10);
        for (const [mark, label] of checklistPairs) {
            ensurePage();
            doc.text(`${mark} ${label}`, 15, y);
            y += 5;
        }
        y += 6;
    }

    // Footer (versione corretta)
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text('Trascritto con ADA v6.16.2 - AI Driven Abupet', 105, 290, { align: 'center' });

    doc.save('referto_' + (patient?.petName || 'paziente') + '.pdf');
    showToast('PDF esportato', 'success');
}



// ============================================
// OWNER EXPLANATION
// ============================================

// generateOwnerExplanation(soapOverride?, options?)
// - soapOverride: {s,o,a,p} (optional)
// - options.saveToHistoryId: if provided, persist ownerExplanation into that history record
// - options.navigate: if true, navigate to Owner page (default true)
async function generateOwnerExplanation(soapOverride, options) {
    const t0 = performance.now();
    const opts = options || {};

    const soap = soapOverride || {
        s: document.getElementById('soap-s').value,
        o: document.getElementById('soap-o').value,
        a: document.getElementById('soap-a').value,
        p: document.getElementById('soap-p').value
    };

    if (!soap || (!soap.a && !soap.p)) {
        showToast('Genera prima il referto SOAP', 'error');
        return;
    }

    showProgress(true);

    const vetName = (typeof getVetName === 'function') ? getVetName() : '';
    const signatureHint = vetName ? `

Chiudi con una riga finale: "Firmato: ${vetName}".` : '';

    const prompt = `Sei un veterinario che deve spiegare la situazione al proprietario di un animale.
Basandoti su questo referto SOAP, scrivi una spiegazione CHIARA e RASSICURANTE in italiano.
Usa un linguaggio semplice, evita termini tecnici complessi.
Includi: cosa abbiamo trovato, cosa significa, cosa faremo, cosa deve fare il proprietario.${signatureHint}

REFERTO:
Diagnosi/Analisi clinica: ${soap.a}
Piano: ${soap.p}
Sintomi riferiti: ${soap.s}
Esame obiettivo: ${soap.o}

Scrivi la spiegazione per il proprietario:`;

    try {
        const response = await fetchApi('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.5,
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
        }

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const explanation = data.choices?.[0]?.message?.content || '';
        const shouldUpdateUi = !opts.saveToHistoryId || !currentEditingHistoryId || opts.saveToHistoryId === currentEditingHistoryId;
        if (shouldUpdateUi) {
            document.getElementById('ownerExplanation').value = explanation;
        }

        // Track usage (prefer real token counts)
        trackChatUsageOrEstimate('gpt-4o', prompt, explanation, data.usage);

        // Persist into history record if requested
        if (opts.saveToHistoryId) {
            try {
                const idx = (historyData || []).findIndex(r => r && r.id === opts.saveToHistoryId);
                if (idx >= 0) {
                    historyData[idx].ownerExplanation = explanation;
                    saveData();
                    updateHistoryBadge();
                    renderHistory();
                }
            } catch (e) {}
        }

        if (shouldUpdateUi) {
            // Generate glossary (tracked inside)
            await generateGlossary((soap.a || '') + ' ' + (soap.p || ''));

            const shouldNavigate = (typeof opts.navigate === 'boolean') ? opts.navigate : true;
            if (shouldNavigate && typeof navigateToPage === 'function') navigateToPage('owner');
        }

        const dt = ((performance.now() - t0) / 1000).toFixed(1);
        if (shouldUpdateUi) {
            showToast(`Spiegazione generata in ${dt} s`, 'success');
        }

    } catch (e) {
        showToast('Errore: ' + e.message, 'error');
    }

    showProgress(false);
}



function exportOwnerTXT() {
    const patient = getPatientData();
    const vetName = (typeof getVetName === 'function') ? getVetName() : '';

    let text = (document.getElementById('ownerExplanation')?.value || '').toString();
    if (vetName && text && !/\bFirmato\s*:/i.test(text)) {
        text = text.trimEnd() + `\n\nFirmato: ${vetName}\n`;
    }

    downloadFile(text, 'spiegazione_' + (patient.petName || 'paziente') + '.txt', 'text/plain');
}

function exportOwnerPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const patient = getPatientData();
    const vetName = (typeof getVetName === 'function') ? (getVetName() || '').toString().trim() : '';

    // Header
    doc.setFillColor(30, 58, 95);
    doc.rect(0, 0, 210, 30, 'F');

    // Logo (AniCura) — più in basso
    try {
        addAnicuraLogoToPdf(doc, 10, 8, 35, 20);
    } catch (e) {}

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text('Informazioni per il Proprietario', 105, 18, { align: 'center' });

    // Content
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    let y = 40;

    if (patient?.petName) {
        doc.text(`Paziente: ${patient.petName}`, 15, y);
        y += 8;
    }

    if (vetName) {
        doc.setFontSize(10);
        doc.text(`Veterinario: ${vetName}`, 15, y);
        y += 8;
    }

    doc.setFontSize(10);
    let text = (document.getElementById('ownerExplanation')?.value || '').toString();
    if (vetName && text && !/\bFirmato\s*:/i.test(text)) {
        text = text.trimEnd() + `\n\nFirmato: ${vetName}`;
    }

    const lines = doc.splitTextToSize(text, 180);
    for (const line of lines) {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(line, 15, y);
        y += 5;
    }

    // Footer (versione corretta)
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text('Generato con ADA v6.16.2 - AI Driven Abupet', 105, 290, { align: 'center' });

    doc.save('spiegazione_' + (patient?.petName || 'paziente') + '.pdf');
    showToast('PDF esportato', 'success');
}




// ============================================
// GLOSSARY GENERATION
// ============================================

async function generateGlossary() {
    const t0 = performance.now();

    const soapA = (document.getElementById('soap-a')?.value || '').toString().trim();
    const soapP = (document.getElementById('soap-p')?.value || '').toString().trim();

    const target = document.getElementById('glossaryContent');
    if (target) target.innerHTML = '';

    if (!soapA && !soapP) {
        showToast('Genera prima il referto', 'error');
        return;
    }

    showProgress(true);

    const prompt = `Crea un glossario (max 10 voci) dei termini medici/veterinari presenti in questa diagnosi e piano.
Per ciascuna voce, scrivi una spiegazione molto semplice e breve, adatta a un proprietario.

Diagnosi: ${soapA}
Piano: ${soapP}

Rispondi in JSON: {"glossary": [{"term": "...", "meaning": "..."}]}
Lingua: italiano.`;

    try {
        const response = await fetchApi('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.4,
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
        }

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const content = data.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);

        let items = [];
        if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            items = Array.isArray(result.glossary) ? result.glossary : [];
        }

        if (target) {
            if (!items.length) {
                target.innerHTML = '<p style="color:#888;">Nessun termine rilevante trovato.</p>';
            } else {
                target.innerHTML = items.map(it => {
                    const term = (it.term || '').toString();
                    const meaning = (it.meaning || '').toString();
                    return `
                        <div class="glossary-item">
                            <div class="glossary-term">${term}</div>
                            <div class="glossary-meaning">${meaning}</div>
                        </div>
                    `;
                }).join('');
            }
        }

        trackChatUsageOrEstimate('gpt-4o', prompt, content, data.usage);

        const dt = ((performance.now() - t0) / 1000).toFixed(1);
        showToast(`Glossario generato in ${dt} s`, 'success');

    } catch (e) {
        showToast('Errore: ' + e.message, 'error');
    } finally {
        showProgress(false);
    }
}
// ============================================
// FAQ GENERATION
// ============================================

async function generateFAQ() {
    const t0 = performance.now();

    const soap = {
        a: document.getElementById('soap-a').value,
        p: document.getElementById('soap-p').value
    };

    if (!soap.a && !soap.p) {
        showToast('Genera prima il referto', 'error');
        return;
    }

    showProgress(true);

    const prompt = `Basandoti su questa diagnosi e piano terapeutico veterinario, genera 5 FAQ che un proprietario potrebbe chiedere.
Diagnosi: ${soap.a}
Piano: ${soap.p}

Rispondi in JSON: {"faq": [{"question": "...", "answer": "..."}]}
Le risposte devono essere chiare, rassicuranti e in italiano.`;

    try {
        const response = await fetchApi('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.5,
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
        }

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const content = data.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            document.getElementById('faqList').innerHTML = (result.faq || []).map(item => `
                <div class="faq-item" onclick="this.classList.toggle('open')">
                    <div class="faq-question">${item.question}</div>
                    <div class="faq-answer">${item.answer}</div>
                </div>
            `).join('');
        }

        // Track usage
        trackChatUsageOrEstimate('gpt-4o', prompt, content, data.usage);

        const dt = ((performance.now() - t0) / 1000).toFixed(1);
        showToast(`FAQ generate in ${dt} s`, 'success');

    } catch (e) {
        showToast('Errore: ' + e.message, 'error');
    } finally {
        showProgress(false);
    }
}

// ============================================
// VOICE CORRECTION
// ============================================

function startCorrectionRecording() {
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            correctionRecorder = new MediaRecorder(stream);
            correctionChunks = [];
            
            correctionRecorder.ondataavailable = e => correctionChunks.push(e.data);
            correctionRecorder.start();
            
            document.getElementById('btnRecordCorrection').style.display = 'none';
            document.getElementById('correctionButtons').classList.add('active');
            
            showToast('🔴 Descrivi la correzione...', 'success');
        })
        .catch(err => {
            showToast('Errore microfono', 'error');
        });
}

function cancelCorrection() {
    if (correctionRecorder && correctionRecorder.state !== 'inactive') {
        correctionRecorder.stop();
        correctionRecorder.stream.getTracks().forEach(t => t.stop());
    }
    correctionRecorder = null;
    correctionChunks = [];
    
    document.getElementById('btnRecordCorrection').style.display = '';
    document.getElementById('correctionButtons').classList.remove('active');
    showToast('Correzione annullata', 'success');
}

async function sendCorrection() {
    if (!correctionRecorder || correctionRecorder.state === 'inactive') return;

    const t0 = performance.now();
    showProgress(true);

    correctionRecorder.onstop = async () => {
        const audioBlob = new Blob(correctionChunks, { type: 'audio/webm' });

        try {
            // 1) Transcribe correction
            const formData = new FormData();
            formData.append('file', audioBlob, 'correction.webm');
            formData.append('model', 'whisper-1');
            formData.append('language', 'it');

            const transcribeResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + API_KEY },
                body: formData
            });

            if (!transcribeResponse.ok) {
                const errText = await transcribeResponse.text();
                throw new Error(`Trascrizione correzione fallita (HTTP ${transcribeResponse.status}): ${errText.substring(0, 200)}`);
            }

            const transcribeData = await transcribeResponse.json();
            if (transcribeData.error) throw new Error(transcribeData.error.message);

            const correctionText = (transcribeData.text || '').trim();
            if (!correctionText) throw new Error('Testo correzione vuoto');

            // Track whisper minutes (rough estimate)
            if (typeof trackTranscriptionMinutes === 'function') {
                trackTranscriptionMinutes(0.2, 'whisper');
            }

            // 2) Apply correction with GPT
            const currentSOAP = {
                s: document.getElementById('soap-s').value,
                o: document.getElementById('soap-o').value,
                a: document.getElementById('soap-a').value,
                p: document.getElementById('soap-p').value
            };
            const extrasObj = (typeof currentTemplateExtras === 'object' && currentTemplateExtras) ? currentTemplateExtras : {};
            const checklistObj = (typeof currentSOAPChecklist === 'object' && currentSOAPChecklist) ? currentSOAPChecklist : {};

            const prompt = `Applica questa correzione vocale al referto SOAP.
Correzione richiesta: "${correctionText}"

Referto attuale:
S: ${currentSOAP.s}
O: ${currentSOAP.o}
A: ${currentSOAP.a}
P: ${currentSOAP.p}

Dati clinici specialistici (extras, JSON):
${JSON.stringify(extrasObj)}

Checklist (template, JSON con true/false/null):
${JSON.stringify(checklistObj)}

Restituisci il referto corretto in JSON: {"S": "...", "O": "...", "A": "...", "P": "...", "extras": {...}, "checklist": {...}}`;

            const response = await fetchApi('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.3
        })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Applicazione correzione fallita (HTTP ${response.status}): ${errText.substring(0, 200)}`);
            }

            const data = await response.json();
            if (data.error) throw new Error(data.error.message);

            const content = data.choices?.[0]?.message?.content || '';
            const jsonMatch = content.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                const corrected = JSON.parse(jsonMatch[0]);
                if (corrected.S) document.getElementById('soap-s').value = corrected.S;
                if (corrected.O) document.getElementById('soap-o').value = corrected.O;
                if (corrected.A) document.getElementById('soap-a').value = corrected.A;
                if (corrected.P) document.getElementById('soap-p').value = corrected.P;
                if (corrected.extras && typeof corrected.extras === 'object') {
                    currentTemplateExtras = { ...currentTemplateExtras, ...corrected.extras };
                    try { renderTemplateExtras(); } catch (e) {}
                }
                if (corrected.checklist && typeof corrected.checklist === 'object') {
                    currentSOAPChecklist = { ...currentSOAPChecklist, ...corrected.checklist };
                    try { renderChecklistInSOAP(); } catch (e) {}
                }
                try { applyHideEmptyVisibility(); } catch (e) {}
            }

            // Track chat usage
            trackChatUsageOrEstimate('gpt-4o', prompt, content, data.usage);

            const dt = ((performance.now() - t0) / 1000).toFixed(1);
            showToast(`Correzione applicata in ${dt} s`, 'success');

        } catch (e) {
            showToast('Errore: ' + e.message, 'error');
        } finally {
            try { correctionRecorder?.stream?.getTracks?.().forEach(t => t.stop()); } catch {}
            correctionRecorder = null;
            correctionChunks = [];

            document.getElementById('btnRecordCorrection').style.display = '';
            document.getElementById('correctionButtons').classList.remove('active');
            showProgress(false);
        }
    };

    correctionRecorder.stop();
}
