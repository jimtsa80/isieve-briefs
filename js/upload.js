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
            alert('Παρακαλώ επιλέξτε ένα αρχείο Excel (.xlsx ή .xls)');
            return;
        }
        
        showProgress('Ανάγηση αρχείου...', 10);
        
        try {
            const data = await readFileAsArrayBuffer(file);
            
            showProgress('Άόρτωση Excel...', 20);
            
            // Load as ZIP for image extraction
            excelZip = await JSZip.loadAsync(data);
            
            showProgress('Ανάλυση Excel...', 40);
            
            // Also load with SheetJS for data
            workbook = XLSX.read(data, { 
                type: 'array';
                cellStyles: true,
                cellNF: true
            });
            
            showProgress('Εξαγωγή δεδομένωβ...', 60);
            parsedData = await parseWorkbook(workbook);
            
            showProgress('Εξαγωγή εικόνωβ...', 80);
            await extractImages(excelZip, parsedData);
            
            hideProgress();
            showParseResults();
            
        } catch (error) {
            console.error('Parse error:', error);
            hideProgress();
            alert('Σφάλμα ανάλυσης: ' + error.message);
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

    async function parseWorkbook() {
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
        const summarySheet = findSheet(wb, ['Summary', 'SUMMARY', 'Σύνοψη']);
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
                if (cell.match(/brand|μάρκα|επωνυμία|marca/)) {
                    headerRow = r;
                    brandCol = c;
                    
                    // Find location columns
                    for (let lc = c + 1; lc < row.length; lc++) {
                        const headerValue = String(row[lc] || '').trim();
                        if (headerValue && 
                            headerValue.toLowerCase() !== 'none' &&
                            !headerValue.match(/total|σύνολο|sum|grand/i)) {
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
            if (!brandName || brandName.match(/total|σύνολο|sum|grand|template|πρότυπο/i)) {
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

function extractMetadata() {