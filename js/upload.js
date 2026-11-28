// Upload and parse Excel briefs (.xlsx, .xlsm, .xls) with direct GitHub briefs-inbox/ upload
(function() {
    const GITHUB_OWNER = 'jimtsa80';
    const GITHUB_REPO = 'isieve-briefs';
    const GITHUB_BRANCH = 'main';
    const TOKEN_STORAGE_KEY = 'isieve_github_token';

    let parsedData = null;
    let workbook = null;
    let excelZip = null;
    let selectedFile = null;
    let selectedArrayBuffer = null;
    let isUploadingToGitHub = false;
    let tokenModalResolver = null;
    let actionsState = { status: 'unknown', message: '' };

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

    function updateForgetTokenVisibility() {
        const link = document.getElementById('forgetTokenLink');
        if (!link) return;
        link.style.display = getStoredToken() ? 'inline-block' : 'none';
    }

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        const chunks = [];
        for (let i = 0; i < bytes.length; i += chunkSize) {
            chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
        }
        return btoa(chunks.join(''));
    }

    function encodeBase64Utf8(str) {
        const bytes = new TextEncoder().encode(str);
        return arrayBufferToBase64(bytes.buffer);
    }

    async function checkActionsStatus() {
        const banner = document.getElementById('actionsStatusBanner');
        if (!banner) return;

        try {
            const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/process-briefs.yml/runs?per_page=1&_=${Date.now()}`;
            const res = await fetch(url, { cache: 'no-store', headers: { 'Accept': 'application/vnd.github+json' } });
            if (!res.ok) return;

            const data = await res.json();
            const run = data.workflow_runs && data.workflow_runs[0];
            if (!run) return;

            if (run.conclusion === 'failure') {
                let detail = 'Automatic processing via GitHub Actions is currently failing.';
                try {
                    const jobsRes = await fetch(`${run.jobs_url}?_=${Date.now()}`, { cache: 'no-store', headers: { 'Accept': 'application/vnd.github+json' } });
                    if (jobsRes.ok) {
                        const jobsData = await jobsRes.json();
                        const job = jobsData.jobs && jobsData.jobs[0];
                        if (job && job.steps && job.steps.length === 0) {
                            detail = 'Automatic processing via GitHub Actions is currently paused (GitHub account billing lock).';
                        }
                    }
                } catch (e) {
                    // ignore secondary lookup error
                }

                actionsState = { status: 'locked', message: detail };
                banner.className = 'actions-status-banner edit-status warning';
                banner.innerHTML = `<strong>Queue mode:</strong> ${escapeHtml(detail)} You can still upload <code>.xlsx</code> / <code>.xlsm</code> files to <code>briefs-inbox/</code> here — they will be stored safely in GitHub and processed once GitHub Actions is unlocked (or when processed manually).`;
                banner.style.display = 'block';
            } else if (run.conclusion === 'success') {
                actionsState = { status: 'active', message: 'Automatic processing via GitHub Actions is active.' };
                banner.className = 'actions-status-banner edit-status success';
                banner.innerHTML = `<strong>GitHub Actions active:</strong> Uploaded <code>.xlsx</code> / <code>.xlsm</code> files are automatically processed into the library in ~2–3 minutes.`;
                banner.style.display = 'block';
            }
        } catch (e) {
            // Public check is best-effort
        }
    }

    function init() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('excelFile');

        updateForgetTokenVisibility();
        checkActionsStatus();

        const forgetLink = document.getElementById('forgetTokenLink');
        if (forgetLink) {
            forgetLink.addEventListener('click', () => {
                clearStoredToken();
                updateForgetTokenVisibility();
            });
        }

        // Click to upload
        uploadArea.addEventListener('click', () => fileInput.click());

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFile(files[0]);
            }
        });

        // File input change
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFile(e.target.files[0]);
            }
        });

        // Navigation & actions
        document.getElementById('nextToEdit').addEventListener('click', () => {
            showStep(2);
            populateForm();
        });

        document.getElementById('quickUploadBtn').addEventListener('click', () => {
            uploadToBriefsInbox(false, 'quickUploadStatus', 'quickUploadBtn');
        });

        document.getElementById('backToUpload').addEventListener('click', () => {
            showStep(1);
        });

        document.getElementById('briefForm').addEventListener('submit', (e) => {
            e.preventDefault();
            uploadToBriefsInbox(true, 'githubUploadStatus', 'uploadToGitHubBtn');
        });

        document.getElementById('createZipBtn').addEventListener('click', () => {
            generateBriefPackage();
        });

        // Token modal handlers
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
        document.addEventListener('keydown', (e) => {
            if (tokenModal && tokenModal.classList.contains('active') && e.key === 'Escape') {
                closeTokenModal(null);
            }
        });
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

    async function handleFile(file) {
        if (!file.name.match(/\.(xlsx|xlsm|xls)$/i)) {
            alert('Please select an Excel file (.xlsx, .xlsm, or .xls)');
            return;
        }

        selectedFile = file;
        setStatus('quickUploadStatus', '', '');
        setStatus('githubUploadStatus', '', '');
        showProgress('Reading file...', 10);

        try {
            const data = await readFileAsArrayBuffer(file);
            selectedArrayBuffer = data;

            showProgress('Opening Excel...', 25);

            // Load as ZIP for image extraction (.xlsx and .xlsm are OOXML ZIPs)
            try {
                excelZip = await JSZip.loadAsync(data);
            } catch (zipErr) {
                excelZip = null;
            }

            showProgress('Parsing Excel...', 45);

            workbook = XLSX.read(data, {
                type: 'array',
                cellStyles: true,
                cellNF: true
            });

            showProgress('Extracting data...', 65);
            parsedData = await parseWorkbook(workbook, file.name);

            showProgress('Extracting images...', 85);
            if (excelZip) {
                await extractImages(excelZip, parsedData);
            }

            hideProgress();
            showParseResults();
        } catch (error) {
            console.error('Parse error:', error);
            hideProgress();
            alert('Parse error: ' + error.message);
        }
    }

    function readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    function detectWorkbookLayout(wb) {
        const sheetNames = wb.SheetNames.map(s => s.toLowerCase());
        
        // Layout 1: Tracked Brands + brand sheets (URC2526 style)
        // Note: May or may not have URC sheet - locations come from brand sheets
        if (sheetNames.includes('tracked brands')) {
            return 'tracked_brands';
        }
        
        // Layout 2: Overview + brand sheets
        if (sheetNames.includes('overview')) {
            const overviewSheet = findSheet(wb, ['Overview']);
            if (overviewSheet) {
                const sheet = wb.Sheets[overviewSheet];
                const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
                if (data[0] && String(data[0][0] || '').toLowerCase().includes('brand')) {
                    return 'overview';
                }
            }
        }
        
        // Default: Summary sheet layout
        return 'summary';
    }

    function parseTrackedBrandsLayout(wb) {
        const result = {
            brands: [],
            locations: [],
            combinations: []
        };
        
        // Get brands from Tracked Brands sheet (skip header row)
        const trackedSheet = findSheet(wb, ['Tracked Brands']);
        if (!trackedSheet) return result;
        
        const sheet = wb.Sheets[trackedSheet];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
        const seenBrands = new Set();
        
        // Check if row 0 is a header
        let startRow = 0;
        if (data[0] && data[0][0] && String(data[0][0]).toLowerCase().includes('brand')) {
            startRow = 1;
        }
        
        for (let r = startRow; r < data.length; r++) {
            const brandVal = data[r] && data[r][0];
            if (brandVal) {
                const brandName = normalizeBrandValue(brandVal);
                // Skip header-like values
                if (brandName && !brandName.toLowerCase().match(/^(brand|brands|united rugby championship)$/)) {
                    if (!seenBrands.has(brandName)) {
                        result.brands.push(brandName);
                        seenBrands.add(brandName);
                    }
                }
            }
        }
        
        // Get locations and combinations from brand sheets (not cartesian product)
        const seenLocations = new Set();
        const seenCombos = new Set();
        
        for (const brandName of result.brands) {
            // Try to find brand sheet
            let brandSheet = findSheet(wb, [brandName]);
            if (!brandSheet) {
                // Try fuzzy match
                const brandLower = brandName.toLowerCase().replace(/[-_\s]/g, '');
                for (const sheetName of wb.SheetNames) {
                    const sheetLower = sheetName.toLowerCase().replace(/[-_\s]/g, '');
                    if (brandLower.includes(sheetLower) || sheetLower.includes(brandLower)) {
                        brandSheet = sheetName;
                        break;
                    }
                }
            }
            
            if (!brandSheet) continue;
            
            const bSheet = wb.Sheets[brandSheet];
            const bData = XLSX.utils.sheet_to_json(bSheet, { header: 1, defval: null });
            
            // Extract locations from column A
            for (let r = 0; r < bData.length; r++) {
                const locVal = bData[r] && bData[r][0];
                if (locVal) {
                    const locStr = String(locVal).trim();
                    // Skip numeric values, file names
                    if (locStr.length > 2 && !/^\d+(\.\d+)?$/.test(locStr) && !locStr.includes('_URC_') && !locStr.startsWith('000')) {
                        const locationName = normalizeBrandValue(locVal);
                        if (locationName) {
                            if (!seenLocations.has(locationName)) {
                                result.locations.push(locationName);
                                seenLocations.add(locationName);
                            }
                            
                            // Create combination for this brand + location
                            const comboKey = `${brandName.toLowerCase()}|||${locationName.toLowerCase()}`;
                            if (!seenCombos.has(comboKey)) {
                                seenCombos.add(comboKey);
                                result.combinations.push({
                                    brand: brandName,
                                    location: locationName,
                                    auto_closed: false
                                });
                            }
                        }
                    }
                }
            }
        }
        
        return result;
    }

    function parseOverviewLayout(wb) {
        const result = {
            brands: [],
            locations: [],
            combinations: []
        };
        
        // Get brands from Overview sheet (skip header row)
        const overviewSheet = findSheet(wb, ['Overview']);
        if (!overviewSheet) return result;
        
        const sheet = wb.Sheets[overviewSheet];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
        const seenBrands = new Set();
        
        // Check if row 0 is a header
        let startRow = 0;
        if (data[0] && data[0][0] && String(data[0][0]).toLowerCase().includes('brand')) {
            startRow = 1;
        }
        
        for (let r = startRow; r < data.length; r++) {
            const brandVal = data[r] && data[r][0];
            if (brandVal) {
                const brandName = normalizeBrandValue(brandVal);
                if (brandName && !seenBrands.has(brandName)) {
                    result.brands.push(brandName);
                    seenBrands.add(brandName);
                }
            }
        }
        
        // Get locations from brand sheets
        const seenLocations = new Set();
        const seenCombos = new Set();
        
        const brandSheetNames = wb.SheetNames.filter(s => s.toLowerCase() !== 'overview');
        
        for (const sheetName of brandSheetNames) {
            // Try to match sheet name to a brand
            const sheetLower = sheetName.toLowerCase().replace(/[-_\s]/g, '');
            let matchedBrand = null;
            
            for (const brand of result.brands) {
                const brandLower = brand.toLowerCase().replace(/[-_\s]/g, '');
                if (sheetLower === brandLower || sheetLower.includes(brandLower) || brandLower.includes(sheetLower)) {
                    matchedBrand = brand;
                    break;
                }
            }
            
            // Extract locations from column A
            const sheet = wb.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
            
            for (let r = 0; r < data.length; r++) {
                const locVal = data[r] && data[r][0];
                if (locVal) {
                    const locStr = String(locVal).trim();
                    // Skip numeric values, file names, and very short values
                    if (locStr.length > 2 && !/^\d+(\.\d+)?$/.test(locStr) && !locStr.includes('_URC_') && !locStr.startsWith('000')) {
                        const locationName = normalizeBrandValue(locVal);
                        if (locationName && !seenLocations.has(locationName)) {
                            result.locations.push(locationName);
                            seenLocations.add(locationName);
                        }
                        
                        // Create combination if we matched a brand
                        if (matchedBrand) {
                            const comboKey = `${matchedBrand.toLowerCase()}|||${locationName.toLowerCase()}`;
                            if (!seenCombos.has(comboKey)) {
                                seenCombos.add(comboKey);
                                result.combinations.push({
                                    brand: matchedBrand,
                                    location: locationName,
                                    auto_closed: false
                                });
                            }
                        }
                    }
                }
            }
        }
        
        return result;
    }

    async function parseWorkbook(wb, filename) {
        const data = {
            id: generateId(),
            metadata: {},
            brands: [],
            locations: [],
            combinations: [],
            images: [],
            annotation_images: [],
            rules: ''
        };

        // Detect layout and parse accordingly
        const layout = detectWorkbookLayout(wb);
        
        if (layout === 'tracked_brands') {
            const layoutData = parseTrackedBrandsLayout(wb);
            data.brands = layoutData.brands;
            data.locations = layoutData.locations;
            data.combinations = layoutData.combinations;
        } else if (layout === 'overview') {
            const layoutData = parseOverviewLayout(wb);
            data.brands = layoutData.brands;
            data.locations = layoutData.locations;
            data.combinations = layoutData.combinations;
        } else {
            // Default: Summary sheet layout
            const summarySheet = findSheet(wb, ['Summary', 'SUMMARY']);
            if (summarySheet) {
                const summaryData = parseSummarySheet(wb.Sheets[summarySheet]);
                data.brands = summaryData.brands;
                data.locations = summaryData.locations;
                data.combinations = summaryData.combinations;
            }
        }

        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        data.metadata = extractMetadata(firstSheet);
        // Do NOT infer event from filename - leave empty if not in workbook

        return data;
    }

    function findSheet(wb, names) {
        for (const name of names) {
            const match = wb.SheetNames.find(s => s.trim().toLowerCase() === name.trim().toLowerCase());
            if (match) return match;
        }
        return null;
    }

    function normalizeBrandValue(val) {
        if (val === null || val === undefined || val === '') return '';
        if (typeof val === 'number') {
            return Number.isInteger(val) ? String(Math.round(val)) : String(val);
        }
        return String(val).replace(/\s+/g, ' ').trim();
    }

    function parseSummarySheet(sheet) {
        const result = {
            brands: [],
            locations: [],
            combinations: []
        };

        if (!sheet || !sheet['!ref']) return result;
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
        if (data.length === 0) return result;

        // Detect vertical "Brands | Assets" layout (e.g. Sandown TVGI / Venue / Car Branding)
        for (let r = 0; r < Math.min(10, data.length); r++) {
            const row = data[r] || [];
            let brandsCol = -1;
            let assetsCol = -1;
            for (let c = 0; c < row.length; c++) {
                const cell = String(row[c] || '').trim().toLowerCase();
                if (cell === 'brands' || cell === 'brand') brandsCol = c;
                if (cell === 'assets' || cell === 'asset' || cell === 'locations' || cell === 'location') assetsCol = c;
            }
            if (brandsCol >= 0 && assetsCol >= 0) {
                const seenBrands = new Set();
                const seenLocations = new Set();
                const seenCombos = new Set();

                for (let rr = r + 1; rr < data.length; rr++) {
                    const rData = data[rr] || [];
                    const brandName = normalizeBrandValue(rData[brandsCol]);
                    const assetName = normalizeBrandValue(rData[assetsCol]);
                    if (!brandName || !assetName) continue;
                    if (brandName.match(/^(total|sum|grand|template)$/i)) continue;

                    if (!seenBrands.has(brandName)) {
                        seenBrands.add(brandName);
                        result.brands.push(brandName);
                    }
                    if (!seenLocations.has(assetName)) {
                        seenLocations.add(assetName);
                        result.locations.push(assetName);
                    }
                    const comboKey = `${brandName.toLowerCase()}|||${assetName.toLowerCase()}`;
                    if (!seenCombos.has(comboKey)) {
                        seenCombos.add(comboKey);
                        result.combinations.push({
                            brand: brandName,
                            location: assetName,
                            auto_closed: false
                        });
                    }
                }
                return result;
            }
        }

        // Fallback: Matrix layout (Brand | Loc1 | Loc2 ...)
        let headerRow = -1;
        let brandCol = -1;
        const locationCols = [];

        for (let r = 0; r < Math.min(15, data.length); r++) {
            const row = data[r] || [];
            for (let c = 0; c < row.length; c++) {
                const cell = String(row[c] || '').toLowerCase();
                if (cell.match(/brand|marca/)) {
                    headerRow = r;
                    brandCol = c;

                    for (let lc = c + 1; lc < row.length; lc++) {
                        const headerValue = String(row[lc] || '').trim();
                        if (headerValue &&
                            headerValue.toLowerCase() !== 'none' &&
                            !headerValue.match(/total|sum|grand/i)) {
                            locationCols.push({ col: lc, name: headerValue });
                        }
                    }
                    break;
                }
            }
            if (headerRow >= 0) break;
        }

        if (headerRow < 0 || brandCol < 0) {
            return result;
        }

        result.locations = locationCols.map(lc => lc.name);

        const seenBrands = new Set();
        const seenCombos = new Set();

        for (let r = headerRow + 1; r < data.length; r++) {
            const row = data[r] || [];
            const brandName = normalizeBrandValue(row[brandCol]);

            if (!brandName || brandName.match(/total|sum|grand|template/i)) {
                continue;
            }

            if (!seenBrands.has(brandName)) {
                result.brands.push(brandName);
                seenBrands.add(brandName);
            }

            locationCols.forEach(loc => {
                const cellValue = row[loc.col];
                const cellStr = String(cellValue || '').trim();

                if (cellStr &&
                    cellStr.toLowerCase() !== 'none' &&
                    !cellStr.match(/^0+$/)) {
                    const comboKey = `${brandName.toLowerCase()}|||${loc.name.toLowerCase()}`;
                    if (!seenCombos.has(comboKey)) {
                        seenCombos.add(comboKey);
                        result.combinations.push({
                            brand: brandName,
                            location: loc.name,
                            auto_closed: false
                        });
                    }
                }
            });
        }

        return result;
    }

    function extractMetadata(sheet) {
        const metadata = {
            client: '',
            event: '',
            competition: '',
            sport: '',
            footage_clips: '',
            date_start: null,
            date_end: null
        };

        if (!sheet || !sheet['!ref']) return metadata;
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

        for (let r = 0; r < Math.min(20, data.length); r++) {
            const row = data[r] || [];
            if (row.length < 2) continue;

            const label = String(row[0] || '').toLowerCase();
            const value = String(row[1] || '').trim();

            if (!value || value.toLowerCase() === 'none') continue;

            if (label.match(/client|πελάτ/)) {
                metadata.client = value;
            } else if (label.match(/event|εκδήλωση/)) {
                metadata.event = value;
            } else if (label.match(/competition|διοργάνωση/)) {
                metadata.competition = value;
            } else if (label.match(/sport|άθλημα/)) {
                metadata.sport = value;
            } else if (label.match(/footage|clip/i)) {
                metadata.footage_clips = value;
            } else if (label.match(/date|ημερομηνία/)) {
                try {
                    const date = XLSX.SSF.parse_date_code(row[1]);
                    if (date) {
                        metadata.date_start = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
                    } else {
                        metadata.date_start = value;
                    }
                } catch (e) {
                    metadata.date_start = value;
                }
            }
        }

        return metadata;
    }

    async function extractImages(zip, data) {
        const images = [];
        const annotationImages = [];

        try {
            const mediaFolder = zip.folder('xl/media');
            if (!mediaFolder) return;

            const imageFiles = [];
            mediaFolder.forEach((relativePath, file) => {
                if (!file.dir && relativePath.match(/\.(png|jpg|jpeg|gif|bmp)$/i)) {
                    imageFiles.push({ path: relativePath, file: file });
                }
            });

            for (let i = 0; i < imageFiles.length; i++) {
                const { path, file } = imageFiles[i];

                try {
                    const imageData = await file.async('base64');
                    const extension = path.split('.').pop().toLowerCase();
                    const filename = `image_${i}.${extension}`;
                    const sheetHint = await guessImageSheet(zip, path);

                    const imageInfo = {
                        filename: filename,
                        dataUrl: `data:image/${extension};base64,${imageData}`,
                        original_path: path
                    };

                    if (sheetHint && sheetHint.toLowerCase().match(/annotation|rule|κανόν/)) {
                        annotationImages.push({
                            ...imageInfo,
                            type: 'annotation',
                            annotation_type: 'include',
                            sort_order: annotationImages.length
                        });
                    } else {
                        images.push({
                            ...imageInfo,
                            type: 'example',
                            brand: sheetHint || null,
                            location: null,
                            sort_order: images.length
                        });
                    }
                } catch (err) {
                    console.error(`Error extracting image ${path}:`, err);
                }
            }

            data.images = images;
            data.annotation_images = annotationImages;
        } catch (error) {
            console.error('Error extracting images:', error);
        }
    }

    async function guessImageSheet(zip, imagePath) {
        try {
            const drawingsFolder = zip.folder('xl/drawings/_rels');
            if (!drawingsFolder) return null;

            const imageName = imagePath.split('/').pop();

            for (const [relPath, file] of Object.entries(drawingsFolder.files)) {
                if (relPath.endsWith('.rels')) {
                    const relsContent = await file.async('string');
                    if (relsContent.includes(imageName)) {
                        const match = relPath.match(/drawing(\d+)\.xml\.rels/);
                        if (match) {
                            return `Sheet_${match[1]}`;
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Error guessing image sheet:', err);
        }

        return null;
    }

    function showProgress(message, percent) {
        document.getElementById('uploadProgress').style.display = 'block';
        document.getElementById('progressText').textContent = message;
        document.getElementById('progressFill').style.width = `${percent}%`;
    }

    function hideProgress() {
        document.getElementById('uploadProgress').style.display = 'none';
    }

    function setStatus(elementId, message, type) {
        const el = document.getElementById(elementId);
        if (!el) return;
        if (!message) {
            el.style.display = 'none';
            el.textContent = '';
            el.className = 'edit-status';
            return;
        }
        el.textContent = message;
        el.className = `edit-status ${type || 'info'}`;
        el.style.display = 'block';
    }

    function showParseResults() {
        document.getElementById('parseResults').style.display = 'block';

        const warnings = [];
        const errors = [];
        if (parsedData.brands.length === 0) {
            errors.push('❌ <strong>Error: No brands found.</strong> The brief cannot be created without brands. Please check that the Summary sheet exists and the Brand_Assets table (B2:E...) has brand names in Column B and asset/location names in Column C.');
        }
        if (parsedData.images.length === 0 && parsedData.annotation_images.length === 0) {
            warnings.push('⚠️ No embedded images detected in browser preview.');
        }

        const sizeMb = selectedFile ? (selectedFile.size / (1024 * 1024)).toFixed(2) : '0';

        document.getElementById('parseInfo').innerHTML = `
            <p><strong>File:</strong> ${escapeHtml(selectedFile ? selectedFile.name : '')} (${sizeMb} MB)</p>
            <p><strong>Brands:</strong> ${parsedData.brands.length}</p>
            <p><strong>Locations:</strong> ${parsedData.locations.length}</p>
            <p><strong>Combinations:</strong> ${parsedData.combinations.length}</p>
            <p><strong>Embedded media files:</strong> ${parsedData.images.length + parsedData.annotation_images.length}</p>
            ${errors.length > 0 ? `<div class="edit-status error" style="margin-top: 1rem; text-align: left;">${errors.join('<br>')}</div>` : ''}
            ${warnings.length > 0 ? `<div class="text-muted" style="margin-top: 1rem;">${warnings.join('<br>')}</div>` : ''}
        `;
    }

    function showStep(stepNumber) {
        document.querySelectorAll('.wizard-step').forEach((step, index) => {
            step.classList.toggle('active', index + 1 === stepNumber);
        });
    }

    function populateForm() {
        document.getElementById('client').value = parsedData.metadata.client || '';
        document.getElementById('event').value = parsedData.metadata.event || '';
        document.getElementById('competition').value = parsedData.metadata.competition || '';
        document.getElementById('sport').value = parsedData.metadata.sport || '';
        document.getElementById('footage_clips').value = parsedData.metadata.footage_clips || '';
        document.getElementById('date_start').value = parsedData.metadata.date_start || '';
        document.getElementById('date_end').value = parsedData.metadata.date_end || '';
        document.getElementById('notes').value = '';

        document.getElementById('brandCount').textContent = parsedData.brands.length;
        document.getElementById('locationCount').textContent = parsedData.locations.length;
        document.getElementById('comboCount').textContent = parsedData.combinations.length;
        document.getElementById('imageCount').textContent = parsedData.images.length + parsedData.annotation_images.length;

        const preview = document.getElementById('brandsLocationsPreview');
        preview.innerHTML = `
            <details style="margin-bottom: 1rem;">
                <summary style="cursor: pointer; font-weight: 500; margin-bottom: 0.5rem;">Brands (${parsedData.brands.length})</summary>
                <div style="padding: 0.5rem; background: var(--bg-tertiary); border-radius: 6px; max-height: 200px; overflow-y: auto;">
                    ${parsedData.brands.map(b => `<span style="display: inline-block; margin: 0.25rem; padding: 0.25rem 0.5rem; background: var(--bg); border-radius: 4px;">${escapeHtml(b)}</span>`).join('')}
                </div>
            </details>

            <details>
                <summary style="cursor: pointer; font-weight: 500; margin-bottom: 0.5rem;">Locations (${parsedData.locations.length})</summary>
                <div style="padding: 0.5rem; background: var(--bg-tertiary); border-radius: 6px; max-height: 200px; overflow-y: auto;">
                    ${parsedData.locations.map(l => `<span style="display: inline-block; margin: 0.25rem; padding: 0.25rem 0.5rem; background: var(--bg); border-radius: 4px;">${escapeHtml(l)}</span>`).join('')}
                </div>
            </details>
        `;

        const imagesPreview = document.getElementById('imagesPreview');
        const allImages = [...parsedData.images, ...parsedData.annotation_images];

        if (allImages.length > 0) {
            imagesPreview.innerHTML = allImages.slice(0, 20).map(img => `
                <div class="preview-image" title="${escapeHtml(img.filename)}">
                    <img src="${img.dataUrl}" alt="${escapeHtml(img.filename)}">
                </div>
            `).join('');

            if (allImages.length > 20) {
                imagesPreview.innerHTML += `<div class="text-muted" style="grid-column: 1/-1; text-align: center;">...and ${allImages.length - 20} more</div>`;
            }
        } else {
            imagesPreview.innerHTML = '<div class="text-muted">No images extracted</div>';
        }
    }

    function sanitizeInboxFilename(name) {
        return name.replace(/[\\/?#%*:|"<>]+/g, '_').replace(/\s+/g, '_');
    }

    function buildSidecarTxtFromForm() {
        const form = document.getElementById('briefForm');
        if (!form) return '';
        const fd = new FormData(form);
        const lines = [];

        const client = String(fd.get('client') || '').trim();
        const event = String(fd.get('event') || '').trim();
        const competition = String(fd.get('competition') || '').trim();
        const sport = String(fd.get('sport') || '').trim();
        const dateStart = String(fd.get('date_start') || '').trim();
        const dateEnd = String(fd.get('date_end') || '').trim();
        const notes = String(fd.get('notes') || '').replace(/\r?\n+/g, ' ').trim();

        if (client) lines.push(`client: ${client}`);
        if (event) lines.push(`event: ${event}`);
        if (competition) lines.push(`competition: ${competition}`);
        if (sport) lines.push(`sport: ${sport}`);
        if (dateStart && dateEnd) {
            lines.push(`dates: ${dateStart} to ${dateEnd}`);
        } else if (dateStart) {
            lines.push(`date_start: ${dateStart}`);
        }
        if (notes) lines.push(`notes: ${notes}`);

        return lines.join('\n') + (lines.length ? '\n' : '');
    }

    async function githubGetExistingSha(path, token) {
        const encodedPath = path.split('/').map(encodeURIComponent).join('/');
        const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}?ref=${encodeURIComponent(GITHUB_BRANCH)}&_=${Date.now()}`;
        const res = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`
            }
        });
        if (res.status === 404) {
            return null;
        }
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const err = new Error(errBody.message || `GitHub GET ${path} failed (${res.status})`);
            err.status = res.status;
            throw err;
        }
        const data = await res.json();
        return data.sha || null;
    }

    async function githubPutFileBase64(path, token, message, base64Content, sha) {
        const encodedPath = path.split('/').map(encodeURIComponent).join('/');
        const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}`;
        const body = {
            message,
            content: base64Content,
            branch: GITHUB_BRANCH
        };
        if (sha) {
            body.sha = sha;
        }
        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const err = new Error(errBody.message || `GitHub PUT ${path} failed (${res.status})`);
            err.status = res.status;
            throw err;
        }
        return await res.json();
    }

    async function githubApiJson(apiPath, token, options) {
        const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${apiPath}`;
        const opts = Object.assign({}, options || {});
        opts.headers = Object.assign({
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`
        }, opts.headers || {});
        if (opts.body && !opts.headers['Content-Type']) {
            opts.headers['Content-Type'] = 'application/json';
        }
        const res = await fetch(url, opts);
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const err = new Error(errBody.message || `GitHub API ${opts.method || 'GET'} ${apiPath} failed (${res.status})`);
            err.status = res.status;
            throw err;
        }
        return await res.json();
    }

    function isNonFastForwardError(err) {
        if (!err) return false;
        if (err.status === 409) return true;
        if (err.status === 422 && /fast forward|update|reference|sha|conflict/i.test(err.message || '')) return true;
        return false;
    }

    async function commitInboxFilesAtomic(filesToCommit, token, commitMessage) {
        const uploadedBlobs = [];
        for (const f of filesToCommit) {
            const blob = await githubApiJson('/git/blobs', token, {
                method: 'POST',
                body: JSON.stringify({
                    content: f.base64Content,
                    encoding: 'base64'
                })
            });
            uploadedBlobs.push({
                path: f.path,
                mode: '100644',
                type: 'blob',
                sha: blob.sha
            });
        }

        let attempts = 0;
        while (attempts < 2) {
            attempts += 1;
            const refData = await githubApiJson(
                `/git/ref/heads/${encodeURIComponent(GITHUB_BRANCH)}?_=${Date.now()}`,
                token,
                { method: 'GET', cache: 'no-store' }
            );
            const headSha = refData.object.sha;

            const commitData = await githubApiJson(
                `/git/commits/${headSha}?_=${Date.now()}`,
                token,
                { method: 'GET', cache: 'no-store' }
            );
            const baseTreeSha = commitData.tree.sha;

            const newTree = await githubApiJson('/git/trees', token, {
                method: 'POST',
                body: JSON.stringify({
                    base_tree: baseTreeSha,
                    tree: uploadedBlobs
                })
            });

            const newCommit = await githubApiJson('/git/commits', token, {
                method: 'POST',
                body: JSON.stringify({
                    message: commitMessage,
                    tree: newTree.sha,
                    parents: [headSha]
                })
            });

            try {
                await githubApiJson(`/git/refs/heads/${encodeURIComponent(GITHUB_BRANCH)}`, token, {
                    method: 'PATCH',
                    body: JSON.stringify({
                        sha: newCommit.sha,
                        force: false
                    })
                });
                return newCommit;
            } catch (err) {
                if (isNonFastForwardError(err) && attempts < 2) {
                    continue;
                }
                throw err;
            }
        }
    }

    async function compressExcelImages(arrayBuffer, originalFilename) {
        try {
            const zip = await JSZip.loadAsync(arrayBuffer);
            let compressionNeeded = false;
            const compressionPromises = [];
            
            // Find all images in xl/media/
            const mediaFiles = Object.keys(zip.files).filter(name => 
                name.startsWith('xl/media/') && /\.(png|jpg|jpeg|gif|bmp)$/i.test(name)
            );
            
            if (mediaFiles.length === 0) {
                // No images to compress
                return { compressed: false, blob: new Blob([arrayBuffer]) };
            }
            
            for (const mediaPath of mediaFiles) {
                compressionPromises.push((async () => {
                    const file = zip.files[mediaPath];
                    const imgData = await file.async('arraybuffer');
                    
                    // Skip tiny images (< 10 KB)
                    if (imgData.byteLength < 10 * 1024) {
                        return null;
                    }
                    
                    // Load image to check dimensions
                    const blob = new Blob([imgData]);
                    const url = URL.createObjectURL(blob);
                    
                    return new Promise((resolve) => {
                        const img = new Image();
                        img.onload = async () => {
                            URL.revokeObjectURL(url);
                            
                            const maxSize = 1600;
                            let { width, height } = img;
                            
                            // Skip if already small
                            if (width <= maxSize && height <= maxSize && imgData.byteLength < 200 * 1024) {
                                resolve(null);
                                return;
                            }
                            
                            // Calculate new dimensions
                            if (width > maxSize || height > maxSize) {
                                if (width > height) {
                                    height = Math.round((height * maxSize) / width);
                                    width = maxSize;
                                } else {
                                    width = Math.round((width * maxSize) / height);
                                    height = maxSize;
                                }
                            }
                            
                            // Compress via canvas
                            const canvas = document.createElement('canvas');
                            canvas.width = width;
                            canvas.height = height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, width, height);
                            
                            canvas.toBlob((compressedBlob) => {
                                if (compressedBlob && compressedBlob.size < imgData.byteLength) {
                                    compressionNeeded = true;
                                    resolve({ path: mediaPath, blob: compressedBlob });
                                } else {
                                    resolve(null);
                                }
                            }, 'image/jpeg', 0.8);
                        };
                        img.onerror = () => {
                            URL.revokeObjectURL(url);
                            resolve(null);
                        };
                        img.src = url;
                    });
                })());
            }
            
            const results = await Promise.all(compressionPromises);
            
            // Replace compressed images in zip
            for (const result of results) {
                if (result) {
                    const arrayBuf = await result.blob.arrayBuffer();
                    zip.file(result.path, arrayBuf);
                }
            }
            
            if (!compressionNeeded) {
                return { compressed: false, blob: new Blob([arrayBuffer]) };
            }
            
            // Generate new Excel file
            const compressedArrayBuffer = await zip.generateAsync({ 
                type: 'arraybuffer',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });
            
            return { 
                compressed: true, 
                blob: new Blob([compressedArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                originalSize: arrayBuffer.byteLength,
                compressedSize: compressedArrayBuffer.byteLength
            };
        } catch (error) {
            console.error('Image compression failed:', error);
            return { compressed: false, blob: new Blob([arrayBuffer]), error: error.message };
        }
    }

    async function uploadToBriefsInbox(includeSidecar, statusElId, triggerBtnId) {
        if (isUploadingToGitHub || !selectedFile || !selectedArrayBuffer) return;

        // Validate: fail if no brands found
        if (!parsedData || parsedData.brands.length === 0) {
            setStatus(statusElId, 'Error: Cannot upload brief with 0 brands. The Excel file must contain brands in the Summary sheet (Brand_Assets table at B2:E...). Please check that Column B contains brand names and Column C contains asset/location names.', 'error');
            return;
        }

        // Try to compress images if file is large
        let fileToUpload = selectedFile;
        let arrayBufferToUpload = selectedArrayBuffer;
        
        if (selectedFile.size > 30 * 1024 * 1024) {
            setStatus(statusElId, 'Large file detected, compressing images...', 'info');
            const compressionResult = await compressExcelImages(selectedArrayBuffer, selectedFile.name);
            
            if (compressionResult.compressed) {
                fileToUpload = new File([compressionResult.blob], selectedFile.name, { type: selectedFile.type });
                arrayBufferToUpload = await compressionResult.blob.arrayBuffer();
                const savedMB = ((compressionResult.originalSize - compressionResult.compressedSize) / (1024 * 1024)).toFixed(1);
                setStatus(statusElId, `Compressed from ${(compressionResult.originalSize / (1024 * 1024)).toFixed(1)} MB to ${(compressionResult.compressedSize / (1024 * 1024)).toFixed(1)} MB (saved ${savedMB} MB)`, 'info');
            } else if (compressionResult.error) {
                console.warn('Compression failed, uploading original:', compressionResult.error);
            }
        }

        if (fileToUpload.size > 45 * 1024 * 1024) {
            setStatus(
                statusElId,
                'This file exceeds 45 MB even after image compression. Please upload it directly via git or GitHub web UI into briefs-inbox/.',
                'error'
            );
            return;
        }

        let token = getStoredToken();
        if (!token) {
            token = await requestTokenFromUser('');
            if (!token) {
                setStatus(statusElId, 'Upload cancelled: GitHub token is required to commit to briefs-inbox/.', 'info');
                return;
            }
            setStoredToken(token);
            updateForgetTokenVisibility();
        }

        const safeName = sanitizeInboxFilename(selectedFile.name);
        const inboxFilePath = `briefs-inbox/${safeName}`;
        const stem = safeName.replace(/\.(xlsx|xlsm|xls)$/i, '');
        const sidecarText = includeSidecar ? buildSidecarTxtFromForm() : '';
        const sidecarPath = sidecarText ? `briefs-inbox/${stem}.txt` : null;

        isUploadingToGitHub = true;
        const triggerBtn = document.getElementById(triggerBtnId);
        const origBtnText = triggerBtn ? triggerBtn.textContent : '';
        if (triggerBtn) {
            triggerBtn.disabled = true;
            triggerBtn.textContent = 'Uploading to GitHub...';
        }
        setStatus(statusElId, `Uploading ${safeName} to ${inboxFilePath}...`, 'info');

        try {
            const fileB64 = arrayBufferToBase64(arrayBufferToUpload);
            const filesToCommit = [];
            if (sidecarPath) {
                filesToCommit.push({
                    path: sidecarPath,
                    base64Content: encodeBase64Utf8(sidecarText)
                });
            }
            filesToCommit.push({
                path: inboxFilePath,
                base64Content: fileB64
            });

            let attempts = 0;
            while (attempts < 2) {
                attempts += 1;
                try {
                    const commitMsg = sidecarPath
                        ? `Upload brief + metadata to inbox: ${safeName}`
                        : `Upload brief to inbox: ${safeName}`;
                    const commit = await commitInboxFilesAtomic(filesToCommit, token, commitMsg);
                    const commitUrl = commit && commit.sha
                        ? `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/commit/${commit.sha}`
                        : null;
                    renderInboxUploadSuccess(filesToCommit.map(f => f.path), commitUrl);
                    showStep(3);
                    return;
                } catch (err) {
                    if ((err.status === 401 || err.status === 403) && attempts < 2) {
                        clearStoredToken();
                        updateForgetTokenVisibility();
                        const retryToken = await requestTokenFromUser('Token rejected by GitHub (401/403). Enter a valid token with Contents: Read and write.');
                        if (!retryToken) {
                            setStatus(statusElId, 'Upload cancelled: valid GitHub token required.', 'error');
                            return;
                        }
                        token = retryToken;
                        setStoredToken(token);
                        updateForgetTokenVisibility();
                        continue;
                    }
                    throw err;
                }
            }
        } catch (err) {
            setStatus(statusElId, `GitHub upload failed: ${err.message}`, 'error');
        } finally {
            isUploadingToGitHub = false;
            if (triggerBtn) {
                triggerBtn.disabled = false;
                triggerBtn.textContent = origBtnText;
            }
        }
    }

    function renderInboxUploadSuccess(committedFiles, commitUrl) {
        const container = document.getElementById('step3Content');
        const isLocked = actionsState.status === 'locked';
        const isActive = actionsState.status === 'active';

        const statusNote = isLocked
            ? `<div class="edit-status warning" style="text-align: left; margin: 1.25rem 0;">
                    <strong>Queued for processing (not yet live in the library):</strong><br>
                    ${escapeHtml(actionsState.message)} The file is safely committed in <code>briefs-inbox/</code> and will be extracted into the library once GitHub Actions is unlocked or when processed manually.
               </div>`
            : isActive
                ? `<div class="edit-status success" style="text-align: left; margin: 1.25rem 0;">
                        <strong>GitHub Actions triggered:</strong> Automatic processing usually completes in 2–3 minutes.
                   </div>`
                : `<div class="edit-status info" style="text-align: left; margin: 1.25rem 0;">
                        <strong>Saved in <code>briefs-inbox/</code>:</strong> Processing runs automatically when GitHub Actions is available (check the <a href="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions" target="_blank">Actions tab</a>).
                   </div>`;

        container.innerHTML = `
            <div class="success-icon">✓</div>
            <h2>Uploaded to GitHub (<code>briefs-inbox/</code>)</h2>
            <p class="instructions">Committed to <code>${GITHUB_OWNER}/${GITHUB_REPO}</code> (${GITHUB_BRANCH}):</p>
            <div class="github-instructions" style="text-align: left;">
                <ul>
                    ${committedFiles.map(f => `<li><code>${escapeHtml(f)}</code></li>`).join('')}
                </ul>
                ${commitUrl ? `<p style="margin-top: 0.75rem;"><a href="${escapeHtml(commitUrl)}" target="_blank">View commit on GitHub &rarr;</a></p>` : ''}
            </div>
            ${statusNote}
            <div class="success-actions">
                <a href="index.html" class="btn btn-secondary">Back to library</a>
                <button type="button" id="uploadAnother" class="btn btn-primary">Upload another Brief</button>
            </div>
        `;

        const anotherBtn = document.getElementById('uploadAnother');
        if (anotherBtn) {
            anotherBtn.addEventListener('click', () => location.reload());
        }
    }

    async function generateBriefPackage() {
        // Validate: fail if no brands found
        if (!parsedData || parsedData.brands.length === 0) {
            setMessage('zipStatus', 'Error: Cannot create brief with 0 brands. The Excel file must contain brands in the Summary sheet (Brand_Assets table at B2:E...). Please check that Column B contains brand names and Column C contains asset/location names.', 'error');
            return;
        }

        const formData = new FormData(document.getElementById('briefForm'));

        const briefData = {
            id: parsedData.id,
            client: formData.get('client') || '',
            event: formData.get('event') || (selectedFile ? selectedFile.name : parsedData.id),
            competition: formData.get('competition') || null,
            sport: formData.get('sport') || null,
            footage_clips: formData.get('footage_clips') || null,
            date_start: formData.get('date_start') || null,
            date_end: formData.get('date_end') || null,
            notes: formData.get('notes') || null,
            brands: parsedData.brands,
            locations: parsedData.locations,
            combinations: parsedData.combinations,
            images: parsedData.images.map(img => ({
                type: img.type,
                filename: img.filename,
                brand: img.brand,
                location: img.location,
                sort_order: img.sort_order
            })),
            annotation_images: parsedData.annotation_images.map(img => ({
                type: img.type,
                filename: img.filename,
                annotation_type: img.annotation_type,
                sort_order: img.sort_order
            })),
            created_at: new Date().toISOString()
        };

        const zip = new JSZip();
        const folder = zip.folder(briefData.id);
        folder.file('brief.json', JSON.stringify(briefData, null, 2));

        const allImages = [...parsedData.images, ...parsedData.annotation_images];
        for (const img of allImages) {
            if (img.dataUrl) {
                const base64Data = img.dataUrl.split(',')[1];
                folder.file(img.filename, base64Data, { base64: true });
            }
        }

        folder.file('README.txt', `
Brief Package: ${briefData.event}
Client: ${briefData.client}
Created: ${new Date().toLocaleString('en-US')}

This folder contains:
- brief.json: The brief data
- ${allImages.length} images

To add this brief to the library:
1. Extract this archive
2. Upload the folder "${briefData.id}" to the briefs/ folder of the repository
3. Run: python scripts/rebuild_index.py
4. Commit the changes
        `.trim());

        window.briefPackage = { zip, briefData };

        const container = document.getElementById('step3Content');
        const actionsNote = actionsState.status === 'locked'
            ? `<div class="edit-status warning" style="text-align: left; margin-top: 1rem;">
                    <strong>Note:</strong> ${escapeHtml(actionsState.message)} If you upload to <code>briefs/</code> manually, also run <code>python scripts/rebuild_index.py</code> locally or wait until Actions is unlocked.
               </div>`
            : '';

        container.innerHTML = `
            <div class="success-icon">✓</div>
            <h2>Brief Package is ready!</h2>
            <p class="instructions">Download the archive below to add it manually to the repository:</p>
            <div class="download-section">
                <button type="button" id="downloadPackage" class="btn btn-primary btn-large">
                    ⬇ Download Brief Package (.zip)
                </button>
            </div>
            <div class="github-instructions">
                <h3>Manual Repository Instructions:</h3>
                <ol>
                    <li>Extract the <code>.zip</code> file</li>
                    <li>Add the extracted folder into <code>briefs/</code> in <a href="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}" target="_blank">${GITHUB_OWNER}/${GITHUB_REPO}</a></li>
                    <li>Rebuild <code>briefs/index.json</code> (via <code>python scripts/rebuild_index.py</code> or GitHub Actions when active)</li>
                </ol>
                ${actionsNote}
            </div>
            <div class="success-actions">
                <a href="index.html" class="btn btn-secondary">Back to library</a>
                <button type="button" id="uploadAnother" class="btn btn-primary">Upload another Brief</button>
            </div>
        `;

        showStep(3);

        document.getElementById('downloadPackage').onclick = async () => {
            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `brief-${briefData.id}.zip`;
            a.click();
            URL.revokeObjectURL(url);
        };

        const anotherBtn = document.getElementById('uploadAnother');
        if (anotherBtn) {
            anotherBtn.addEventListener('click', () => location.reload());
        }
    }

    function generateId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 7);
        return `${timestamp}-${random}`;
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    document.addEventListener('DOMContentLoaded', init);
})();
