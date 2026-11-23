# isieve Briefs Library

Ιδιωτική βιβλιοθήκη briefs για την ομάδα annotation της isieve. Στατικός ιστότοπος για αναζήτηση και προβολή client briefs με brand/location combinations και εικόνες παραδείγματος.

## 🌟 Χαρακτηριστικά

- ✅ **Βιβλιοθήκη με αναζήτηση** - κάρτες briefs, φάλτρα (άθλημα, πελάτης, ημερομηνία)
- ✅ **Λεπτομερής σελίδα brief** - brands, locations, Brand × Location matrix, εικόνες, κανόνες
- ✅ **Lightbox εικόνων** με zoom και πλοήγηση (←/→/Esc)
- ✅ **Copy-to-clipboard** για brand/location names
- ✅ **Δύο τρόποι upload** - in-browser Excel importer ή GitHub Action inbox
- ✅ **Πλήρως static** - hosting σε GitHub Pages (δωρεάν)
- ✅ **Ελληνική διεπαφή**

---

## 🚀 Setup στο GitHub (jimtsa80)

### Βάμα 1: Δημιουργία Repository

```bash
# Στο GitHub: Create new repository "isieve-briefs" (public ή private)

# Update remote και push
git remote set-url origin https://github.com/jimtsa80/isieve-briefs.git
git push -u origin main
```

### Βήμα 2: Ενεργοποίηση GitHub Pages

1. Settings → Pages
2. Source: Branch **main**, Folder **/ (root)**
3. Save
4. Περιμένετε 2 λεπτά
5. Live στο: `https://jimtsa80.github.io/isieve-briefs/`

### Βήμα 3: Ενεργοποίηση GitHub Actions

1. Settings → Actions → General
2. Actions permissions: **Allow all actions** ✓
3. Workflow permissions: **Read and write permissions** ✓
4. Save

**Τελειώσατε!** Το site είναι έτοιμο.

---

## 📤 Πώς να προσθέσετε Brief

### Τρόπος 1: In-Browser Importer (Συνιστάται)

1. Πηγαίνετε στο `https://jimtsa80.github.io/isieve-briefs/upload.html`
2. Σόρετε το .xlsx αρχείο (ή κλικ για επιλογή)
3. Το app αναλύει αυτόματα:
   - Brands & Locations από Summary sheet
   - Brand × Location συνδυασμούς
   - Metadata (client, event, sport, dates)
   - Εικόνες από xl/media/
4. Ελέγξτε/επεξεργαστείτε τα πεδία
5. Κλικ **"Δημιουργία Brief Package"**
6. Κατεβάστε το `.zip`
7. Αποσυμπιέστε και ανεβάστε τον φάκελο στον `briefs/` μέσω GitHub:
   - GitHub → Repository ₒ `briefs/` folder
   - Add file → Upload files
   - Drag φάκελο ₒ Commit
8. Τρέξτε: `python scripts/rebuild_index.py` (ή περιμένετε GitHub Action)
9. Commit το `briefs/index.json`
10. Το site ενημερώνεται αυτόματα

**Πλεονεκτάματα:** Πλάρης έλεγχος, εξαγωγή εικόνων, ασφαλές για public repos

### Τρόπος 2: GitHub Action Inbox (Αυτόματος)

1. GitHub → Repository → `briefs-inbox/` folder
2. Add file → Upload files
3. Ανεβάστε το .xlsx αρχείο
4. **(Προαιρετικά)** Ανεβάστε ένα `.txt` αρχείο με το ίδιο όνομα για να ορίσετε metadata:
   
   **Παράδειγμα:** Για το `20260802_LionsvsBulls_Stan_brief.xlsx`, δημιουργήστε `20260802_LionsvsBulls_Stan_brief.txt`:
   
   ```
   πελάτης: Omnicom / FSE
   διοργάνωση: Carling Black Label Currie Cup
   άθλημα: Rugby
   σημειώσεις: Τελικός αγώνας της σεζόν
   ```
   
   **Υποστηριζόμενα κλειδιά (Ελληνικά/English):**
   - `πελάτης` / `client` - Όνομα πελάτη
   - `γεγονός` / `event` - Τίτλος γεγονότος
   - `διοργάνωση` / `competition` - Όνομα διοργάνωσης
   - `άθλημα` / `sport` - Άθλημα (Rugby, Football, κλπ.)
   - `ημερομηνία` / `date_start` - Ημερομηνία έναρξης (YYYY-MM-DD)
   - `σημειώσεις` / `notes` - Πρόσθετες σημειώσεις

