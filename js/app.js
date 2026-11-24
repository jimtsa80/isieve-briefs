// Main library app
(function() {
    let allBriefs = [];
    let filters = {
        sports: new Set(),
        clients: new Set()
    };

    // Load all briefs from briefs/ directory
    async function loadBriefs() {
        try {
            const response = await fetch('briefs/index.json');
            if (!response.ok) {
                throw new Error('Failed to load briefs index');
            }
            
            allBriefs = await response.json();
            
            // Extract filter options
            allBriefs.forEach(brief => {
                if (brief.sport) filters.sports.add(brief.sport);
                if (brief.client) filters.clients.add(brief.client);
            });
            
            populateFilters();
            renderBriefs(allBriefs);
            
        } catch (error) {
            console.error('Error loading briefs:', error);
            document.getElementById('briefsContainer').innerHTML = `
                <div class="error-message">
                    <strong>Loading error:</strong> 
                    ${error.message}
                    <br><br>
                    <small>Make sure the briefs/index.json file exists</small>
                </div>
            `;
        }
    }

    function populateFilters() {
        const sportFilter = document.getElementById('filterSport');
        const clientFilter = document.getElementById('filterClient');
        
        // Add sport options
        Array.from(filters.sports).sort().forEach(sport => {
            const option = document.createElement('option');
            option.value = sport;
            option.textContent = sport;
            sportFilter.appendChild(option);
        });
        
        // Add client options
        Array.from(filters.clients).sort().forEach(client => {
            const option = document.createElement('option');
            option.value = client;
            option.textContent = client;
            clientFilter.appendChild(option);
        });
    }

    function renderBriefs(briefs) {
        const container = document.getElementById('briefsContainer');
        
        if (briefs.length === 0) {
            container.innerHTML = '<div class="loading">No briefs found</div>';
            return;
        }
        
        container.innerHTML = briefs.map(brief => `
            <a href="brief.html?id=${encodeURIComponent(brief.id)}" class="brief-card">
                <div class="brief-card-header">
                    <div class="brief-card-title">${escapeHtml(brief.event)}</div>
                    <div class="brief-card-client">${escapeHtml(brief.client)}</div>
                </div>
                
                <div class="brief-card-meta">
                    ${brief.sport ? `<span class="meta-tag">🏃 ${escapeHtml(brief.sport)}</span>` : ''}
                    ${brief.date_start ? `<span class="meta-tag">📅 ${formatDate(brief.date_start)}</span>` : ''}
                </div>
                
                <div class="brief-card-stats">
                    <div class="stat">
                        <strong>${brief.brand_count || 0}</strong> brands
                    </div>
                    <div class="stat">
                        <strong>${brief.location_count || 0}</strong> locations
                    </div>
                    <div class="stat">
                        <strong>${brief.combination_count || 0}</strong> combos
                    </div>
                </div>
            </a>
        `).join('');
    }

    function filterBriefs() {
        const searchTerm = document.getElementById('globalSearch').value.toLowerCase();
        const sportFilter = document.getElementById('filterSport').value;
        const clientFilter = document.getElementById('filterClient').value;
        const dateFrom = document.getElementById('filterDateFrom').value;
        const dateTo = document.getElementById('filterDateTo').value;
        
        let filtered = allBriefs.filter(brief => {
            // Search filter
            if (searchTerm) {
                const searchable = [
                    brief.event,
                    brief.client,
                    brief.sport,
                    brief.competition,
                    ...(brief.brands || []),
                    ...(brief.locations || [])
                ].filter(Boolean).join(' ').toLowerCase();
                
                if (!searchable.includes(searchTerm)) {
                    return false;
                }
            }
            
            // Sport filter
            if (sportFilter && brief.sport !== sportFilter) {
                return false;
            }
            
            // Client filter
            if (clientFilter && brief.client !== clientFilter) {
                return false;
            }
            
            // Date filters
            if (dateFrom && brief.date_start && brief.date_start < dateFrom) {
                return false;
            }
            
            if (dateTo && brief.date_end && brief.date_end > dateTo) {
                return false;
            }
            
            return true;
        });
        
        renderBriefs(filtered);
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

    // Event listeners
    document.addEventListener('DOMContentLoaded', () => {
        loadBriefs();
        
        document.getElementById('globalSearch').addEventListener('input', filterBriefs);
        document.getElementById('filterSport').addEventListener('change', filterBriefs);
        document.getElementById('filterClient').addEventListener('change', filterBriefs);
        document.getElementById('filterDateFrom').addEventListener('change', filterBriefs);
        document.getElementById('filterDateTo').addEventListener('change', filterBriefs);
        
        document.getElementById('clearFilters').addEventListener('click', () => {
            document.getElementById('globalSearch').value = '';
            document.getElementById('filterSport').value = '';
            document.getElementById('filterClient').value = '';
            document.getElementById('filterDateFrom').value = '';
            document.getElementById('filterDateTo').value = '';
            filterBriefs();
        });
    });
})();
