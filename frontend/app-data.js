// ADA v6.17.3 - Data Management Functions
// Note: saveData, savePatient and saveDiary are overridden in app-pets.js for multi-pet support

// ============================================
// HELPERS
// ============================================

function _extractJsonObject(text) {
    const t = String(text || '');
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    const candidate = t.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch (e) { return null; }
}

function _extractJsonArray(text) {
    const t = String(text || '');
    const start = t.indexOf('[');
    const end = t.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return null;
    const candidate = t.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch (e) { return null; }
}

function _getMostRecentDiagnosisText() {
    try {
        const sorted = (typeof _getHistorySortedForUI === 'function')
            ? _getHistorySortedForUI()
            : (historyData || []).slice().sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
        const rec = sorted && sorted[0];
        return (rec?.soapData?.a || rec?.a || '').trim() || 'N/D';
    } catch (e) {
        return 'N/D';
    }
}


// ============================================
// PHOTOS
// ============================================

function addPhotos(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => { 
            photos.push(e.target.result); 
            renderPhotos(); 
            saveData(); 
        };
        reader.readAsDataURL(file);
    });
    event.target.value = '';
}

function capturePhoto() {
    const input = document.createElement('input');
    input.type = 'file'; 
    input.accept = 'image/*'; 
    input.capture = 'environment';
    input.onchange = addPhotos; 
    input.click();
}

function renderPhotos() {
    const grid = document.getElementById('photoGrid');
    if (!grid) return;
    
    if (photos.length === 0) {
        grid.innerHTML = '<p style="color:#888;text-align:center;padding:20px;grid-column:1/-1;">Nessuna foto</p>';
        return;
    }
    
    grid.innerHTML = photos.map((photo, i) => `
        <div class="photo-item">
            <img src="${photo}" alt="Foto ${i + 1}" onclick="openPhotoFullscreen(${i})">
            <button class="delete-btn" onclick="deletePhoto(${i})">×</button>
        </div>
    `).join('');
}

function openPhotoFullscreen(index) {
    const photo = photos[index];
    if (!photo) return;
    
    const overlay = document.createElement('div');
    overlay.id = 'photoOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:pointer;';
    overlay.onclick = () => overlay.remove();
    
    const img = document.createElement('img');
    img.src = photo;
    img.style.cssText = 'max-width:95%;max-height:95%;object-fit:contain;';
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = 'position:absolute;top:20px;right:20px;background:white;border:none;font-size:30px;width:50px;height:50px;border-radius:50%;cursor:pointer;';
    closeBtn.onclick = () => overlay.remove();
    
    overlay.appendChild(img);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);
}

function deletePhoto(index) { 
    if (confirm('Eliminare questa foto?')) {
        photos.splice(index, 1); 
        renderPhotos(); 
        saveData();
        showToast('Foto eliminata', 'success');
    }
}

// ============================================
// PATIENT DATA
// ============================================

function getPatientData() {
    return {
        petName: document.getElementById('petName')?.value || '',
        petSpecies: document.getElementById('petSpecies')?.value || '',
        petBreed: document.getElementById('petBreed')?.value || '',
        petAge: document.getElementById('petAge')?.value || '',
        petSex: document.getElementById('petSex')?.value || '',
        petWeight: document.getElementById('petWeight')?.value || '',
        petMicrochip: document.getElementById('petMicrochip')?.value || '',
        ownerName: document.getElementById('ownerName')?.value || '',
        ownerPhone: document.getElementById('ownerPhone')?.value || '',
        visitDate: document.getElementById('visitDate')?.value || ''
    };
}

function getLifestyleData() {
    const householdSelect = document.getElementById('petHousehold');
    const selectedHousehold = householdSelect ? Array.from(householdSelect.selectedOptions).map(opt => opt.value).join(', ') : '';
    
    return {
        lifestyle: document.getElementById('petLifestyle')?.value || '',
        household: selectedHousehold,
        activityLevel: document.getElementById('petActivityLevel')?.value || '',
        dietType: document.getElementById('petDietType')?.value || '',
        dietPreferences: document.getElementById('petDietPreferences')?.value || '',
        knownConditions: document.getElementById('petKnownConditions')?.value || '',
        currentMeds: document.getElementById('petCurrentMeds')?.value || '',
        behaviorNotes: document.getElementById('petBehaviorNotes')?.value || '',
        seasonContext: document.getElementById('petSeasonContext')?.value || '',
        location: document.getElementById('petLocation')?.value || ''
    };
}

