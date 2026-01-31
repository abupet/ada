// ADA v6.16.2 - Multi-Pet Management System

// ============================================
// DATABASE
// ============================================

const PETS_DB_NAME = 'ADA_Pets';
const PETS_STORE_NAME = 'pets';
const OUTBOX_STORE_NAME = 'outbox';
const META_STORE_NAME = 'meta';
let petsDB = null;
let currentPetId = null;

function normalizePetId(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const value = String(raw).trim();
    if (!value) return null;
    if (/^\d+$/.test(value)) return Number(value);
    return value;
}

// Return currently selected pet id (from memory or localStorage)
function getCurrentPetId() {
    if (currentPetId !== null && currentPetId !== undefined) return currentPetId;
    const raw = localStorage.getItem('ada_current_pet_id');
    return normalizePetId(raw);
}

async function initPetsDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(PETS_DB_NAME, 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            petsDB = request.result;
            resolve(petsDB);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(PETS_STORE_NAME)) {
                db.createObjectStore(PETS_STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }

            if (!db.objectStoreNames.contains(OUTBOX_STORE_NAME)) {
                db.createObjectStore(OUTBOX_STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(META_STORE_NAME)) {
                db.createObjectStore(META_STORE_NAME, { keyPath: 'key' });
            }
        };
    });
}

