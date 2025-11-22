import { SKILLS } from './skills.js';

export class UIManager {
    constructor(networkManager, isHost = false) {
        this.network = networkManager;
        this.state = null;
        this.activeTaskInterval = null;
        this.isHost = isHost;

        // Elements
        this.skillsList = document.getElementById('skills-list');
        this.authOverlay = document.getElementById('auth-overlay');
        this.skillDetails = document.getElementById('skill-details');
        this.activeTaskContainer = document.getElementById('active-task-container');
        this.energyCount = document.getElementById('energy-count');
        this.usernameDisplay = document.getElementById('username');
        this.userAvatar = document.getElementById('user-avatar');
        this.linkAccountBtn = document.getElementById('link-account-btn');

        // Host-specific elements
        this.hostUserMenu = document.getElementById('host-user-menu');
        this.hostUserBtn = document.getElementById('host-user-btn');
        this.hostUserDropdown = document.getElementById('host-user-dropdown');
        this.realtimeUsersList = document.getElementById('realtime-users-list');
        this.twitchUsersList = document.getElementById('twitch-users-list');

        // Client user dropdown elements (also used by host now)
        this.userInfoEl = document.getElementById('user-info');
        this.clientUserDropdown = document.getElementById('client-user-dropdown');
        this.clientDelinkBtn = document.getElementById('client-delink-btn');

        // Pre-fill host channel if saved
        const savedChannel = localStorage.getItem('sq_host_channel');
        const channelInput = document.getElementById('twitch-channel-input');
        if (savedChannel && channelInput) {
            channelInput.value = savedChannel;
        }

        // Host UI visibility
        if (this.isHost) {
            if (this.hostUserMenu) {
                this.hostUserMenu.style.display = 'flex';
            }
        }

        this.initListeners();
        this.renderSkillsList();
        this.updateAuthUI();
    }

    initListeners() {
        const connectBtn = document.getElementById('connect-twitch-btn');
        if (connectBtn) {
            connectBtn.addEventListener('click', () => {
                const channel = document.getElementById('twitch-channel-input').value;
                if(channel) {
                    this.network.connectTwitch(channel);
                    document.getElementById('tmi-status').innerText = "Status: Connected to " + channel;
                    document.getElementById('tmi-status').style.color = "#4ade80";

                    // After the host connects to a Twitch channel, attempt auto-sync
                    const token = localStorage.getItem('sq_token');
                    if (token) {
                        this.network.syncWithToken(token);
                    }
                }
            });
        }

        document.getElementById('stop-btn').addEventListener('click', () => {
            this.network.stopTask();
        });

        // Top-right link button (host + client)
        if (this.linkAccountBtn) {
            this.linkAccountBtn.addEventListener('click', () => {
                this.network.requestLinkCode();
                if (this.authOverlay) {
                    this.authOverlay.style.display = 'flex';
                }
            });
        }

        // Host dropdown interactions
        if (this.isHost && this.hostUserBtn && this.hostUserDropdown) {
            this.hostUserBtn.addEventListener('click', () => {
                const isOpen = this.hostUserDropdown.style.display === 'block';
                this.hostUserDropdown.style.display = isOpen ? 'none' : 'block';
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!this.hostUserMenu) return;
                if (!this.hostUserMenu.contains(e.target)) {
                    this.hostUserDropdown.style.display = 'none';
                }
            });
        }

        // User dropdown interactions (both host and clients)
        if (this.userInfoEl && this.clientUserDropdown) {
            this.userInfoEl.addEventListener('click', (e) => {
                // Avoid toggling when clicking inside the dropdown content
                if (this.clientUserDropdown.contains(e.target)) return;
                const hasToken = !!localStorage.getItem('sq_token');
                if (!hasToken) return; // no dropdown when not linked
                const isOpen = this.clientUserDropdown.style.display === 'block';
                this.clientUserDropdown.style.display = isOpen ? 'none' : 'block';
            });

            document.addEventListener('click', (e) => {
                if (!this.userInfoEl) return;
                if (!this.userInfoEl.contains(e.target)) {
                    this.clientUserDropdown.style.display = 'none';
                }
            });
        }

