// Upload and parse Excel briefs with image extraction
(function() {
    let parsedData = null;
    let workbook = null;
    let excelZip = null;

    function init() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('excelFile');
        
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
        
        // Form navigation
        document.getElementById('nextToEdit').addEventListener('click', () => {
            showStep(2);
            populateForm();
        });
        
        document.getElementById('backToUpload').addEventListener('click', () => {
            showStep(1);
        });
        
        document.getElementById('briefForm').addEventListener('submit', (e) => {
            e.preventDefault();
            generateBriefPackage();
        });
        
        document.getElementById('uploadAnother').addEventListener('click', () => {
            location.reload();
        });
    }

    async function handleFile(file) {
        if (!file.name.match(/\.(xlsx|xls)$/i)) {
            alert('Please select an Excel file (.xlsx or .xls)');
            return;
        }
        
        showProgress('Reading file...', 10);
        
        try {
            const data = await readFileAsArrayBuffer(file);
            
            showProgress('Άνοιγμα Excel...', 20);
            
            // Load as ZIP for image extraction
            excelZip = await JSZip.loadAsync(data);
            
            showProgress('Parsing Excel...', 40);
            
            // Also load with SheetJS for data
            workbook = XLSX.read(data, { 
                type: 'array',
                cellStyles: true,
                cellNF: true
            });
            
            showProgress('Extracting data...', 60);
            parsedData = await parseWorkbook(workbook);
            
            showProgress('Extracting images...', 80);
            await extractImages(excelZip, parsedData);
            
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

    async function parseWorkbook(wb) {
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
        
        // Find Summary sheet
        const summarySheet = findSheet(wb, ['Summary', 'SUMMARY']);
        if (summarySheet) {
            const summaryData = parseSummarySheet(wb.Sheets[summarySheet]);
            data.brands = summaryData.brands;
            data.locations = summaryData.locations;
            data.combinations = summaryData.combinations;
        }
        
        // Try to extract metadata from first sheet
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        data.metadata = extractMetadata(firstSheet);
        
        return data;
    }

    function findSheet(wb, names) {
        for (const name of names) {
            if (wb.SheetNames.some(s => s.toLowerCase() === name.toLowerCase())) {
                return wb.SheetNames.find(s => s.toLowerCase() === name.toLowerCase());
            }
        }
        return null;
    }

    function parseSummarySheet(sheet) {
        const result = {
            brands: [],
            locations: [],
            combinations: []
        };
        
        const range = XLSX.utils.decode_range(sheet['!ref']);
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
        
        if (data.length === 0) return result;
        
        // Find header row (contains "brand" or similar)
        let headerRow = -1;
        let brandCol = -1;
        let locationCols = [];
        
        for (let r = 0; r < Math.min(15, data.length); r++) {
            const row = data[r];
            for (let c = 0; c < row.length; c++) {
                const cell = String(row[c] || '').toLowerCase();
                if (cell.match(/brand|marca/)) {
                    headerRow = r;
                    brandCol = c;
                    
                    // Find location columns
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
            console.warn('Could not find Summary table structure');
            return result;
        }
        
        // Extract locations
        result.locations = locationCols.map(lc => lc.name);
        
        // Extract brands and combinations
        const seenBrands = new Set();
        
        for (let r = headerRow + 1; r < data.length; r++) {
            const row = data[r];
            const brandValue = row[brandCol];
            
            // Handle null/empty
            if (brandValue === null || brandValue === undefined || brandValue === '') {
                continue;
            }
            
            // Convert to string, handling numeric brands like "947"
            let brandName;
            if (typeof brandValue === 'number') {
                brandName = Number.isInteger(brandValue) ? String(Math.round(brandValue)) : String(brandValue);
            } else {
                brandName = String(brandValue).trim();
            }
            
            // Skip empty after trim or junk rows
            if (!brandName || brandName.match(/total|sum|grand|template/i)) {
                continue;
            }
            
            // Add brand if not seen (including numeric like "947")
            if (!seenBrands.has(brandName)) {
                result.brands.push(brandName);
                seenBrands.add(brandName);
            }
            
            // Check which locations have values (create combinations)
            locationCols.forEach(loc => {
                const cellValue = row[loc.col];
                const cellStr = String(cellValue || '').trim();
                
                // Valid combination if cell has content and is not just zeros or "None"
                if (cellStr && 
                    cellStr.toLowerCase() !== 'none' && 
                    !cellStr.match(/^0+$/)) {
                    result.combinations.push({
                        brand: brandName,
                        location: loc.name,
                        auto_closed: false
                    });
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
        
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
        
        // Look for key-value pairs in first 20 rows
        for (let r = 0; r < Math.min(20, data.length); r++) {
            const row = data[r];
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
                    // Try to parse as date
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
        /**
         * Extract images from .xlsx (which is a ZIP file).
         * Images are in xl/media/ folder.
         * Relationships in xl/drawings/_rels/*.xml.rels map images to sheets.
         * xl/drawings/drawing*.xml contains anchor information.
         */
        
        const images = [];
        const annotationImages = [];
        
        try {
            // Get all image files from xl/media/
            const mediaFolder = zip.folder('xl/media');
            if (!mediaFolder) {
                console.log('No xl/media folder found');
                return;
            }
            
            const imageFiles = [];
            mediaFolder.forEach((relativePath, file) => {
                if (!file.dir && relativePath.match(/\.(png|jpg|jpeg|gif|bmp)$/i)) {
                    imageFiles.push({ path: relativePath, file: file });
                }
            });
            
            console.log(`Found ${imageFiles.length} images in xl/media/`);
            
            // Extract each image
            for (let i = 0; i < imageFiles.length; i++) {
                const { path, file } = imageFiles[i];
                
                try {
                    const imageData = await file.async('base64');
                    const extension = path.split('.').pop().toLowerCase();
                    const filename = `image_${i}.${extension}`;
                    
                    // Try to determine which sheet this belongs to
                    // (Simplified - in production would parse drawing*.xml and rels)
                    const sheetHint = await guessImageSheet(zip, path, i);
                    
                    const imageInfo = {
                        filename: filename,
                        dataUrl: `data:image/${extension};base64,${imageData}`,
                        original_path: path
                    };
                    
                    // Categorize as annotation or example based on sheet name
                    if (sheetHint && sheetHint.toLowerCase().match(/annotation|rule|κανόν/)) {
                        annotationImages.push({
                            ...imageInfo,
                            type: 'annotation',
                            annotation_type: 'include',  // Default, would need color analysis
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
            
            console.log(`Extracted ${images.length} example images and ${annotationImages.length} annotation images`);
            
        } catch (error) {
            console.error('Error extracting images:', error);
            // Continue without images rather than failing completely
        }
    }

    async function guessImageSheet(zip, imagePath, imageIndex) {
        /**
         * Try to determine which sheet an image belongs to.
         * Parse xl/drawings/_rels/drawing*.xml.rels to find image relationships.
         */
        
        try {
            const drawingsFolder = zip.folder('xl/drawings/_rels');
            if (!drawingsFolder) return null;
            
            // Try to find rels files that mention this image
            const imageName = imagePath.split('/').pop();
            
            for (const [relPath, file] of Object.entries(drawingsFolder.files)) {
                if (relPath.endsWith('.rels')) {
                    const relsContent = await file.async('string');
                    
                    // Simple check if this rels file mentions our image
                    if (relsContent.includes(imageName)) {
                        // Extract drawing number from filename (e.g., drawing1.xml.rels -> 1)
                        const match = relPath.match(/drawing(\d+)\.xml\.rels/);
                        if (match) {
                            // Try to find which sheet uses this drawing
                            // (Would need to parse workbook.xml.rels, simplified here)
                            const drawingNum = match[1];
                            
                            // For now, return a generic identifier
                            return `Sheet_${drawingNum}`;
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

    function showParseResults() {
        document.getElementById('parseResults').style.display = 'block';
        
        const warnings = [];
        if (parsedData.brands.length === 0) {
            warnings.push('⚠️ Δεν βρέθηκαν brands - θα χρειαστεί χειροκίνητη επεξεργασία');
        }
        if (parsedData.images.length === 0 && parsedData.annotation_images.length === 0) {
            warnings.push('⚠️ Δεν εξήχθησαν εικόνες - χρησιμοποιήστε GitHub Action για πλήρη εξαγωγή');
        }
        
        document.getElementById('parseInfo').innerHTML = `
            <p><strong>Brands:</strong> ${parsedData.brands.length}</p>
            <p><strong>Locations:</strong> ${parsedData.locations.length}</p>
            <p><strong>Συνδυασμοί:</strong> ${parsedData.combinations.length}</p>
            <p><strong>Εικόνες:</strong> ${parsedData.images.length + parsedData.annotation_images.length}</p>
            ${warnings.length > 0 ? `<div class="text-muted" style="margin-top: 1rem;">${warnings.join('<br>')}</div>` : ''}
        `;
    }

    function showStep(stepNumber) {
        document.querySelectorAll('.wizard-step').forEach((step, index) => {
            step.classList.toggle('active', index + 1 === stepNumber);
        });
    }

    function populateForm() {
        // Populate metadata
        document.getElementById('client').value = parsedData.metadata.client || '';
        document.getElementById('event').value = parsedData.metadata.event || '';
        document.getElementById('competition').value = parsedData.metadata.competition || '';
        document.getElementById('sport').value = parsedData.metadata.sport || '';
        document.getElementById('footage_clips').value = parsedData.metadata.footage_clips || '';
        document.getElementById('date_start').value = parsedData.metadata.date_start || '';
        document.getElementById('date_end').value = parsedData.metadata.date_end || '';
        document.getElementById('notes').value = '';
        document.getElementById('rules').value = '';
        
        // Show counts
        document.getElementById('brandCount').textContent = parsedData.brands.length;
        document.getElementById('locationCount').textContent = parsedData.locations.length;
        document.getElementById('comboCount').textContent = parsedData.combinations.length;
        document.getElementById('imageCount').textContent = parsedData.images.length + parsedData.annotation_images.length;
        
        // Show preview
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
        
        // Show images preview
        const imagesPreview = document.getElementById('imagesPreview');
        const allImages = [...parsedData.images, ...parsedData.annotation_images];
        
        if (allImages.length > 0) {
            imagesPreview.innerHTML = allImages.slice(0, 20).map(img => `
                <div class="preview-image" title="${img.filename}">
                    <img src="${img.dataUrl}" alt="${img.filename}">
                </div>
            `).join('');
            
            if (allImages.length > 20) {
                imagesPreview.innerHTML += `<div class="text-muted" style="grid-column: 1/-1; text-align: center;">...και ${allImages.length - 20} ακόμα</div>`;
            }
        } else {
            imagesPreview.innerHTML = '<div class="text-muted">Δεν εξήχθησαν εικόνες</div>';
        }
    }

    async function generateBriefPackage() {
        const formData = new FormData(document.getElementById('briefForm'));
        
        // Build complete brief data
        const briefData = {
            id: parsedData.id,
            client: formData.get('client'),
            event: formData.get('event'),
            competition: formData.get('competition') || null,
            sport: formData.get('sport') || null,
            footage_clips: formData.get('footage_clips') || null,
            date_start: formData.get('date_start') || null,
            date_end: formData.get('date_end') || null,
            notes: formData.get('notes') || null,
            rules: formData.get('rules') || null,
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
        
        // Create ZIP package
        const zip = new JSZip();
        const folder = zip.folder(briefData.id);
        
        // Add brief.json
        folder.file('brief.json', JSON.stringify(briefData, null, 2));
        
        // Add images
        const allImages = [...parsedData.images, ...parsedData.annotation_images];
        for (const img of allImages) {
            if (img.dataUrl) {
                // Convert data URL to blob
                const base64Data = img.dataUrl.split(',')[1];
                folder.file(img.filename, base64Data, { base64: true });
            }
        }
        
        // Add README
        folder.file('README.txt', `
Brief Package: ${briefData.event}
Client: ${briefData.client}
Created: ${new Date().toLocaleString('el-GR')}

Αυτός ο φάκελος περιέχει:
- brief.json: Τα δεδομένα του brief
- ${allImages.length} εικόνες

Για να προσθέσετε αυτό το brief στη βιβλιοθήκη:
1. Αποσυμπιέστε αυτό το αρχείο
2. Ανεβάστε τον φάκελο "${briefData.id}" στον φάκελο briefs/ του repository
3. Τράξτε: python scripts/rebuild_index.py
4. Commit τις αλλαγές
        `.trim());
        
        // Store package for download
        window.briefPackage = {
            zip: zip,
            briefData: briefData
        };
        
        showStep(3);
        
        // Setup download button
        document.getElementById('downloadPackage').onclick = async () => {
            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `brief-${briefData.id}.zip`;
            a.click();
            URL.revokeObjectURL(url);
        };
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

    // Initialize
    document.addEventListener('DOMContentLoaded', init);
})();
