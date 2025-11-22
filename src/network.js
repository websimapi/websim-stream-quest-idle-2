import { savePlayer, getPlayer, createNewPlayer, setDbChannel, getAllPlayers } from './db.js';
import { SKILLS } from './skills.js';

// Simulation of a JWT Secret (In a real app, this is server-side only)
const SECRET_KEY = "mock_secret_key_" + Math.random();

// Helper: append log lines to the host console if present
function appendHostLog(message) {
    const logEl = document.getElementById('host-console-log');
    if (!logEl) return;
    const line = document.createElement('div');
    const ts = new Date().toLocaleTimeString();
    line.textContent = `[${ts}] ${message}`;
    logEl.appendChild(line);
    // Trim to last 200 lines
    while (logEl.childElementCount > 200) {
        logEl.removeChild(logEl.firstChild);
    }
    logEl.scrollTop = logEl.scrollHeight;
}

export class NetworkManager {
    constructor(room, isHost, user) {
        this.room = room;
        this.isHost = isHost;
        this.user = user;
        this.tmiClient = null;
        this.pendingLinks = {}; // code -> { websimClientId, createdAt }

        this.onEnergyUpdate = null;
        this.onTaskUpdate = null;
        this.onLinkSuccess = null;
        this.onLinkCode = null;
        this.onStateUpdate = null;
        this.onPresenceUpdate = null;
        this.onPlayerListUpdate = null;
        this.onTokenInvalid = null; // fired when host rejects/expired token

        this.initialize();
    }

    async initialize() {
        if (this.isHost) {
            // Restore channel context if available
            const savedChannel = localStorage.getItem('sq_host_channel');
            if (savedChannel) {
                setDbChannel(savedChannel);
                appendHostLog(`DB context set for channel "${savedChannel}"`);
            }

            console.log("Initializing Host Logic...");
            this.setupHostListeners();
            this.setupPresenceWatcher();
            // Initial load of Twitch users for current DB context
            this.refreshPlayerList();
        } else {
            console.log("Initializing Client Logic...");
            this.setupClientListeners();
        }
    }

    // --- HOST LOGIC ---

    connectTwitch(channelName) {
        if (!this.isHost) return;

        // Update DB Context
        setDbChannel(channelName);
        localStorage.setItem('sq_host_channel', channelName);
        appendHostLog(`Connecting to Twitch channel "${channelName}"...`);

        if (this.tmiClient) this.tmiClient.disconnect();

        // tmi is global from the script tag fallback if import fails, or import map
        const tmi = window.tmi; 

        this.tmiClient = new tmi.Client({
            channels: [channelName]
        });

        this.tmiClient.connect().then(() => {
            appendHostLog(`Connected to Twitch channel "${channelName}".`);
        }).catch(err => {
            console.error(err);
            appendHostLog(`Error connecting to Twitch: ${err?.message || err}`);
        });

        this.tmiClient.on('message', (channel, tags, message, self) => {
            if (self) return;
            // Log every message to host console
            const uname = tags['display-name'] || tags['username'] || 'unknown';
            appendHostLog(`[CHAT] ${uname}: ${message}`);
            this.handleTwitchMessage(tags, message);
        }); 

        // Reload Twitch users for this channel's DB
        this.refreshPlayerList();

        return true;
    }

    generateLinkCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    cleanupExpiredCodes() {
        const now = Date.now();
        const ttl = 5 * 60 * 1000; // 5 minutes
        for (const [code, entry] of Object.entries(this.pendingLinks)) {
            if (!entry || now - entry.createdAt > ttl) {
                appendHostLog(`Link code "${code}" expired and was removed.`);
                delete this.pendingLinks[code];
            }
        }
    }

