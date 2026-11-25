// Brief detail page
(function() {
    const GITHUB_OWNER = 'jimtsa80';
    const GITHUB_REPO = 'isieve-briefs';
    const GITHUB_BRANCH = 'main';
    const TOKEN_STORAGE_KEY = 'isieve_github_token';

    let currentBrief = null;
    let currentImages = [];
    let currentImageIndex = 0;
    let isEditingHeader = false;
    let isSavingHeader = false;
    let tokenModalResolver = null;

    function encodeBase64Utf8(str) {
        const bytes = new TextEncoder().encode(str);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    function decodeBase64Utf8(b64) {
        const clean = (b64 || '').replace(/\s+/g, '');
        const binary = atob(clean);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder().decode(bytes);
    }

    function getStoredToken() {
        try {
            return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
        } catch (e) {
            return '';
        }
    }

    function setStoredToken(token) {
        try {
            localStorage.setItem(TOKEN_STORAGE_KEY, token);
        } catch (e) {
            // ignore storage errors
        }
    }

    function clearStoredToken() {
        try {
            localStorage.removeItem(TOKEN_STORAGE_KEY);
        } catch (e) {
            // ignore storage errors
        }
    }

    async function loadBrief() {
        const params = new URLSearchParams(window.location.search);
        const briefId = params.get('id');

        if (!briefId) {
            showError('No brief ID provided');
            return;
        }

        try {
            const response = await fetch(`briefs/${briefId}/brief.json`);
            if (!response.ok) {
                throw new Error('Brief not found');
            }

            currentBrief = await response.json();
            renderBrief(currentBrief);
        } catch (error) {
            console.error('Error loading brief:', error);
            showError(`Error loading brief: ${error.message}`);
        }
    }

    function buildHeaderHtml(brief) {
        const hasToken = Boolean(getStoredToken());
        const forgetLinkHtml = hasToken
            ? `<button type="button" id="forgetTokenLink" class="btn-link">Forget token</button>`
            : '';

        if (isEditingHeader) {
            return `
                <div class="brief-header-top">
                    <div>
                        <h2 style="margin-bottom: 0.25rem;">Edit brief details</h2>
                        <div class="text-muted">Changes are committed directly to ${GITHUB_OWNER}/${GITHUB_REPO} (${GITHUB_BRANCH}).</div>
                    </div>
                    <div class="brief-header-actions">
                        ${forgetLinkHtml}
                    </div>
                </div>
                <form id="editHeaderForm" class="brief-edit-form">
                    <div class="brief-edit-grid">
                        <div class="form-group">
                            <label for="editEvent">Event title *</label>
                            <input type="text" id="editEvent" value="${escapeHtml(brief.event || '')}" required>
                        </div>
                        <div class="form-group">
                            <label for="editClient">Client</label>
                            <input type="text" id="editClient" value="${escapeHtml(brief.client || '')}" placeholder="Optional">
                        </div>
                        <div class="form-group">
                            <label for="editCompetition">Competition</label>
                            <input type="text" id="editCompetition" value="${escapeHtml(brief.competition || '')}" placeholder="Optional">
                        </div>
                        <div class="form-group">
                            <label for="editSport">Sport</label>
                            <input type="text" id="editSport" value="${escapeHtml(brief.sport || '')}" placeholder="Optional">
                        </div>
                        <div class="form-group">
                            <label for="editDateStart">Start date</label>
                            <input type="date" id="editDateStart" value="${escapeHtml(brief.date_start || '')}">
                        </div>
                        <div class="form-group">
                            <label for="editDateEnd">End date</label>
                            <input type="date" id="editDateEnd" value="${escapeHtml(brief.date_end || '')}">
                        </div>
                    </div>
                    <div id="editHeaderStatus" class="edit-status" style="display: none;"></div>
                    <div class="brief-edit-actions">
                        <button type="submit" id="saveHeaderBtn" class="btn btn-primary" ${isSavingHeader ? 'disabled' : ''}>
                            ${isSavingHeader ? 'Saving...' : 'Save'}
                        </button>
                        <button type="button" id="cancelHeaderBtn" class="btn btn-secondary" ${isSavingHeader ? 'disabled' : ''}>Cancel</button>
                    </div>
                </form>
            `;
        }

        return `
            <div class="brief-header-top">
                <div>
                    <h1 class="brief-title">${escapeHtml(brief.event)}</h1>
                    <div class="brief-client">${escapeHtml(brief.client || '')}</div>
                </div>
                <div class="brief-header-actions">
                    <button type="button" id="editHeaderBtn" class="btn btn-secondary btn-sm">Edit</button>
                    ${forgetLinkHtml}
                </div>
            </div>

            <div class="brief-meta-grid">
                ${brief.competition ? `
                    <div class="meta-item">
                        <div class="meta-label">Competition</div>
                        <div class="meta-value">${escapeHtml(brief.competition)}</div>
                    </div>
                ` : ''}

                ${brief.sport ? `
                    <div class="meta-item">
                        <div class="meta-label">Sport</div>
                        <div class="meta-value">${escapeHtml(brief.sport)}</div>
                    </div>
                ` : ''}

                ${brief.date_start || brief.date_end ? `
                    <div class="meta-item">
                        <div class="meta-label">Period</div>
                        <div class="meta-value">
                            ${formatDate(brief.date_start)}${brief.date_end && brief.date_end !== brief.date_start ? ` - ${formatDate(brief.date_end)}` : ''}
                        </div>
                    </div>
                ` : ''}

                ${brief.footage_clips ? `
                    <div class="meta-item">
                        <div class="meta-label">Footage/Clips</div>
                        <div class="meta-value">${escapeHtml(brief.footage_clips)}</div>
                    </div>
                ` : ''}
            </div>

            ${brief.notes ? `
                <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border);">
                    <div class="meta-label">Notes</div>
                    <div style="margin-top: 0.5rem;">${escapeHtml(brief.notes)}</div>
                </div>
            ` : ''}
        `;
    }

    function renderBriefHeader() {
        const headerEl = document.getElementById('briefHeader');
        if (!headerEl || !currentBrief) return;
        headerEl.innerHTML = buildHeaderHtml(currentBrief);
        attachHeaderListeners();
        if (currentBrief.event) {
            document.title = `${currentBrief.event} - isieve`;
        }
    }

    function attachHeaderListeners() {
        const editBtn = document.getElementById('editHeaderBtn');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                isEditingHeader = true;
                renderBriefHeader();
                const eventInput = document.getElementById('editEvent');
                if (eventInput) eventInput.focus();
            });
        }

        const cancelBtn = document.getElementById('cancelHeaderBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                isEditingHeader = false;
                renderBriefHeader();
            });
        }

        const editForm = document.getElementById('editHeaderForm');
        if (editForm) {
            editForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await handleSaveHeader();
            });
        }

        const forgetLink = document.getElementById('forgetTokenLink');
        if (forgetLink) {
            forgetLink.addEventListener('click', () => {
                clearStoredToken();
                renderBriefHeader();
                showToast('GitHub token removed');
            });
        }
    }

    function setHeaderStatus(message, type) {
        const statusEl = document.getElementById('editHeaderStatus');
        if (!statusEl) return;
        if (!message) {
            statusEl.style.display = 'none';
            statusEl.textContent = '';
            statusEl.className = 'edit-status';
            return;
        }
        statusEl.textContent = message;
        statusEl.className = `edit-status ${type || 'info'}`;
        statusEl.style.display = 'block';
    }

    function requestTokenFromUser(errorMessage) {
        const modal = document.getElementById('tokenModal');
        const input = document.getElementById('githubTokenInput');
        const errEl = document.getElementById('tokenModalError');

        if (!modal || !input) {
            return Promise.resolve(null);
        }

        if (errorMessage) {
            errEl.textContent = errorMessage;
            errEl.style.display = 'block';
        } else {
            errEl.textContent = '';
            errEl.style.display = 'none';
        }

        input.value = '';
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        setTimeout(() => input.focus(), 50);

        return new Promise((resolve) => {
            tokenModalResolver = resolve;
        });
    }

    function closeTokenModal(tokenValue) {
        const modal = document.getElementById('tokenModal');
        if (modal) {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
        }
        if (tokenModalResolver) {
            const resolve = tokenModalResolver;
            tokenModalResolver = null;
            resolve(tokenValue || null);
        }
    }

    async function githubGetFile(path, token) {
        const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(GITHUB_BRANCH)}&_=${Date.now()}`;
        const res = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`
            }
        });
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const err = new Error(errBody.message || `GitHub GET ${path} failed (${res.status})`);
            err.status = res.status;
            throw err;
        }
        return await res.json();
    }

    async function githubPutFile(path, token, message, contentStr, sha) {
        const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message,
                content: encodeBase64Utf8(contentStr),
                sha,
                branch: GITHUB_BRANCH
            })
        });
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const err = new Error(errBody.message || `GitHub PUT ${path} failed (${res.status})`);
            err.status = res.status;
            throw err;
        }
        return await res.json();
    }

    function isShaConflictError(err) {
        if (!err) return false;
        if (err.status === 409) return true;
        if (err.status === 422 && /sha|conflict|does not match/i.test(err.message || '')) return true;
        return false;
    }

    async function updateGitHubFileWithRetry(path, token, commitMessage, transformFn) {
        let attempts = 0;
        while (attempts < 2) {
            attempts += 1;
            const fileData = await githubGetFile(path, token);
            const parsed = JSON.parse(decodeBase64Utf8(fileData.content));
            const updatedObj = transformFn(parsed);
            const serialized = JSON.stringify(updatedObj, null, 2) + '\n';
            try {
                await githubPutFile(path, token, commitMessage, serialized, fileData.sha);
                return updatedObj;
            } catch (err) {
                if (isShaConflictError(err) && attempts < 2) {
                    continue;
                }
                throw err;
            }
        }
    }

    function applyUpdatesToBrief(briefObj, updates) {
        return {
            ...briefObj,
            event: updates.event,
            client: updates.client,
            competition: updates.competition,
            sport: updates.sport,
            date_start: updates.date_start,
            date_end: updates.date_end
        };
    }

    function applyUpdatesToIndex(indexList, briefObj, updates) {
        const list = Array.isArray(indexList) ? indexList.slice() : [];
        let found = false;
        const nextList = list.map((entry) => {
            if (entry && entry.id === briefObj.id) {
                found = true;
                return {
                    ...entry,
                    event: updates.event,
                    client: updates.client,
                    competition: updates.competition,
                    sport: updates.sport,
                    date_start: updates.date_start,
                    date_end: updates.date_end
                };
            }
            return entry;
        });

        if (!found) {
            nextList.unshift({
                id: briefObj.id,
                client: updates.client,
                event: updates.event,
                competition: updates.competition,
                sport: updates.sport,
                date_start: updates.date_start,
                date_end: updates.date_end,
                brand_count: (briefObj.brands || []).length,
                location_count: (briefObj.locations || []).length,
                combination_count: (briefObj.combinations || []).length,
                brands: briefObj.brands || [],
                locations: briefObj.locations || [],
                created_at: briefObj.created_at || new Date().toISOString()
            });
        }
        return nextList;
    }

    async function handleSaveHeader() {
        if (!currentBrief || isSavingHeader) return;

        const eventVal = (document.getElementById('editEvent')?.value || '').trim();
        if (!eventVal) {
            setHeaderStatus('Event title is required.', 'error');
            return;
        }

        const clientVal = (document.getElementById('editClient')?.value || '').trim();
        const competitionVal = (document.getElementById('editCompetition')?.value || '').trim() || null;
        const sportVal = (document.getElementById('editSport')?.value || '').trim() || null;
        const dateStartVal = (document.getElementById('editDateStart')?.value || '').trim() || null;
        const dateEndVal = (document.getElementById('editDateEnd')?.value || '').trim() || null;

        const updates = {
            event: eventVal,
            client: clientVal,
            competition: competitionVal,
            sport: sportVal,
            date_start: dateStartVal,
            date_end: dateEndVal
        };

        let token = getStoredToken();
        if (!token) {
            token = await requestTokenFromUser();
            if (!token) {
                setHeaderStatus('Save cancelled (no GitHub token provided).', 'error');
                return;
            }
            setStoredToken(token);
        }

        isSavingHeader = true;
        const saveBtn = document.getElementById('saveHeaderBtn');
        const cancelBtn = document.getElementById('cancelHeaderBtn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
        if (cancelBtn) { cancelBtn.disabled = true; }
        setHeaderStatus('Saving changes to GitHub...', 'info');

        try {
            let savedBrief = null;
            let authAttempts = 0;
            while (true) {
                authAttempts += 1;
                try {
                    const briefPath = `briefs/${currentBrief.id}/brief.json`;
                    savedBrief = await updateGitHubFileWithRetry(
                        briefPath,
                        token,
                        `Update brief header: ${updates.event}`,
                        (briefJson) => applyUpdatesToBrief(briefJson, updates)
                    );

                    await updateGitHubFileWithRetry(
                        'briefs/index.json',
                        token,
                        `Update briefs index: ${updates.event}`,
                        (indexJson) => applyUpdatesToIndex(indexJson, savedBrief || currentBrief, updates)
                    );
                    break;
                } catch (err) {
                    if (err && err.status === 401 && authAttempts < 3) {
                        clearStoredToken();
                        const newToken = await requestTokenFromUser('GitHub rejected the token (401 Unauthorized). Please enter a valid token.');
                        if (!newToken) {
                            throw new Error('Authentication cancelled after 401 Unauthorized.');
                        }
                        token = newToken;
                        setStoredToken(token);
                        continue;
                    }
                    throw err;
                }
            }

            currentBrief = applyUpdatesToBrief(currentBrief, updates);
            isEditingHeader = false;
            isSavingHeader = false;
            renderBriefHeader();
            showToast('Changes saved to GitHub');
        } catch (err) {
            console.error('Error saving brief header:', err);
            isSavingHeader = false;
            const saveBtnAfter = document.getElementById('saveHeaderBtn');
            const cancelBtnAfter = document.getElementById('cancelHeaderBtn');
            if (saveBtnAfter) { saveBtnAfter.disabled = false; saveBtnAfter.textContent = 'Save'; }
            if (cancelBtnAfter) { cancelBtnAfter.disabled = false; }
            setHeaderStatus(`Save failed: ${err.message}`, 'error');
        }
    }

    function renderBrief(brief) {
        const container = document.getElementById('briefContainer');

        let html = `
            <div class="brief-header" id="briefHeader">
                ${buildHeaderHtml(brief)}
            </div>
        `;

        // Brands section
        if (brief.brands && brief.brands.length > 0) {
            html += `
                <div class="brief-section">
                    <h2>Brands (${brief.brands.length})</h2>
                    <div class="brands-list">
                        ${brief.brands.map(brand => `
                            <div class="brand-tag" onclick="copyToClipboard('${escapeHtml(brand).replace(/'/g, '\\\'')}')">
                                ${escapeHtml(brand)}
                                <span class="copy-btn">📋</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Locations section
        if (brief.locations && brief.locations.length > 0) {
            html += `
                <div class="brief-section">
                    <h2>Locations / Assets (${brief.locations.length})</h2>
                    <div class="locations-list">
                        ${brief.locations.map(location => `
                            <div class="location-tag" onclick="copyToClipboard('${escapeHtml(location).replace(/'/g, '\\\'')}')">
                                ${escapeHtml(location)}
                                <span class="copy-btn">📋</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Combinations section
        if (brief.combinations && brief.combinations.length > 0) {
            html += `
                <div class="brief-section">
                    <h2>Brand × Location Combinations (${brief.combinations.length})</h2>

                    <div class="combinations-filter">
                        <input type="text" id="filterBrand" placeholder="Filter Brand..." style="padding: 0.5rem; border: 1px solid var(--border); border-radius: 6px;">
                        <input type="text" id="filterLocation" placeholder="Filter Location..." style="padding: 0.5rem; border: 1px solid var(--border); border-radius: 6px;">
                        <button onclick="document.getElementById('filterBrand').value=''; document.getElementById('filterLocation').value=''; filterCombinations()" class="btn btn-secondary btn-sm">Clear</button>
                    </div>

                    <div class="combinations-grid" id="combinationsGrid">
                        ${brief.combinations.map(combo => renderCombination(combo, brief)).join('')}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;

        if (brief.event) {
            document.title = `${brief.event} - isieve`;
        }

        attachHeaderListeners();
        const brandFilter = document.getElementById('filterBrand');
        const locationFilter = document.getElementById('filterLocation');
        if (brandFilter) brandFilter.addEventListener('input', filterCombinations);
        if (locationFilter) locationFilter.addEventListener('input', filterCombinations);
    }

    function renderCombination(combo, brief) {
        const normalize = (str) => str.toLowerCase().replace(/\s+/g, '');
        const comboBrand = normalize(combo.brand);
        const comboLocation = normalize(combo.location);

        const matchingImages = (brief.images || [])
            .filter(img => img.type === 'example' &&
                           normalize(img.brand || '') === comboBrand &&
                           normalize(img.location || '') === comboLocation)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

        const images = matchingImages.length > 0 ? matchingImages : (combo.images || []);

        return `
            <div class="combination-card">
                <div class="combination-header">
                    <div class="combination-title">
                        <span class="brand-name" onclick="copyToClipboard('${escapeHtml(combo.brand).replace(/'/g, '\\\'')}')" title="Click to copy">
                            ${escapeHtml(combo.brand)}
                        </span>
                        <span style="opacity: 0.5; margin: 0 0.3rem;">×</span>
                        ${escapeHtml(combo.location)}
                    </div>
                    ${combo.auto_closed ? '<span class="auto-closed-badge">Auto-closed</span>' : ''}
                </div>

                ${images.length > 0 ? `
                    <div class="combination-images">
                        ${images.map(img => {
                            const thumbSrc = img.thumbnail ? `briefs/${brief.id}/${img.thumbnail}` : `briefs/${brief.id}/${img.filename}`;
                            const fullSrc = `briefs/${brief.id}/${img.filename}`;
                            return `
                            <div class="combo-image">
                                <img src="${thumbSrc}"
                                     data-full="${fullSrc}"
                                     alt="${escapeHtml(combo.brand)} - ${escapeHtml(combo.location)}"
                                     loading="lazy"
                                     decoding="async"
                                     onclick="openLightbox('${fullSrc}', '${escapeHtml(combo.brand).replace(/'/g, '\\\'')} × ${escapeHtml(combo.location).replace(/'/g, '\\\'')}')">
                            </div>`;
                        }).join('')}
                    </div>
                ` : '<div class="text-muted">No example images</div>'}

                ${combo.notes ? `<div class="text-muted" style="margin-top: 0.5rem; font-size: 0.85rem;">${escapeHtml(combo.notes)}</div>` : ''}
            </div>
        `;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
        const date = match
            ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
            : new Date(dateStr);
        if (Number.isNaN(date.getTime())) return String(dateStr);
        return date.toLocaleDateString('en-US', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showError(message) {
        document.getElementById('briefContainer').innerHTML = `
            <div class="error-message">
                <strong>Error:</strong> ${escapeHtml(message)}
            </div>
        `;
    }

    function showToast(message) {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: var(--success);
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            z-index: 9999;
            animation: slideIn 0.3s ease-out;
        `;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 2500);
    }

    // Lightbox functions
    window.openLightbox = function(imageSrc, caption) {
        const lightbox = document.getElementById('lightbox');
        const lightboxImage = document.getElementById('lightboxImage');
        const lightboxCaption = document.getElementById('lightboxCaption');

        lightboxImage.src = imageSrc;
        lightboxCaption.textContent = caption;
        lightbox.classList.add('active');

        currentImages = Array.from(document.querySelectorAll('.combo-image img'))
            .map(img => ({
                src: img.getAttribute('data-full') || img.src,
                caption: img.alt
            }));

        const targetPath = imageSrc;
        currentImageIndex = currentImages.findIndex(img => img.src === targetPath || lightboxImage.src.endsWith(img.src));
        if (currentImageIndex < 0) currentImageIndex = 0;
        updateLightboxNav();
    };

    function closeLightbox() {
        document.getElementById('lightbox').classList.remove('active');
    }

    function navigateLightbox(direction) {
        if (currentImages.length === 0) return;

        currentImageIndex += direction;
        if (currentImageIndex < 0) currentImageIndex = currentImages.length - 1;
        if (currentImageIndex >= currentImages.length) currentImageIndex = 0;

        const img = currentImages[currentImageIndex];
        document.getElementById('lightboxImage').src = img.src;
        document.getElementById('lightboxCaption').textContent = img.caption;
        updateLightboxNav();
    }

    function updateLightboxNav() {
        document.getElementById('lightboxCounter').textContent =
            `${currentImageIndex + 1} / ${currentImages.length}`;
    }

    // Copy to clipboard
    window.copyToClipboard = function(text) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(`Copied: ${text}`);
        });
    };

    // Filter combinations
    window.filterCombinations = function() {
        if (!currentBrief) return;

        const brandFilter = (document.getElementById('filterBrand')?.value || '').toLowerCase();
        const locationFilter = (document.getElementById('filterLocation')?.value || '').toLowerCase();

        const grid = document.getElementById('combinationsGrid');
        if (!grid) return;

        const filtered = currentBrief.combinations.filter(combo => {
            const brandMatch = !brandFilter || combo.brand.toLowerCase().includes(brandFilter);
            const locationMatch = !locationFilter || combo.location.toLowerCase().includes(locationFilter);
            return brandMatch && locationMatch;
        });

        grid.innerHTML = filtered.map(combo => renderCombination(combo, currentBrief)).join('');

        if (filtered.length === 0) {
            grid.innerHTML = '<div class="text-muted" style="grid-column: 1/-1; text-align: center; padding: 2rem;">No combinations found</div>';
        }
    };

    // Event listeners
    document.addEventListener('DOMContentLoaded', () => {
        loadBrief();

        // Lightbox controls
        document.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
        document.getElementById('lightbox').addEventListener('click', (e) => {
            if (e.target.id === 'lightbox') closeLightbox();
        });
        document.getElementById('lightboxPrev').addEventListener('click', () => navigateLightbox(-1));
        document.getElementById('lightboxNext').addEventListener('click', () => navigateLightbox(1));

        // Token modal controls
        const tokenModal = document.getElementById('tokenModal');
        const tokenInput = document.getElementById('githubTokenInput');
        const tokenSubmit = document.getElementById('tokenModalSubmit');
        const tokenCancel = document.getElementById('tokenModalCancel');

        if (tokenSubmit && tokenInput) {
            tokenSubmit.addEventListener('click', () => {
                const val = tokenInput.value.trim();
                if (!val) {
                    const errEl = document.getElementById('tokenModalError');
                    if (errEl) {
                        errEl.textContent = 'Please enter a GitHub token.';
                        errEl.style.display = 'block';
                    }
                    return;
                }
                closeTokenModal(val);
            });
            tokenInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    tokenSubmit.click();
                }
            });
        }
        if (tokenCancel) {
            tokenCancel.addEventListener('click', () => closeTokenModal(null));
        }
        if (tokenModal) {
            tokenModal.addEventListener('click', (e) => {
                if (e.target.id === 'tokenModal') closeTokenModal(null);
            });
        }

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (document.getElementById('lightbox').classList.contains('active')) {
                if (e.key === 'Escape') closeLightbox();
                if (e.key === 'ArrowLeft') navigateLightbox(-1);
                if (e.key === 'ArrowRight') navigateLightbox(1);
            } else if (tokenModal && tokenModal.classList.contains('active') && e.key === 'Escape') {
                closeTokenModal(null);
            }
        });
    });
})();