5. Commit
6. Το GitHub Action:
   - Αναλύει το .xlsx
   - Εξάγει metadata από ονόματα clips (π.χ. `20260802_LionsvsBulls_Stan_0105`)
   - Διαβάζει το προαιρετικό .txt αρχείο (αν υπάρχει)
   - Εξάγει embedded images με openpyxl
   - Δημιουργεί brief package στον `briefs/`
   - Διαγράφει το .xlsx και .txt
   - Ενημερώνει το index.json
   - Redeploys το site
7. Ελέγξτε **Actions** tab για πρόοδο (2-3 λεπτά)

**Πλεονεκτήματα:** Πλήρως αυτόματο, one-click, πλήρης εξαγωγή images

**⚠️ Προσοχή:** Για public repo, μην ανεβάζετε εμπιστευτικά .xlsx απευθείας. Χρησιμοποιήστε Τρόπο 1.

---

### 🔧 Διόρθωση Metadata Μετά το Upload

Αν χρειάζεται να διορθώσετε τον πελάτη, το γεγονός ή άλλα metadata μετά το upload:

1. GitHub → Repository → `briefs/brief-ΧΧΧΧΧΧΧΧ/` folder
2. Κλικ στο `brief.json`
3. Κλικ το εικονίδιο μολυβιού (Edit)
4. Επεξεργαστείτε τα πεδία `client`, `event`, `competition`, `sport`, `notes`, κλπ.
5. Commit changes
6. Το GitHub Action ανιχνεύει την αλλαγή και ενημερώνει αυτόματα το `index.json`
7. Το site ενημερώνεται σε 1-2 λεπτά

**Σημείωση:** Αν ο πελάτης είναι άγνωστος, εμφανίζεται ως "Πελάτης: —" στη βιβλιοθήκη.

---

## 🗂️ Δομή Project

```
isieve-briefs/
├── index.html              # Αρχική σελίδα (λίστα briefs)
├── brief.html              # Λεπτομέρειες brief
├── upload.html             # Excel importer
├── css/style.css           # Styles (Greek UI, dark mode)
├── js/
│   ├── app.js              # Λογική αρχικής
│   ├── brief.js            # Λογική brief page
│   └── upload.js           # Excel parser + image extraction
├── briefs/
│   ├── index.json          # Λίστα briefs (auto-generated)
│   └── brief-YYYYMMDD-xxxxx/
│       ├── brief.json      # Δεδομένα
│       └── *.png           # Εικόνες
├── briefs-inbox/           # Upload .xlsx εδώ (GitHub Action)
├── scripts/
│   ├── process_inbox.py    # Επεξεργασία .xlsx
│   └── rebuild_index.py    # Rebuild index.json
└── .github/workflows/
    └── process-briefs.yml  # GitHub Action
```

---

## 📊 Excel Parsing

### Τι αναλύει

**Summary Sheet:**
- Πίνακας Brand × Location (πρώτη στήλη: brands, υπόλοιπες: locations)
- Κελιά με 'x', '✓' ή οποιαδήποτε τιμή = valid combination
- Χειρίκεται numeric brands (π.χ. "947")
- Αγνοεί junk/padded rows (Total, Σύνολο, template sheets)

**Brand Sheets:**
- Embedded images → example images για combinations
- Χρησιμοποιεί drawing anchors (όχι image.path) για σωστή σύνδεση
- Μέχρι 4 example slots ανά brand-location row

**Annotations Sheet:**
- Reference stills με colored overlays
- Πράσινο/Green = include
- Κόκκινο/Red = exclude (lookalike)
- Κίτρινο-Πορτοκαλί/Amber = variant

**Metadata:**
- Client, Event, Competition, Sport, Dates
- Από key-value pairs στο πρώτο sheet

**Missing Combinations:**
- Βρίσκει combos σε brand sheets που λείπουν από Summary
- Π.χ. "Fidelity ADT / Player Jersey - Shoulder"