    async handleTwitchMessage(tags, message) {
        const twitchId = tags['user-id'];
        const username = tags['username'];
        const now = Date.now();

        // 1. Energy Logic
        let player = await getPlayer(twitchId);
        if (!player) {
            player = createNewPlayer(username, twitchId);
            appendHostLog(`New Twitch user detected: ${username} (${twitchId}).`);
        }

        // Check energy threshold (5 minutes)
        if (now - player.lastChatTime > 300000) { 
            if (player.energy.length < 12) {
                player.energy.push(now); // Add energy cell
                appendHostLog(`Energy +1 for ${username} (now ${player.energy.length}/12).`);
                // Notify if they are online via WebSim
                if (player.linkedWebsimId) {
                    this.room.send({
                        type: 'energy_update',
                        targetId: player.linkedWebsimId,
                        energy: player.energy
                    });
                }
            }
            player.lastChatTime = now;
            await savePlayer(twitchId, player);
        }

        // 2. Command Logic
        if (message.startsWith('!link ')) {
            const code = message.split(' ')[1];
            appendHostLog(`!link attempt by ${username} with code "${code}".`);
            this.cleanupExpiredCodes();
            const entry = this.pendingLinks[code];
            if (entry) {
                const websimClientId = entry.websimClientId;

                // Link them
                player.linkedWebsimId = websimClientId;
                await savePlayer(twitchId, player);

                // Generate "Token"
                const token = btoa(JSON.stringify({ twitchId, exp: now + (7 * 24 * 60 * 60 * 1000) }));

                // Inform Client
                this.room.send({
                    type: 'link_success',
                    targetId: websimClientId,
                    token: token,
                    playerData: player
                });

                delete this.pendingLinks[code];
                appendHostLog(`Link success: ${username} ↔ WebSim client ${websimClientId}.`);
                console.log(`Linked ${username} to websim client ${websimClientId}`);
            } else {
                appendHostLog(`Link failed for ${username}: code "${code}" not found or expired.`);
            }
        }

        // Update Twitch user list in dropdown
        this.refreshPlayerList();
    }

    setupHostListeners() {
        this.room.onmessage = async (event) => {
            const data = event.data;
            const senderId = data.clientId; // WebSim client ID

            // Ignore directed messages not meant for this host client
            if (data.targetId && data.targetId !== this.room.clientId) return;

            // Host handles both host-specific and client-style messages

            if (data.type === 'link_code_generated') {
                appendHostLog(`Generated link code "${data.code}" for WebSim client ${senderId}.`);
                if (this.onLinkCode) this.onLinkCode(data.code);
                return;
            } else if (data.type === 'link_success') {
                // Store token locally (host can also be a linked client)
                if (data.token) {
                    localStorage.setItem('sq_token', data.token);
                }
                appendHostLog(`Host received link_success for a client.`);
                if (this.onLinkSuccess && data.playerData) this.onLinkSuccess(data.playerData);
                return;
            } else if (data.type === 'sync_data' || data.type === 'state_update' || data.type === 'energy_update') {
                if (data.playerData && this.onStateUpdate) {
                    this.onStateUpdate(data.playerData);
                }
                return;
            } else if (data.type === 'token_invalid') {
                // Host's local client token was rejected/expired
                localStorage.removeItem('sq_token');
                if (this.onTokenInvalid) this.onTokenInvalid();
                return;
            }

            if (data.type === 'request_link_code') {
                // Generate 6-character code
                const code = this.generateLinkCode();
                this.pendingLinks[code] = {
                    websimClientId: senderId,
                    createdAt: Date.now()
                };
                appendHostLog(`Link code "${code}" created for WebSim client ${senderId}.`);

                this.room.send({
                    type: 'link_code_generated',
                    targetId: senderId,
                    code: code
                });
            } else if (data.type === 'sync_request') {
                // Verify token
                const player = await this.validateToken(data.token);
                if (player) {
                    // Update link if changed
                    if (player.linkedWebsimId !== senderId) {
                        player.linkedWebsimId = senderId;
                        await savePlayer(player.twitchId, player);
                        appendHostLog(`Sync updated link for ${player.username} to WebSim client ${senderId}.`);
                    }

                    this.room.send({
                        type: 'sync_data',
                        targetId: senderId,
                        playerData: player
                    });
                } else {
                    appendHostLog(`sync_request from ${senderId} failed token validation (expired/invalid).`);
                    this.room.send({
                        type: 'token_invalid',
                        targetId: senderId
                    });
                }
            } else if (data.type === 'start_task') {
                const player = await this.validateToken(data.token);
                if (player) {
                    // Check if they have energy
                    if (player.energy.length > 0) {
                        // Consume oldest energy
                        player.energy.shift(); 

                        // Set Task
                        player.activeTask = {
                            taskId: data.taskId,
                            startTime: Date.now(),
                            duration: data.duration
                        };

                        await savePlayer(player.twitchId, player);
                        appendHostLog(`Task "${data.taskId}" started for ${player.username}.`);

                        // Broadcast update
                        this.room.send({
                            type: 'state_update',
                            targetId: senderId,
                            playerData: player
                        });
                    } else {
                        appendHostLog(`Task start denied for ${player.username}: no energy.`);
                    }
                } else {
                    appendHostLog(`start_task from ${senderId} failed token validation (expired/invalid).`);
                    this.room.send({
                        type: 'token_invalid',
                        targetId: senderId
                    });
                }
            } else if (data.type === 'stop_task') {
                const player = await this.validateToken(data.token);
                if (player) {
                    appendHostLog(`Task "${player.activeTask?.taskId || 'unknown'}" stopped for ${player.username}.`);
                    player.activeTask = null;
                    await savePlayer(player.twitchId, player);
                    this.room.send({
                        type: 'state_update',
                        targetId: senderId,
                        playerData: player
                    });
                } else {
                    appendHostLog(`stop_task from ${senderId} failed token validation (expired/invalid).`);
                    this.room.send({
                        type: 'token_invalid',
                        targetId: senderId
                    });
                }
            } else if (data.type === 'client_delink') {
                // A client (or host) is requesting to de-link their Twitch account
                const player = await this.validateToken(data.token);
                if (player) {
                    appendHostLog(`De-link requested for ${player.username}. Clearing linked WebSim client.`);
                    player.linkedWebsimId = null;
                    await savePlayer(player.twitchId, player);

                    // Optionally tell that client their token is no longer valid
                    this.room.send({
                        type: 'token_invalid',
                        targetId: senderId
                    });

                    // Refresh Twitch user list so UI reflects de-link
                    this.refreshPlayerList();
                } else {
                    appendHostLog(`client_delink from ${senderId} failed token validation (expired/invalid).`);
                }
            }
        };
    }