function setPatientData(data) {
    const fields = ['petName', 'petSpecies', 'petBreed', 'petAge', 'petSex', 'petWeight', 'petMicrochip', 'ownerName', 'ownerPhone', 'visitDate'];
    fields.forEach(f => {
        const el = document.getElementById(f);
        if (el) el.value = (data && data[f]) || '';
    });
}

function setLifestyleData(data) {
    const mapping = {
        'lifestyle': 'petLifestyle',
        'activityLevel': 'petActivityLevel',
        'dietType': 'petDietType',
        'dietPreferences': 'petDietPreferences',
        'knownConditions': 'petKnownConditions',
        'currentMeds': 'petCurrentMeds',
        'behaviorNotes': 'petBehaviorNotes',
        'seasonContext': 'petSeasonContext',
        'location': 'petLocation'
    };
    
    // Always set values, even if empty (to clear fields when switching pets)
    Object.keys(mapping).forEach(key => {
        const el = document.getElementById(mapping[key]);
        if (el) el.value = (data && data[key]) || '';
    });
    
    // Handle household multi-select
    const householdSelect = document.getElementById('petHousehold');
    if (householdSelect) {
        const values = (data && data.household) ? data.household.split(', ') : [];
        Array.from(householdSelect.options).forEach(opt => opt.selected = values.includes(opt.value));
    }
    
    checkAndExpandLifestyle();
}

function checkAndExpandLifestyle() {
    const data = getLifestyleData();
    const hasData = data.lifestyle || data.household || data.activityLevel || data.dietType || 
                    data.dietPreferences || data.knownConditions || data.currentMeds || 
                    data.behaviorNotes || data.seasonContext || data.location;
    
    if (hasData) {
        const section = document.getElementById('lifestyleSection');
        if (section && !section.classList.contains('open')) section.classList.add('open');
    }
}

function savePatient() {
    localStorage.setItem('ada_patient', JSON.stringify(getPatientData()));
    localStorage.setItem('ada_lifestyle', JSON.stringify(getLifestyleData()));
    showToast('Dati paziente salvati', 'success');
}

// ============================================
// DATA PERSISTENCE
// ============================================

// saveData() is defined in app-pets.js to save to IndexedDB

function loadData() {
    photos = JSON.parse(localStorage.getItem('ada_photos') || '[]');
    vitalsData = JSON.parse(localStorage.getItem('ada_vitals') || '[]');
    historyData = JSON.parse(localStorage.getItem('ada_history') || '[]');
    medications = JSON.parse(localStorage.getItem('ada_medications') || '[]');
    appointments = JSON.parse(localStorage.getItem('ada_appointments') || '[]');
    
    setPatientData(JSON.parse(localStorage.getItem('ada_patient') || '{}'));
    setLifestyleData(JSON.parse(localStorage.getItem('ada_lifestyle') || '{}'));
    
    const diary = localStorage.getItem('ada_diary');
    if (diary) {
        const diaryEl = document.getElementById('diaryText');
        if (diaryEl) diaryEl.value = diary;
    }
    
    loadApiUsage();
    renderPhotos();
}

// ============================================
// CLINICAL PROFILE
// ============================================

async function generateDiary() {
    showProgress(true);
    const patient = getPatientData();
    const lifestyle = getLifestyleData();
    const vetName = (typeof getVetName === 'function') ? getVetName() : '';
    const generatedDate = new Date().toLocaleDateString('it-IT');
    
    const historyText = (historyData || []).map(h => {
        const d = new Date(h.createdAt || h.date || Date.now()).toLocaleDateString('it-IT');
        const tk = h.templateKey || h.template || 'generale';
        const a = ((h.soapData && h.soapData.a) ? h.soapData.a : (h.a || '')).toString();
        return `${d} - ${templateTitles[tk] || 'Visita'}: ${(a.substring(0, 100) || 'N/D')}`;
    }).join('\n') || 'Nessuno';
    const vitalsText = vitalsData.map(v => `${new Date(v.date).toLocaleDateString('it-IT')}: Peso ${v.weight}kg, T ${v.temp}°C`).join('\n') || 'Nessuno';
    const medsText = medications.map(m => `${m.name} ${m.dosage} ${m.frequency}`).join('\n') || 'Nessuno';
    
    const prompt = `Genera un profilo sanitario per questo paziente veterinario.

PAZIENTE: ${patient.petName || 'N/D'}, ${patient.petSpecies || 'N/D'}, ${patient.petBreed || 'N/D'}, ${patient.petAge || 'N/D'}
PROPRIETARIO: ${patient.ownerName || 'N/D'}
STILE DI VITA: Ambiente ${lifestyle.lifestyle || 'N/D'}, Attività ${lifestyle.activityLevel || 'N/D'}
CONDIZIONI NOTE: ${lifestyle.knownConditions || 'Nessuna'}

PARAMETRI VITALI: ${vitalsText}
FARMACI: ${medsText}
STORICO: ${historyText}

Scrivi un profilo sanitario professionale e sintetico.
Se inserisci una firma, usa il nome veterinario "${vetName || '[Nome del Veterinario]'}" e la data "${generatedDate}".`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], temperature: 0.5 })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => null);
            throw new Error(err?.error?.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
        let content = data.choices[0].message.content;
        if (content) {
            if (vetName) {
                content = content.replace(/\[Nome del Veterinario\]/gi, vetName);
            }
            content = content.replace(/\[Data\]/gi, generatedDate);
        }
        document.getElementById('diaryText').value = content;
        trackChatUsage('gpt-4o', data.usage);
        saveApiUsage();
        updateCostDisplay();
        showToast('Profilo sanitario generato', 'success');
    } catch (e) {
        showToast('Errore: ' + e.message, 'error');
    }
    showProgress(false);
}