---

## 🔧 Επεξεργασία Brief

Για να αλλάξετε υπάρχον brief:

1. GitHub → `briefs/<brief-id>/brief.json`
2. Κλικ edit (μολόβι)
3. Αλλάξτε πεδία (rules, notes, sport, κτλ)
4. Commit
5. Τρέξτε: `python scripts/rebuild_index.py`
6. Commit το `briefs/index.json`

---

## 🛠️ Τοπική Ανάπτυξη

```bash
# Τρέξτε local server
python3 -m http.server 8000
# Ανοίξτε: http://localhost:8000

# Test Python scripts
pip install openpyxl Pillow
python scripts/process_inbox.py    # Επεξεργασία inbox
python scripts/rebuild_index.py    # Rebuild index
```

---

## 🔐 Privacy (Προαιρετικό)

Τρέχουσα κατάσταση: **Public site** (όποιος έχει link μπορεί να δει)

### Για πλήρη ιδιωτικότητα:

**Option 1: Private Repo + GitHub Pro**
- GitHub Pro: $4/μήνα
- Private repo + private Pages
- Μόνο invited collaborators

**Option 2: StatiCrypt (Password Gate)**
```bash
npm install -g staticrypt
staticrypt index.html -p YOUR_PASSWORD -o index.html
staticrypt brief.html -p YOUR_PASSWORD -o brief.html
staticrypt upload.html -p YOUR_PASSWORD -o upload.html
# Commit encrypted files
```

---

## ⚠️ Γνωστοί Περιορισμοί

### In-Browser Importer
- ✅ Εξάγει εικόνες από xl/media/ (JSZip)
- ⚠️ Δεν συνδέει πάντα σωστά εικόνες με brand/location
- ⚠️ Annotation type detection (include/exclude) είναι best-effort

**Λύση:** Χρησιμοποιήστε GitHub Action για πλήρη εξαγωγή

### GitHub Action
- ✅ Πλήρης εξαγωγή με drawing anchors
- ✅ Σωστή σύνδεση images με combinations
- ⚠️ Χρειάζεται ~2-3 λεπτά

### Excel Formats
- Διαφορετικοί πελάτες στέλνουν διαφορετικές μορφές
- Parser είναι ανεκτικός αλλά μπορεί να χρειαστεί χειροκίνητη διόρθωση
- Όλα τα πεδία μπορούν να επεξεργαστούν στο brief.json

---

## 🐛 Troubleshooting

### Το site δείχνει 404
- Περιμένετε 2-3 λεπτά μετά το πρώτο deployment
- Ελέγξτε: Settings → Pages (enabled?)

### GitHub Action αποτυγχάνει
- Settings → Actions → General → Write permissions ✓
- Δείτε error στο Actions tab
- Ελέγξτε ότι .xlsx έχει Summary sheet

### Δεν φαίνεται brief
```bash
python scripts/rebuild_index.py
git add briefs/index.json
git commit -m "Update index"
git push
```

### Εικόνες δεν φορτώνουν
- Ελέγξτε ότι υπάρχουν στον `briefs/<id>/` φάκελο
- Ελέγξτε filenames στο brief.json
- Local testing: τρέξτε web server (όχι file://)

---

## 📦 Backup

Τα briefs αποθηκεύονται στο Git:

```bash
# Clone για local backup
git clone https://github.com/jimtsa80/isieve-briefs.git

# Όλα τα briefs + εικόνες στον briefs/ φάκελο
```

---

## 📞 Support

Για ερωτήσεις:
1. Ελέγξτε Actions tab (GitHub Action errors)
2. Ελέγξτε Browser Console (F12) (JavaScript errors)
3. Επικοινωνήστε με developer

---

## 🎯 Stack

- **Frontend:** HTML5 + CSS3 + Vanilla JavaScript
- **Excel Parsing:** SheetJS (browser), openpyxl (Python)
- **Image Extraction:** JSZip (browser), Pillow (Python)
- **Hosting:** GitHub Pages (δωρεάν)
- **Automation:** GitHub Actions (δωρεάν)

**Zero dependencies για running** - απλά HTML/CSS/JS files

---

**Καλξ χρήση! 🚀**

Built for isieve annotation team • November 2024
