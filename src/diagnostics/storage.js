const DATABASE = 'reading-room-diagnostics-v1';
const VERSION = 1;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
}

export function createIndexedDbStorage(indexedDb = globalThis.indexedDB) {
  let databasePromise = null;
  const open = () => {
    if (!indexedDb) throw new Error('IndexedDB is unavailable');
    if (!databasePromise) {
      const request = indexedDb.open(DATABASE, VERSION);
      request.addEventListener('upgradeneeded', () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('sessions')) database.createObjectStore('sessions', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('events')) {
          const events = database.createObjectStore('events', { keyPath: ['session_id', 'sequence'] });
          events.createIndex('by_session', 'session_id');
        }
      });
      databasePromise = requestResult(request);
    }
    return databasePromise;
  };
  return {
    databaseName: DATABASE,
    async putSession(session) {
      const database = await open();
      const transaction = database.transaction('sessions', 'readwrite');
      transaction.objectStore('sessions').put(session);
      await transactionDone(transaction);
    },
    async getSession(id) {
      if (!id) return null;
      const database = await open();
      return (await requestResult(database.transaction('sessions').objectStore('sessions').get(id))) || null;
    },
    async listSessions() {
      const database = await open();
      const rows = await requestResult(database.transaction('sessions').objectStore('sessions').getAll());
      return rows.sort((left, right) => String(right.started_at).localeCompare(String(left.started_at)));
    },
    async putEvents(events) {
      if (!events.length) return;
      const database = await open();
      const transaction = database.transaction('events', 'readwrite');
      const store = transaction.objectStore('events');
      events.forEach(event => store.put(event));
      await transactionDone(transaction);
    },
    async eventsFor(sessionId) {
      const database = await open();
      const rows = await requestResult(database.transaction('events').objectStore('events').index('by_session').getAll(sessionId));
      return rows.sort((left, right) => left.sequence - right.sequence);
    },
    async clear() {
      const database = await open();
      const transaction = database.transaction(['sessions', 'events'], 'readwrite');
      transaction.objectStore('sessions').clear();
      transaction.objectStore('events').clear();
      await transactionDone(transaction);
    }
  };
}

export function createMemoryDiagnosticStorage() {
  const sessions = new Map();
  const events = new Map();
  return {
    databaseName: 'memory',
    writes: 0,
    async putSession(session) { this.writes += 1; sessions.set(session.id, structuredClone(session)); },
    async getSession(id) { return structuredClone(sessions.get(id) || null); },
    async listSessions() { return [...sessions.values()].map(item => structuredClone(item)).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))); },
    async putEvents(rows) {
      this.writes += rows.length ? 1 : 0;
      rows.forEach(row => events.set(`${row.session_id}:${row.sequence}`, structuredClone(row)));
    },
    async eventsFor(sessionId) { return [...events.values()].filter(row => row.session_id === sessionId).sort((a, b) => a.sequence - b.sequence).map(item => structuredClone(item)); },
    async clear() { sessions.clear(); events.clear(); }
  };
}
