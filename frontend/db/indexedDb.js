// ADA v6.17.9 - Offline IndexedDB (Dexie)

const ADA_OFFLINE_DB_NAME = 'ada_offline';

function initAdaOfflineDb() {
    if (window.adaDb) return window.adaDb;
    if (typeof Dexie === 'undefined') {
        console.error('Dexie non disponibile: IndexedDB offline non inizializzato.');
        return null;
    }

    const db = new Dexie(ADA_OFFLINE_DB_NAME);
    db.version(1).stores({
        pets: 'id, name, species, updated_at, base_version, deleted',
        outbox: '++id, op_type, created_at',
        meta: 'key'
    });

    window.adaDb = db;
    return db;
}

async function ensureOfflineDbReady() {
    const db = initAdaOfflineDb();
    if (!db) return null;
    try {
        await db.open();
    } catch (e) {
        console.error('Errore apertura IndexedDB offline', e);
    }
    return db;
}