async function getAllPets() {
    if (!petsDB) await initPetsDB();
    return new Promise((resolve, reject) => {
        const tx = petsDB.transaction(PETS_STORE_NAME, 'readonly');
        const store = tx.objectStore(PETS_STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

async function getPetById(id) {
    if (!petsDB) await initPetsDB();
    return new Promise((resolve, reject) => {
        const tx = petsDB.transaction(PETS_STORE_NAME, 'readonly');
        const store = tx.objectStore(PETS_STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        try { tx.oncomplete = () => { backupPetsToLocalStorage(); }; } catch (e) {}
        request.onerror = () => reject(request.error);
    });
}

async function savePetToDB(pet) {
    if (!petsDB) await initPetsDB();
    return new Promise((resolve, reject) => {
        const tx = petsDB.transaction(PETS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(PETS_STORE_NAME);
        let request;
        if (pet.id === null || pet.id === undefined) {
            const petToSave = { ...pet };
            delete petToSave.id;
            request = store.add(petToSave);
        } else {
            request = store.put(pet);
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deletePetFromDB(id) {
    if (!petsDB) await initPetsDB();
    return new Promise((resolve, reject) => {
        const tx = petsDB.transaction(PETS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(PETS_STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ============================================
// META / OUTBOX (offline-first scaffolding)
// ============================================

async function metaGet(key) {
    if (!petsDB) await initPetsDB();
    return new Promise((resolve, reject) => {
        const tx = petsDB.transaction(META_STORE_NAME, 'readonly');
        const store = tx.objectStore(META_STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => reject(req.error);
    });
}

async function metaSet(key, value) {
    if (!petsDB) await initPetsDB();
    return new Promise((resolve, reject) => {
        const tx = petsDB.transaction(META_STORE_NAME, 'readwrite');
        const store = tx.objectStore(META_STORE_NAME);
        const req = store.put({ key, value });
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}

async function getOrCreateDeviceId() {
    // Stored in meta; fallback to localStorage for robustness
    const META_KEY = 'device_id';
    let existing = null;
    try { existing = await metaGet(META_KEY); } catch (e) {}
    if (existing) return existing;
    try {
        const ls = localStorage.getItem('ada_device_id');
        if (ls) {
            try { await metaSet(META_KEY, ls); } catch (e) {}
            return ls;
        }
    } catch (e) {}

    let id = '';
    try {
        if (crypto && crypto.randomUUID) id = crypto.randomUUID();
    } catch (e) {}
    if (!id) id = 'dev_' + Math.random().toString(16).slice(2) + '_' + Date.now();
    try { await metaSet(META_KEY, id); } catch (e) {}
    try { localStorage.setItem('ada_device_id', id); } catch (e) {}
    return id;
}

async function getLastPetsCursor() {
    try { return (await metaGet('pets_last_cursor')) || ''; } catch (e) { return ''; }
}

async function setLastPetsCursor(cursor) {
    try { await metaSet('pets_last_cursor', cursor || ''); } catch (e) {}
}

// NOTE: Outbox is not used in Step 1–2 yet, but store exists for Step 3.
async function enqueueOutbox(op_type, payload) {
    if (!petsDB) await initPetsDB();
    return new Promise((resolve, reject) => {
        const tx = petsDB.transaction(OUTBOX_STORE_NAME, 'readwrite');
        const store = tx.objectStore(OUTBOX_STORE_NAME);
        const req = store.add({ op_type, payload, created_at: new Date().toISOString() });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ============================================
// STEP 2 — PULL (safe, non-blocking)
// ============================================

async function applyRemotePets(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    // Upsert into pets store; support soft-delete
    if (!petsDB) await initPetsDB();
    await new Promise((resolve, reject) => {
        const tx = petsDB.transaction(PETS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(PETS_STORE_NAME);
        for (const item of items) {
            if (!item) continue;
            let entry = item;
            let id = item.id;
            let isDelete = item.deleted === true || item.is_deleted === true;

            if (item.type === 'pet.delete' || item.type === 'pet.upsert') {
                id = item.pet_id;
                if (item.type === 'pet.delete') {
                    isDelete = true;
                } else {
                    entry = item.record && typeof item.record === 'object'
                        ? { ...item.record, id: item.pet_id ?? item.record.id }
                        : { id: item.pet_id };
                }
            } else if ((id === undefined || id === null) && item.pet_id != null) {
                id = item.pet_id;
                if (item.record && typeof item.record === 'object') {
                    entry = { ...item.record, id };
                }
            }

            if (id === undefined || id === null) continue;
            if (isDelete) {
                store.delete(id);
            } else {
                store.put({ ...entry, id });
            }
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('applyRemotePets failed'));
    });
}

async function pullPetsIfOnline() {
    // Avoid side-effects if not authenticated (prevents smoke-test flakiness)
    try {
        if (typeof getAuthToken === 'function') {
            const t = getAuthToken();
            if (!t) return;
        }
    } catch (e) { return; }

    if (!navigator.onLine) return;
    if (typeof fetchApi !== 'function') return;

    const device_id = await getOrCreateDeviceId();
    const cursor = await getLastPetsCursor();

    // Be tolerant to backend response shapes
    const qs = new URLSearchParams();
    if (cursor) qs.set('since', cursor);
    qs.set('device_id', device_id);

    let resp;
    try {
        resp = await fetchApi(`/api/sync/pets/pull?${qs.toString()}`, { method: 'GET' });
    } catch (e) {
        return; // silent
    }
    if (!resp || !resp.ok) return;

    let data = null;
    try { data = await resp.json(); } catch (e) { return; }

    const items =
        Array.isArray(data) ? data :
        Array.isArray(data?.pets) ? data.pets :
        Array.isArray(data?.items) ? data.items :
        Array.isArray(data?.changes) ? data.changes :
        [];

    await applyRemotePets(items);

    const nextCursor = data?.next_cursor || data?.cursor || data?.last_cursor || '';
    if (nextCursor) await setLastPetsCursor(nextCursor);
}

// ============================================
// PET DATA STRUCTURE
// ============================================

function createEmptyPet() {
    return {
        id: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        patient: { petName: '', petSpecies: '', petBreed: '', petAge: '', petSex: '', petWeight: '', petMicrochip: '', ownerName: '', ownerPhone: '', visitDate: '' },
        lifestyle: { lifestyle: '', household: '', activityLevel: '', dietType: '', dietPreferences: '', knownConditions: '', currentMeds: '', behaviorNotes: '', seasonContext: '', location: '' },
        photos: [],
        vitalsData: [],
        historyData: [],
        medications: [],
        appointments: [],
        diary: ''
    };
}


// ============================================
// BACKUP / RESTORE (LocalStorage fallback)
// ============================================

const PETS_BACKUP_KEY = 'ada_pets_backup_v1';

async function backupPetsToLocalStorage() {
    try {
        const pets = await getAllPets();
        localStorage.setItem(PETS_BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), pets }));
    } catch (e) {
        // non-fatal
    }
}

async function restorePetsFromLocalStorageIfNeeded() {
    try {
        const existing = await getAllPets();
        if (Array.isArray(existing) && existing.length) return false;

        const raw = localStorage.getItem(PETS_BACKUP_KEY);
        if (!raw) return false;

        const parsed = JSON.parse(raw);
        const pets = Array.isArray(parsed?.pets) ? parsed.pets : [];
        if (!pets.length) return false;

        for (const p of pets) {
            try { await savePetToDB(p); } catch (e) {}
        }
        return true;
    } catch (e) {
        return false;
    }
}

// ============================================
// DROPDOWN MANAGEMENT
// ============================================

async function rebuildPetSelector(selectId = null) {
    const selector = document.getElementById('petSelector');
    if (!selector) return;
    
    const pets = await getAllPets();
    
    let html = '<option value="">-- Seleziona Pet --</option>';
    pets.forEach(pet => {
        const name = pet.patient?.petName || 'Pet ' + pet.id;
        const species = pet.patient?.petSpecies || 'N/D';
        html += `<option value="${pet.id}">${name} (${species})</option>`;
    });
    selector.innerHTML = html;
    
    if (selectId !== null) {
        selector.value = String(selectId);
    }
    
    updateSaveButtonState();
}

function updateSaveButtonState() {
    const saveBtn = document.getElementById('btnSavePet');
    const selector = document.getElementById('petSelector');
    if (!saveBtn || !selector) return;
    saveBtn.disabled = (selector.value === '');
}

// ============================================
// PAGE: DATI PET - SELECTOR CHANGE
// ============================================

async function onPetSelectorChange(selectElement) {
    const value = selectElement.value;
    
    // FIRST: Save current pet data before switching
    if (currentPetId !== null && currentPetId !== undefined) {
        await saveCurrentPetDataSilent();
    }
    
    if (value === '') {
        // Nothing selected - clear fields
        currentPetId = null;
        localStorage.removeItem('ada_current_pet_id');
        clearMainPetFields();
    } else {
        // Pet selected - load it
        const petId = normalizePetId(value);
        const pet = await getPetById(petId);
        if (pet) {
            currentPetId = petId;
            localStorage.setItem('ada_current_pet_id', String(petId));
            loadPetIntoMainFields(pet);
        }
    }

    // Update header pet indicator across pages
    if (typeof updateSelectedPetHeaders === 'function') {
        await updateSelectedPetHeaders();
    }

    updateSaveButtonState();
}

// Save current pet data without showing toast (used when switching pets)
async function saveCurrentPetDataSilent() {
    if (!currentPetId) return;
    
    const pet = await getPetById(currentPetId);
    if (pet) {
        pet.updatedAt = new Date().toISOString();
        pet.patient = getPatientData();
        pet.lifestyle = getLifestyleData();
        pet.photos = photos;
        pet.vitalsData = vitalsData;
        pet.historyData = historyData;
        pet.medications = medications;
        pet.appointments = appointments;
        pet.diary = document.getElementById('diaryText')?.value || '';
        await savePetToDB(pet);
    }
}

// ============================================
// PAGE: DATI PET - SAVE CURRENT PET
// ============================================

async function saveCurrentPet() {
    const selector = document.getElementById('petSelector');
    if (!selector || selector.value === '') {
        alert('⚠️ Errore: Nessun pet selezionato.\n\nSeleziona un pet dalla lista prima di salvare.');
        return;
    }
    
    // Validate required fields
    const petName = document.getElementById('petName')?.value?.trim() || '';
    const petSpecies = document.getElementById('petSpecies')?.value || '';
    
    if (!petName) {
        alert('⚠️ Errore: Il Nome del pet è obbligatorio!');
        document.getElementById('petName')?.focus();
        return;
    }
    if (!petSpecies) {
        alert('⚠️ Errore: La Specie del pet è obbligatoria!');
        document.getElementById('petSpecies')?.focus();
        return;
    }
    
    const petId = normalizePetId(selector.value);
    const pet = await getPetById(petId);
    
    if (pet) {
        pet.updatedAt = new Date().toISOString();
        pet.patient = getPatientData();
        pet.lifestyle = getLifestyleData();
        pet.photos = photos;
        pet.vitalsData = vitalsData;
        pet.historyData = historyData;
        pet.medications = medications;
        pet.appointments = appointments;
        pet.diary = document.getElementById('diaryText')?.value || '';
        
        await savePetToDB(pet);
        await rebuildPetSelector(petId);
        
        showToast('✅ Dati salvati!', 'success');
    }
}

// ============================================
// PAGE: DATI PET - DELETE CURRENT PET
// ============================================

async function deleteCurrentPet() {
    const selector = document.getElementById('petSelector');
    if (!selector || selector.value === '') {
        alert('⚠️ Errore: Nessun pet selezionato da eliminare.');
        return;
    }
    
    const petId = normalizePetId(selector.value);
    const pet = await getPetById(petId);
    const petName = pet?.patient?.petName || 'questo pet';
    
    if (!confirm(`Eliminare "${petName}" e tutti i suoi dati?\n\nQuesta azione è irreversibile.`)) {
        return;
    }
    
    await deletePetFromDB(petId);
    currentPetId = null;
    localStorage.removeItem('ada_current_pet_id');
    clearMainPetFields();
    await rebuildPetSelector('');
    
    showToast('✅ Pet eliminato', 'success');
}

// ============================================
// PAGE: AGGIUNGI PET - OPEN/CLOSE
// ============================================

function openAddPetPage() {
    clearNewPetFields();
    navigateToPage('addpet');
}

function cancelAddPet() {
    clearNewPetFields();
    navigateToPage('patient');
}

function toggleNewPetLifestyleSection() {
    const section = document.getElementById('newPetLifestyleSection');
    if (section) section.classList.toggle('open');
}

// ============================================
// PAGE: AGGIUNGI PET - SAVE NEW PET
// ============================================

async function saveNewPet() {
    // Validate required fields
    const petName = document.getElementById('newPetName')?.value?.trim() || '';
    const petSpecies = document.getElementById('newPetSpecies')?.value || '';
    
    if (!petName) {
        alert('⚠️ Errore: Il Nome del pet è obbligatorio!');
        document.getElementById('newPetName')?.focus();
        return;
    }
    if (!petSpecies) {
        alert('⚠️ Errore: La Specie del pet è obbligatoria!');
        document.getElementById('newPetSpecies')?.focus();
        return;
    }
    
    // Create new pet
    const newPet = createEmptyPet();
    newPet.patient = getNewPetPatientData();
    newPet.lifestyle = getNewPetLifestyleData();
    
    const newId = await savePetToDB(newPet);
    
    // Clear the add pet form
    clearNewPetFields();
    
    // Go to Dati Pet page
    navigateToPage('patient');
    
    // Rebuild selector with new pet selected
    await rebuildPetSelector(newId);
    
    // Load the new pet into main fields
    currentPetId = newId;
    localStorage.setItem('ada_current_pet_id', String(newId));
    const savedPet = await getPetById(newId);
    loadPetIntoMainFields(savedPet);
    
    showToast('✅ Nuovo pet aggiunto!', 'success');
}

// ============================================
// FIELD HELPERS - MAIN PET PAGE
// ============================================

function clearMainPetFields() {
    setPatientData({});
    setLifestyleData({});
    photos = [];
    vitalsData = [];
    historyData = [];
    medications = [];
    appointments = [];
    tipsData = [];
    const diaryEl = document.getElementById('diaryText');
    if (diaryEl) diaryEl.value = '';
    renderPhotos();
    renderHistory();
    try { if (typeof initVitalsChart === 'function' && !vitalsChart) initVitalsChart(); } catch (e) {}
    try { if (typeof updateVitalsChart === 'function') updateVitalsChart(); } catch (e) {}
    renderMedications();
    renderAppointments();
    renderTips();
    updateHistoryBadge();
    // Clear vitals chart
    const chartContainer = document.getElementById('vitalsChart');
    if (chartContainer) chartContainer.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">Nessun dato disponibile</p>';
}

function loadPetIntoMainFields(pet) {
    setPatientData(pet.patient || {});
    setLifestyleData(pet.lifestyle || {});
    photos = pet.photos || [];
    vitalsData = pet.vitalsData || [];
    historyData = pet.historyData || [];

    // Ensure Archivio schema is normalized (id-based)
    try { if (typeof _historySchemaMigrated !== 'undefined') _historySchemaMigrated = false; } catch (e) {}
    try { if (typeof migrateLegacyHistoryDataIfNeeded === 'function') migrateLegacyHistoryDataIfNeeded(); } catch (e) {}
    medications = pet.medications || [];
    appointments = pet.appointments || [];
    // v6.16.4: Tips sono persistiti per pet (lista mostrata)
    try { if (typeof restoreTipsDataForCurrentPet === 'function') restoreTipsDataForCurrentPet(); } catch(e) {}
    try { if (typeof updateTipsMeta === 'function') updateTipsMeta(); } catch(e) {}
    const diaryEl = document.getElementById('diaryText');
    if (diaryEl) diaryEl.value = pet.diary || '';
    renderPhotos();
    renderHistory();
    renderMedications();
    renderAppointments();
    renderTips();
    updateHistoryBadge();
    // Ensure vitals UI always reflects the selected pet (including when empty)
    if (typeof updateVitalsChart === 'function') {
        updateVitalsChart();
    }
}

// ============================================
// FIELD HELPERS - ADD PET PAGE
// ============================================

function clearNewPetFields() {
    const fields = ['newPetName', 'newPetSpecies', 'newPetBreed', 'newPetAge', 'newPetSex', 'newPetWeight', 'newPetMicrochip', 'newOwnerName', 'newOwnerPhone', 'newVisitDate',
                    'newPetLifestyle', 'newPetActivityLevel', 'newPetDietType', 'newPetDietPreferences', 'newPetKnownConditions', 'newPetCurrentMeds', 'newPetBehaviorNotes', 'newPetSeasonContext', 'newPetLocation'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const householdSelect = document.getElementById('newPetHousehold');
    if (householdSelect) {
        Array.from(householdSelect.options).forEach(opt => opt.selected = false);
    }
    const section = document.getElementById('newPetLifestyleSection');
    if (section) section.classList.remove('open');
}

function getNewPetPatientData() {
    return {
        petName: document.getElementById('newPetName')?.value || '',
        petSpecies: document.getElementById('newPetSpecies')?.value || '',
        petBreed: document.getElementById('newPetBreed')?.value || '',
        petAge: document.getElementById('newPetAge')?.value || '',
        petSex: document.getElementById('newPetSex')?.value || '',
        petWeight: document.getElementById('newPetWeight')?.value || '',
        petMicrochip: document.getElementById('newPetMicrochip')?.value || '',
        ownerName: document.getElementById('newOwnerName')?.value || '',
        ownerPhone: document.getElementById('newOwnerPhone')?.value || '',
        visitDate: document.getElementById('newVisitDate')?.value || ''
    };
}

function getNewPetLifestyleData() {
    const householdSelect = document.getElementById('newPetHousehold');
    const selectedHousehold = householdSelect ? Array.from(householdSelect.selectedOptions).map(opt => opt.value).join(', ') : '';
    
    return {
        lifestyle: document.getElementById('newPetLifestyle')?.value || '',
        household: selectedHousehold,
        activityLevel: document.getElementById('newPetActivityLevel')?.value || '',
        dietType: document.getElementById('newPetDietType')?.value || '',
        dietPreferences: document.getElementById('newPetDietPreferences')?.value || '',
        knownConditions: document.getElementById('newPetKnownConditions')?.value || '',
        currentMeds: document.getElementById('newPetCurrentMeds')?.value || '',
        behaviorNotes: document.getElementById('newPetBehaviorNotes')?.value || '',
        seasonContext: document.getElementById('newPetSeasonContext')?.value || '',
        location: document.getElementById('newPetLocation')?.value || ''
    };
}

// ============================================
// OVERRIDES FOR DATA SAVING
// ============================================

async function saveData() {
    localStorage.setItem('ada_photos', JSON.stringify(photos));
    localStorage.setItem('ada_vitals', JSON.stringify(vitalsData));
    localStorage.setItem('ada_history', JSON.stringify(historyData));
    localStorage.setItem('ada_medications', JSON.stringify(medications));
    localStorage.setItem('ada_appointments', JSON.stringify(appointments));
    
    if (currentPetId) {
        const pet = await getPetById(currentPetId);
        if (pet) {
            pet.updatedAt = new Date().toISOString();
            pet.photos = photos;
            pet.vitalsData = vitalsData;
            pet.historyData = historyData;
            pet.medications = medications;
            pet.appointments = appointments;
            pet.diary = document.getElementById('diaryText')?.value || '';
            await savePetToDB(pet);
        }
    }
}

async function saveDiary() {
    const diaryText = document.getElementById('diaryText')?.value || '';
    localStorage.setItem('ada_diary', diaryText);
    
    if (currentPetId) {
        const pet = await getPetById(currentPetId);
        if (pet) {
            pet.diary = diaryText;
            pet.updatedAt = new Date().toISOString();
            await savePetToDB(pet);
            showToast('✅ Profilo sanitario salvato', 'success');
        }
    } else {
        alert('⚠️ Errore: Seleziona un pet prima di salvare il profilo sanitario.');
    }
}

// Keep savePatient for compatibility but redirect to saveCurrentPet
async function savePatient() {
    await saveCurrentPet();
}

// ============================================
// INITIALIZATION
// ============================================

async function initMultiPetSystem() {
    await initPetsDB();
    // Restore from LocalStorage backup if IndexedDB is empty (robustness on some browsers)
    try { await restorePetsFromLocalStorageIfNeeded(); } catch (e) {}
    
    // Migration from old system
    const pets = await getAllPets();
    if (pets.length === 0) {
        const existingPatient = localStorage.getItem('ada_patient');
        if (existingPatient) {
            const parsed = JSON.parse(existingPatient);
            if (parsed.petName) {
                const migratePet = createEmptyPet();
                migratePet.patient = parsed;
                migratePet.lifestyle = JSON.parse(localStorage.getItem('ada_lifestyle') || '{}');
                migratePet.photos = JSON.parse(localStorage.getItem('ada_photos') || '[]');
                migratePet.vitalsData = JSON.parse(localStorage.getItem('ada_vitals') || '[]');
                migratePet.historyData = JSON.parse(localStorage.getItem('ada_history') || '[]');
                migratePet.medications = JSON.parse(localStorage.getItem('ada_medications') || '[]');
                migratePet.appointments = JSON.parse(localStorage.getItem('ada_appointments') || '[]');
                migratePet.diary = localStorage.getItem('ada_diary') || '';
                const newId = await savePetToDB(migratePet);
                currentPetId = newId;
                localStorage.setItem('ada_current_pet_id', String(newId));
            }
        }
    }
    
    await rebuildPetSelector();
    
    // Step 2: non-blocking pull (updates local DB when online)
    try { pullPetsIfOnline(); } catch (e) {}
    // Restore last selected pet
    const lastPetId = localStorage.getItem('ada_current_pet_id');
    if (lastPetId) {
        const normalizedLastPetId = normalizePetId(lastPetId);
        const pet = await getPetById(normalizedLastPetId);
        if (pet) {
            currentPetId = normalizedLastPetId;
            loadPetIntoMainFields(pet);
            await updateSelectedPetHeaders();
            const selector = document.getElementById('petSelector');
            if (selector) selector.value = lastPetId;
        }
    }

    await updateSelectedPetHeaders();

    updateSaveButtonState();
}


// ============================================
// SELECTED PET HEADER
// ============================================

async function updateSelectedPetHeaders() {
    const els = document.querySelectorAll('[data-selected-pet-header]');
    if (!els || els.length === 0) return;

    let pet = null;
    const petId = getCurrentPetId();
    if (petId) {
        try {
            pet = await getPetById(petId);
        } catch (e) {
            pet = null;
        }
    }

    els.forEach(el => {
        if (!pet || !pet.patient) {
            el.textContent = '🐾 Seleziona un pet';
            el.classList.remove('selected-pet-header--visible');
            return;
        }

        const name = (pet.patient.petName || 'Paziente').toString().trim();
        const species = (pet.patient.petSpecies || '').toString().trim();
        const parts = [name];
        if (species) parts.push(species);
        el.textContent = '🐾 ' + parts.join(' • ');
        el.classList.add('selected-pet-header--visible');
    });
}