        if (this.clientDelinkBtn) {
            this.clientDelinkBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // De-Link for host or client: inform host, then clear token and reset UI
                this.network.requestDelink();
                localStorage.removeItem('sq_token');
                if (this.authOverlay) {
                    this.authOverlay.style.display = 'none';
                }
                if (this.clientUserDropdown) {
                    this.clientUserDropdown.style.display = 'none';
                }
                this.updateAuthUI();
            });
        }

        // Network callbacks
        this.network.onLinkCode = (code) => {
            const codeSpan = document.getElementById('link-code');
            if (codeSpan) {
                codeSpan.innerText = code;
            }

            const copyStatusEl = document.getElementById('global-link-copy-status');

            // Copy to clipboard for convenience (host + client)
            if (navigator.clipboard) {
                const linkCommand = `!link ${code}`;
                navigator.clipboard.writeText(linkCommand).then(() => {
                    if (copyStatusEl) {
                        copyStatusEl.innerText = 'Copied to Clipboard – Paste in Twitch Chat to link';
                        clearTimeout(this._copyStatusTimeout);
                        this._copyStatusTimeout = setTimeout(() => {
                            copyStatusEl.innerText = '';
                        }, 4000);
                    }
                }).catch(() => {
                    if (copyStatusEl) {
                        copyStatusEl.innerText = '';
                    }
                });
            }
        };

        this.network.onLinkSuccess = (playerData) => {
            if (this.authOverlay) {
                this.authOverlay.style.display = 'none';
            }
            this.updateState(playerData);
            this.updateAuthUI();
        };

        this.network.onStateUpdate = (playerData) => {
            this.updateState(playerData);
            this.updateAuthUI();
        };

        // When host tells us our token is invalid/expired, force re-link flow
        this.network.onTokenInvalid = () => {
            if (this.authOverlay) {
                this.authOverlay.style.display = 'none';
            }
            this.updateAuthUI();
        };

        if (this.isHost) {
            this.network.onPresenceUpdate = (peers) => {
                this.renderRealtimeUsers(peers);
            };

            this.network.onPlayerListUpdate = (players, peers) => {
                this.renderTwitchUsers(players, peers);
            };
        }
    }

    updateAuthUI() {
        const hasToken = !!localStorage.getItem('sq_token');

        if (this.linkAccountBtn) {
            this.linkAccountBtn.style.display = hasToken ? 'none' : 'inline-block';
        }

        if (this.userAvatar) {
            this.userAvatar.style.display = hasToken ? 'block' : 'none';
        }
        if (this.usernameDisplay) {
            this.usernameDisplay.style.display = hasToken ? 'inline-block' : 'none';
            if (!hasToken) {
                this.usernameDisplay.innerText = 'Guest';
            }
        }

        // Hide dropdown when not linked
        if (!hasToken && this.clientUserDropdown) {
            this.clientUserDropdown.style.display = 'none';
        }
    }

    renderSkillsList() {
        this.skillsList.innerHTML = '';
        Object.values(SKILLS).forEach(skill => {
            const div = document.createElement('div');
            div.className = 'skill-item';
            div.innerHTML = `
                <img src="${skill.icon}" alt="${skill.name}">
                <span>${skill.name}</span>
            `;
            div.onclick = () => this.showSkillDetails(skill);
            this.skillsList.appendChild(div);
        });
    }

    showSkillDetails(skill) {
        this.skillDetails.style.display = 'block';
        document.getElementById('detail-icon').src = skill.icon;
        document.getElementById('detail-name').innerText = skill.name;
        document.getElementById('detail-desc').innerText = skill.description;

        const grid = document.getElementById('task-grid');
        grid.innerHTML = '';

        skill.tasks.forEach(task => {
            const card = document.createElement('div');
            card.className = 'task-card';

            const hasEnergy = this.state && this.state.energy.length > 0;
            const isBusy = this.state && this.state.activeTask;

            card.innerHTML = `
                <h4>${task.name}</h4>
                <p>Time: ${task.duration / 1000}s</p>
                <p>XP: ${task.xp}</p>
            `;

            const btn = document.createElement('button');
            btn.innerText = isBusy ? (this.state.activeTask.taskId === task.id ? "In Progress" : "Busy") : "Start";

            if (isBusy || !hasEnergy) {
                btn.disabled = true;
                if (!hasEnergy && !isBusy) btn.innerText = "No Energy";
            }

            btn.onclick = () => {
                this.network.startTask(task.id, task.duration);
            };

            card.appendChild(btn);
            grid.appendChild(card);
        });
    }

    updateState(playerData) {
        this.state = playerData;

        // Update User Info
        if (this.usernameDisplay) {
            this.usernameDisplay.innerText = playerData.username;
        }

        // Update Energy
        this.energyCount.innerText = `${playerData.energy.length}/12`;

        // Update Active Task UI
        if (playerData.activeTask) {
            this.activeTaskContainer.style.display = 'flex';
            this.startProgressLoop(playerData.activeTask);

            // Update Buttons in current view
            if(this.skillDetails.style.display !== 'none') {
                // Refresh grid to update disabled states
                const activeSkill = Object.values(SKILLS).find(s => 
                    s.tasks.some(t => t.id === playerData.activeTask.taskId)
                );
                if (activeSkill) { 
                    // Optional: auto-switch to active skill view?
                    // For now, just re-render if visible
                   const currentTitle = document.getElementById('detail-name').innerText;
                   const skillOfCurrentView = Object.values(SKILLS).find(s => s.name === currentTitle);
                   if(skillOfCurrentView) this.showSkillDetails(skillOfCurrentView);
                }
            }

        } else {
            this.activeTaskContainer.style.display = 'none';
            this.stopProgressLoop();

             // Refresh grid to re-enable buttons
             const currentTitle = document.getElementById('detail-name').innerText;
             const skillOfCurrentView = Object.values(SKILLS).find(s => s.name === currentTitle);
             if(skillOfCurrentView) this.showSkillDetails(skillOfCurrentView);
        }
    }

    startProgressLoop(taskData) {
        this.stopProgressLoop();

        // Find Task Info
        let taskDef = null;
        for(const s of Object.values(SKILLS)) {
            const t = s.tasks.find(t => t.id === taskData.taskId);
            if(t) { taskDef = t; break; }
        }

        if(!taskDef) return;

        document.getElementById('task-label').innerText = taskDef.name;
        const fill = document.getElementById('task-progress');

        this.activeTaskInterval = setInterval(() => {
            const now = Date.now();
            const elapsed = now - taskData.startTime;
            let pct = (elapsed / taskData.duration) * 100;

            if (pct >= 100) {
                pct = 100;
                // In a real game, we'd auto-complete here, but for now we wait for server or keep it at 100
                // Since we didn't implement auto-finish in network.js for this prototype, it just loops visibly
            }

            fill.style.width = `${pct}%`;
        }, 100);
    }

    stopProgressLoop() {
        if (this.activeTaskInterval) {
            clearInterval(this.activeTaskInterval);
            this.activeTaskInterval = null;
        }
        document.getElementById('task-progress').style.width = '0%';
    }

    renderRealtimeUsers(peers) {
        if (!this.realtimeUsersList) return;
        this.realtimeUsersList.innerHTML = '';
        peers.forEach(peer => {
            const li = document.createElement('li');
            li.textContent = peer.username || peer.id;
            this.realtimeUsersList.appendChild(li);
        });
    }

    renderTwitchUsers(players, peers) {
        if (!this.twitchUsersList) return;
        this.twitchUsersList.innerHTML = '';
        players.forEach(player => {
            const li = document.createElement('li');
            const linked = player.linkedWebsimId ? 'linked' : 'unlinked';

            let linkedName = '';
            if (player.linkedWebsimId && peers && peers[player.linkedWebsimId]) {
                const peerInfo = peers[player.linkedWebsimId];
                linkedName = peerInfo.username || player.linkedWebsimId;
            }

            li.innerHTML = `
                <span class="user-name">${player.username}</span>
                <span class="user-meta">
                    (${linked}${linkedName ? ' → ' + linkedName : ''})
                </span>
            `;
            this.twitchUsersList.appendChild(li);
        });
    }
}