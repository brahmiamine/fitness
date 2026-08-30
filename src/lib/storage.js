const DATABASE_NAME = 'pulse-nxk'
const STORE_NAME = 'imports'
const DATABASE_VERSION = 1

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('importedAt', 'importedAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transaction(mode, action) {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, mode)
        const store = tx.objectStore(STORE_NAME)
        const request = action(store)
        let result
        request.onsuccess = () => { result = request.result }
        request.onerror = () => reject(request.error)
        tx.oncomplete = () => {
          database.close()
          resolve(result)
        }
        tx.onerror = () => {
          database.close()
          reject(tx.error)
        }
      }),
  )
}

export async function listImports() {
  const items = await transaction('readonly', (store) => store.getAll())
  return items.sort((a, b) => b.importedAt.localeCompare(a.importedAt))
}

export function saveImport(item) {
  return transaction('readwrite', (store) => store.put(item))
}

export function deleteImport(id) {
  return transaction('readwrite', (store) => store.delete(id))
}

export function clearImports() {
  return transaction('readwrite', (store) => store.clear())
}