function saveDiary() {
    localStorage.setItem('ada_diary', document.getElementById('diaryText').value);
    showToast('Profilo sanitario salvato', 'success');
}

function exportDiaryTXT() {
    downloadFile(document.getElementById('diaryText').value, 'profilo_sanitario.txt', 'text/plain');
}

function exportDiaryPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const patient = getPatientData();

    // Header
    doc.setFillColor(30, 58, 95);
    doc.rect(0, 0, 210, 35, 'F');

    // Logo (AniCura) — come nel Referto
    try {
        if (typeof addAnicuraLogoToPdf === 'function') {
            addAnicuraLogoToPdf(doc, 10, 9, 35, 22);
        }
    } catch (e) {}

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text('Profilo sanitario', 120, 18, { align: 'center' });

    // Content
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    let y = 44;

    const metaParts = [];
    if (patient?.petName) metaParts.push(`Paziente: ${patient.petName}`);
    metaParts.push(`Data: ${new Date().toLocaleDateString('it-IT')}`);
    if (metaParts.length) {
        doc.text(metaParts.join(' | '), 15, y);
        y += 10;
    }

    const diaryText = (document.getElementById('diaryText')?.value || '').toString();
    const lines = doc.splitTextToSize(diaryText, 180);
    for (const line of lines) {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(line, 15, y);
        y += 5;
    }

    doc.save('profilo_sanitario_' + (patient?.petName || 'paziente') + '.pdf');
    showToast('PDF esportato', 'success');
}

// ============================================
// Q&A
// ============================================

let qnaRecorder = null;
let qnaChunks = [];
let isRecordingQuestion = false;

async function runQnaModerationCheck(text, kind) {
    const content = (text || '').toString().trim();
    if (!content) return false;
    const response = await fetch('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'omni-moderation-latest', input: content })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Moderazione ${kind} fallita (HTTP ${response.status}): ${errText.substring(0, 120)}`);
    }
    const data = await response.json();
    const flagged = data?.results?.[0]?.flagged;
    if (flagged) {
        showToast(`Contenuto non consentito nella ${kind}.`, 'error');
        return false;
    }
    return true;
}

function toggleQuestionRecording() {
    if (isRecordingQuestion) {
        completeQuestionRecording();
    } else {
        startQuestionRecording();
    }
}

async function startQuestionRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        qnaRecorder = new MediaRecorder(stream);
        qnaChunks = [];
        qnaRecorder.ondataavailable = e => qnaChunks.push(e.data);
        qnaRecorder.start();
        isRecordingQuestion = true;
        document.getElementById('btnAskQuestion').innerHTML = '✅ Completa';
        document.getElementById('btnAskQuestion').classList.add('btn-success');
        document.getElementById('btnAskQuestion').classList.remove('btn-primary');
        showToast('🔴 Parla ora...', 'success');
    } catch (e) {
        showToast('Errore microfono', 'error');
    }
}