    setupPresenceWatcher() {
        // Host tracks realtime Websim users
        this.room.subscribePresence(() => {
            if (!this.onPresenceUpdate) return;
            const peers = Object.entries(this.room.peers || {}).map(([id, info]) => ({
                id,
                username: info.username
            }));
            this.onPresenceUpdate(peers);
            // Also refresh Twitch users list so linked WebSim usernames stay up to date
            this.refreshPlayerList();
        });

        // Initial fire
        if (this.onPresenceUpdate) {
            const peers = Object.entries(this.room.peers || {}).map(([id, info]) => ({
                id,
                username: info.username
            }));
            this.onPresenceUpdate(peers);
        }
    }

    async refreshPlayerList() {
        if (!this.isHost || !this.onPlayerListUpdate) return;
        const players = await getAllPlayers();
        const peers = this.room.peers || {};
        this.onPlayerListUpdate(players, peers);
    }

    async validateToken(token) {
        try {
            const decoded = JSON.parse(atob(token));
            if (decoded.exp < Date.now()) return null;
            return await getPlayer(decoded.twitchId);
        } catch (e) {
            return null;
        }
    }

    // --- CLIENT LOGIC ---

    setupClientListeners() {
        this.room.onmessage = (event) => {
            const data = event.data;

            // Filter messages meant for me
            if (data.targetId && data.targetId !== this.room.clientId) return;

            switch (data.type) {
                case 'link_code_generated':
                    if (this.onLinkCode) this.onLinkCode(data.code);
                    break;
                case 'link_success':
                    localStorage.setItem('sq_token', data.token);
                    if (this.onLinkSuccess) this.onLinkSuccess(data.playerData);
                    break;
                case 'sync_data':
                case 'state_update':
                case 'energy_update':
                    if (data.energy) {
                        // partial update handling if needed
                    }
                    if (data.playerData && this.onStateUpdate) {
                        this.onStateUpdate(data.playerData);
                    }
                    break;
                case 'token_invalid':
                    // Host rejected token (likely expired) – clear it and notify UI
                    localStorage.removeItem('sq_token');
                    if (this.onTokenInvalid) this.onTokenInvalid();
                    break;
            }
        };
    }

    requestLinkCode() {
        this.room.send({ type: 'request_link_code' });
    }

    syncWithToken(token) {
        this.room.send({ type: 'sync_request', token });
    }

    startTask(taskId, duration) {
        const token = localStorage.getItem('sq_token'); 
        this.room.send({ 
            type: 'start_task', 
            taskId, 
            duration,
            token: token 
        });
    }

    stopTask() {
        this.room.send({ 
            type: 'stop_task', 
            token: localStorage.getItem('sq_token') 
        });
    }

    // New: request a de-link so host can clear the Twitch <-> WebSim association
    requestDelink() {
        const token = localStorage.getItem('sq_token');
        if (!token) return;
        this.room.send({
            type: 'client_delink',
            token
        });
    }
}