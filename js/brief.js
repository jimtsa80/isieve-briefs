// Brief detail page
(function() {
    let currentBrief = null;
    let currentImages = [];
    let currentImageIndex = 0;

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

    function renderBrief(brief) {
        const container = document.getElementById('briefContainer');
        
        // Build HTML
        let html = `
            <div class="brief-header">
                <h1 class="brief-title">${escapeHtml(brief.event)}</h1>
                <div class="brief-client">${escapeHtml(brief.client)}</div>
                
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
                                ${formatDate(brief.date_start)} 
                                ${brief.date_end && brief.date_end !== brief.date_start ? ` - ${formatDate(brief.date_end)}` : ''}
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
            </div>
        `;
        
        // Brands section
        if (brief.brands && brief.brands.length > 0) {
            html += `
                <div class="brief-section">
                    <h2>Brands (${brief.brands.length})</h2>
                    <div class="brands-list">
                        ${brief.brands.map(brand => `
                            <div class="brand-tag" onclick="copyToClipboard('${escapeHtml(brand)}')">
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
                            <div class="location-tag" onclick="copyToClipboard('${escapeHtml(location)}')">
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
                        ${brief.combinations.map(combo => renderCombination(combo, brief.id)).join('')}
                    </div>
                </div>
            `;
        }
        
        // Rules/Annotations section
        if (brief.annotation_images && brief.annotation_images.length > 0) {
            html += `
                <div class="brief-section">
                    <h2>Rules & Exceptions</h2>
                    
                    ${brief.rules ? `
                        <div style="margin-bottom: 1.5rem; padding: 1rem; background: var(--bg-tertiary); border-radius: 6px;">
                            ${escapeHtml(brief.rules).replace(/\n/g, '<br>')}
                        </div>
                    ` : ''}
                    
                    <div class="rules-legend">
                        <div class="legend-item include">✓ Included (Green)</div>
                        <div class="legend-item exclude">✗ Excluded - Lookalike (Red)</div>
                        <div class="legend-item variant">⚠ Variant (Yellow/Orange)</div>
                    </div>
                    
                    <div class="annotation-images">
                        ${brief.annotation_images.map(img => `
                            <div class="annotation-card">
                                <img src="briefs/${brief.id}/${img.filename}" 
                                     alt="Annotation" 
                                     onclick="openLightbox('briefs/${brief.id}/${img.filename}', 'Annotation: ${img.annotation_type || 'include'}')">
                                <div class="annotation-label ${img.annotation_type || 'include'}">
                                    ${getAnnotationLabel(img.annotation_type)}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (brief.rules) {
            html += `
                <div class="brief-section">
                    <h2>Rules & Exceptions</h2>
                    <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 6px;">
                        ${escapeHtml(brief.rules).replace(/\n/g, '<br>')}
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html;
    }

    function renderCombination(combo, briefId) {
        const images = combo.images || [];
        
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
                        ${images.map(img => `
                            <div class="combo-image">
                                <img src="briefs/${briefId}/${img.filename}" 
                                     alt="${escapeHtml(combo.brand)} - ${escapeHtml(combo.location)}"
                                     onclick="openLightbox('briefs/${briefId}/${img.filename}', '${escapeHtml(combo.brand)} × ${escapeHtml(combo.location)}')">
                            </div>
                        `).join('')}
                    </div>
                ` : '<div class="text-muted">No example images</div>'}
                
                ${combo.notes ? `<div class="text-muted" style="margin-top: 0.5rem; font-size: 0.85rem;">${escapeHtml(combo.notes)}</div>` : ''}
            </div>
        `;
    }

    function getAnnotationLabel(type) {
        switch(type) {
            case 'exclude': return '✗ Excluded (Lookalike)';
            case 'variant': return '⚠ Variant';
            case 'include':
            default: return '✓ Included';
        }
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
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

    // Lightbox functions
    window.openLightbox = function(imageSrc, caption) {
        const lightbox = document.getElementById('lightbox');
        const lightboxImage = document.getElementById('lightboxImage');
        const lightboxCaption = document.getElementById('lightboxCaption');
        
        lightboxImage.src = imageSrc;
        lightboxCaption.textContent = caption;
        lightbox.classList.add('active');
        
        // Build image list for navigation
        currentImages = Array.from(document.querySelectorAll('.combo-image img, .annotation-card img'))
            .map(img => ({
                src: img.src,
                caption: img.alt
            }));
        
        currentImageIndex = currentImages.findIndex(img => img.src === lightboxImage.src);
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
            // Show brief feedback
            const notification = document.createElement('div');
            notification.textContent = `Copied: ${text}`;
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
            }, 2000);
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
        
        grid.innerHTML = filtered.map(combo => renderCombination(combo, currentBrief.id)).join('');
        
        if (filtered.length === 0) {
            grid.innerHTML = '<div class="text-muted" style="grid-column: 1/-1; text-align: center; padding: 2rem;">No combinations found</div>';
        }
    };
    
    // Event listeners
    document.addEventListener('DOMContentLoaded', () => {
        loadBrief();
        
        // Setup filter listeners after brief loads
        setTimeout(() => {
            const brandFilter = document.getElementById('filterBrand');
            const locationFilter = document.getElementById('filterLocation');
            if (brandFilter) brandFilter.addEventListener('input', filterCombinations);
            if (locationFilter) locationFilter.addEventListener('input', filterCombinations);
        }, 1000);
        
        // Lightbox controls
        document.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
        document.getElementById('lightbox').addEventListener('click', (e) => {
            if (e.target.id === 'lightbox') closeLightbox();
        });
        document.getElementById('lightboxPrev').addEventListener('click', () => navigateLightbox(-1));
        document.getElementById('lightboxNext').addEventListener('click', () => navigateLightbox(1));
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (document.getElementById('lightbox').classList.contains('active')) {
                if (e.key === 'Escape') closeLightbox();
                if (e.key === 'ArrowLeft') navigateLightbox(-1);
                if (e.key === 'ArrowRight') navigateLightbox(1);
            }
        });
    });
})();