async function completeQuestionRecording() {
    if (!qnaRecorder || qnaRecorder.state !== 'recording') return;
    
    isRecordingQuestion = false;
    document.getElementById('btnAskQuestion').innerHTML = '🎤 Chiedi';
    document.getElementById('btnAskQuestion').classList.remove('btn-success');
    document.getElementById('btnAskQuestion').classList.add('btn-primary');
    
    showProgress(true);
    
    qnaRecorder.onstop = async () => {
        const audioBlob = new Blob(qnaChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('file', audioBlob, 'question.webm');
        formData.append('model', 'whisper-1');
        formData.append('language', 'it');
        
        try {
            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + API_KEY },
                body: formData
            });
            if (!response.ok) {
            const err = await response.json().catch(() => null);
            throw new Error(err?.error?.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
            document.getElementById('qnaQuestion').value = data.text || '';
            apiUsage.whisper_minutes += 0.3;
            saveApiUsage();
            updateCostDisplay();
            if (data.text) await generateQnAAnswer();
        } catch (e) {
            showToast('Errore trascrizione', 'error');
        }
        showProgress(false);
    };
    
    qnaRecorder.stop();
    qnaRecorder.stream.getTracks().forEach(track => track.stop());
}

async function generateQnAAnswer() {
    const question = document.getElementById('qnaQuestion').value;
    if (!question) { showToast('Inserisci una domanda', 'error'); return; }

    try {
        const okQuestion = await runQnaModerationCheck(question, 'domanda');
        if (!okQuestion) return;
    } catch (e) {
        showToast('Errore: ' + e.message, 'error');
        return;
    }
    
    showProgress(true);
    const patient = getPatientData();
    const lifestyle = getLifestyleData();
    
    const prompt = `Sei un assistente veterinario. Rispondi SOLO a domande su pet e animali in generale.

PET: ${patient.petName || 'N/D'}, ${patient.petSpecies || 'N/D'}, ${patient.petBreed || 'N/D'}, Età: ${patient.petAge || 'N/D'}
AMBIENTE: ${lifestyle.lifestyle || 'N/D'}, CONDIZIONI: ${lifestyle.knownConditions || 'Nessuna'}
FARMACI: ${medications.map(m => m.name).join(', ') || 'Nessuno'}
ULTIMA DIAGNOSI: ${_getMostRecentDiagnosisText()}

DOMANDA: "${question}"

Se NON correlata ad animali/pet: "Mi dispiace, posso rispondere solo a domande su animali e pet."
Altrimenti rispondi in modo chiaro e rassicurante.`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], temperature: 0.5 })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => null);
            throw new Error(err?.error?.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('Risposta non valida dal modello');
        }
        const okAnswer = await runQnaModerationCheck(content, 'risposta');
        if (!okAnswer) {
            document.getElementById('qnaAnswer').value = 'Mi dispiace, non posso rispondere a questa domanda.';
            showProgress(false);
            return;
        }
        document.getElementById('qnaAnswer').value = content;
        trackChatUsage('gpt-4o', data.usage);
        saveApiUsage();
        updateCostDisplay();
        showToast('Risposta generata', 'success');
    } catch (e) {
        showToast('Errore: ' + e.message, 'error');
    }
    showProgress(false);
}

async function generateQnAFaq() {
    showProgress(true);
    const patient = getPatientData();
    const lifestyle = getLifestyleData();
    
    const prompt = `Genera 5 domande utili per un proprietario di ${patient.petSpecies || 'animale'} ${patient.petBreed || ''}.
Condizioni note: ${lifestyle.knownConditions || 'Nessuna'}
Diagnosi recente: ${_getMostRecentDiagnosisText()}

Rispondi in JSON: {"faq": [{"question": "...", "answer": "..."}]}`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], temperature: 0.6 })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => null);
            throw new Error(err?.error?.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('Risposta non valida dal modello');
        }
        const result = _extractJsonObject(content);
        if (result) {
            const list = document.getElementById('qnaFaqList');
            if (list) {
                list.innerHTML = '';
                (result.faq || []).forEach(item => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'faq-item';
                    wrapper.addEventListener('click', () => wrapper.classList.toggle('open'));

                    const question = document.createElement('div');
                    question.className = 'faq-question';
                    question.textContent = item?.question || '';

                    const answer = document.createElement('div');
                    answer.className = 'faq-answer';
                    answer.textContent = item?.answer || '';

                    wrapper.appendChild(question);
                    wrapper.appendChild(answer);
                    list.appendChild(wrapper);
                });
            }
        }
        trackChatUsage('gpt-4o', data.usage);
        saveApiUsage();
        updateCostDisplay();
        showToast('Domande generate', 'success');
    } catch (e) {
        showToast('Errore: ' + e.message, 'error');
    }
    showProgress(false);
}
