import { openDB } from 'idb';
import pako from 'pako';

let DB_NAME = 'StreamQuestDB';
const STORE_NAME = 'players';

export function setDbChannel(channelName) {
    if (channelName) {
        // Sanitize to ensure valid db name characters
        const clean = channelName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (clean) {
            DB_NAME = `StreamQuestDB_${clean}`;
            console.log('Database context switched to:', DB_NAME);
        }
    }
}

// Initialize DB
export async function initDB() {
    return openDB(DB_NAME, 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'twitchId' });
            }
        },
    });
}

// Save player data (Compressed)
export async function savePlayer(twitchId, data) {
    const db = await initDB();
    const jsonString = JSON.stringify(data);
    const compressed = pako.deflate(jsonString);
    await db.put(STORE_NAME, { twitchId, data: compressed });
}

// Load player data (Decompressed)
export async function getPlayer(twitchId) {
    const db = await initDB();
    const record = await db.get(STORE_NAME, twitchId);
    
    if (!record) return null;

    try {
        const decompressed = pako.inflate(record.data, { to: 'string' });
        return JSON.parse(decompressed);
    } catch (e) {
        console.error("Error inflating data", e);
        return null;
    }
}

export async function getAllPlayers() {
    const db = await initDB();
    const records = await db.getAll(STORE_NAME);
    const players = [];
    for (const record of records) {
        try {
            const decompressed = pako.inflate(record.data, { to: 'string' });
            const data = JSON.parse(decompressed);
            players.push(data);
        } catch (e) {
            console.error("Error inflating player in list", e);
        }
    }
    return players;
}

export function createNewPlayer(username, twitchId) {
    return {
        username,
        twitchId,
        level: 1,
        xp: 0,
        energy: [], // Array of timestamps
        lastChatTime: 0,
        inventory: {},
        activeTask: null, // { taskId, startTime, duration }
        linkedWebsimId: null
    };
}