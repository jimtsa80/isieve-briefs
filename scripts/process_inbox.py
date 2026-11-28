#!/usr/bin/env python3
"""
Process .xlsx and .xlsm files from briefs-inbox/ directory.
Extracts data, images by drawing anchor, reads shape fill/stroke colors from XML.
Supports both single-match briefs (e.g., Rugby) and multi-day/TVGI/Venue briefs (e.g., Supercars).
"""

import os
import sys
import json
import posixpath
from pathlib import Path
from datetime import datetime, timedelta
import re
from io import BytesIO
import zipfile
import shutil
import xml.etree.ElementTree as ET

try:
    from openpyxl import load_workbook
    from PIL import Image
except ImportError:
    print("Error: Required packages not installed")
    print("Run: pip install openpyxl Pillow")
    sys.exit(1)


def generate_id(output_dir=None):
    """Generate a unique ID for the brief"""
    dt = datetime.now()
    while True:
        brief_id = f"brief-{dt.strftime('%Y%m%d%H%M%S')}"
        if output_dir is None or not (Path(output_dir) / brief_id).exists():
            return brief_id
        dt += timedelta(seconds=1)


def split_camel_case(text):
    """Split CamelCase into words: 'LionsvsBulls' -> 'Lions vs Bulls'"""
    result = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
    return result


def parse_clip_name(clip_name):
    """
    Parse clip name like: 20260802_LionsvsBulls_Stan_0105
    Returns dict with: date_start, event, broadcaster
    """
    metadata = {}
    pattern = r'(\d{8})_([^_]+)_([^_]+)_(.+)'
    match = re.match(pattern, clip_name, re.IGNORECASE)

    if match:
        date_str, event_part, broadcaster, _clip_id = match.groups()

        try:
            year = int(date_str[0:4])
            month = int(date_str[4:6])
            day = int(date_str[6:8])
            metadata['date_start'] = f"{year:04d}-{month:02d}-{day:02d}"
        except Exception:
            pass

        vs_match = re.search(r'(.+?)vs(.+)', event_part, re.IGNORECASE)
        if vs_match:
            team_a = split_camel_case(vs_match.group(1).strip())
            team_b = split_camel_case(vs_match.group(2).strip())
            metadata['event'] = f"{team_a} vs {team_b}"
        else:
            metadata['event'] = split_camel_case(event_part)

        metadata['broadcaster'] = broadcaster

    return metadata


def read_sidecar_file(xlsx_path):
    """
    Read optional sidecar file (.txt or .json) with same stem as xlsx.
    For .txt: parse simple key: value lines (English and Greek keys).
    Returns dict with metadata to override inferred values.
    """
    metadata = {}

    greek_to_english = {
        'πελάτης': 'client',
        'διοργάνωση': 'competition',
        'άθλημα': 'sport',
        'ημερομηνία': 'date_start',
        'σημειώσεις': 'notes',
        'αθλητής': 'athlete',
        'γεγονός': 'event',
    }

    stem = xlsx_path.stem
    parent = xlsx_path.parent

    txt_path = parent / f"{stem}.txt"
    if txt_path.exists():
        try:
            with open(txt_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if ':' in line and not line.startswith('#'):
                        key, value = line.split(':', 1)
                        key = key.strip().lower()
                        value = value.strip()

                        if key in greek_to_english:
                            key = greek_to_english[key]

                        if value:
                            if key == 'dates' and ' to ' in value:
                                parts = [p.strip() for p in value.split(' to ', 1)]
                                if len(parts) == 2:
                                    metadata['date_start'] = parts[0]
                                    metadata['date_end'] = parts[1]
                            else:
                                metadata[key] = value

            metadata['_sidecar_path'] = txt_path
        except Exception as e:
            print(f"Warning: Could not read sidecar {txt_path.name}: {e}")

    json_path = parent / f"{stem}.json"
    if json_path.exists():
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                json_metadata = json.load(f)
                metadata.update(json_metadata)

            metadata['_sidecar_path'] = json_path
        except Exception as e:
            print(f"Warning: Could not read sidecar {json_path.name}: {e}")

    return metadata


def extract_source_clips(sheet):
    """
    Extract source clip names from Summary sheet (e.g., FilesTable at F2:F or Table1 at G2:G).
    Returns list of clip names (skips header).
    """
    clips = []
    if not sheet:
        return clips

    try:
        # Detect the clip column from header rows 1-3 (looking after column D)
        clip_col = None
        clip_header_names = {'image files', 'files to monitor', 'filename', 'files', 'clips', 'file', 'clip'}
        for hdr_row in (2, 1, 3):
            if hdr_row > sheet.max_row:
                continue
            for col_idx in range(5, min(sheet.max_column + 1, 16)):
                val = sheet.cell(hdr_row, col_idx).value
                if isinstance(val, str) and val.strip().lower() in clip_header_names:
                    clip_col = col_idx
                    start_row = hdr_row + 1
                    break
            if clip_col is not None:
                break

        if clip_col is None:
            clip_col = 6
            start_row = 3

        for row in sheet.iter_rows(min_row=start_row, min_col=clip_col, max_col=clip_col, values_only=True):
            if row[0] and isinstance(row[0], str) and row[0].strip():
                clip_name = row[0].strip()
                if clip_name.lower() not in clip_header_names:
                    clips.append(clip_name)
    except Exception as e:
        print(f"Warning: Could not extract source clips: {e}")

    return clips


def find_sheet(wb, names):
    """Find a sheet by one of several possible names.

    Preference order (so case-distinct brand names do not steal the wrong sheet):
    1. Exact name match
    2. Exact match after stripping whitespace
    3. Case-insensitive stripped match
    """
    for name in names:
        if name in wb.sheetnames:
            return wb[name]
        stripped = name.strip()
        for sheet_name in wb.sheetnames:
            if sheet_name.strip() == stripped:
                return wb[sheet_name]
        target = stripped.lower()
        for sheet_name in wb.sheetnames:
            if sheet_name.strip().lower() == target:
                return wb[sheet_name]
    return None


def allocate_unique_filename(brief_dir, stem, extension, used_names):
    """Return a filename like {stem}_{n}.{ext} that is unused on disk and in used_names."""
    ext = extension.lstrip('.')
    idx = 0
    while True:
        filename = f"{stem}_{idx}.{ext}"
        if filename not in used_names and not (Path(brief_dir) / filename).exists():
            used_names.add(filename)
            return filename
        idx += 1


def normalize_whitespace(text):
    """Collapse internal runs of whitespace and strip edges."""
    return re.sub(r'\s+', ' ', str(text)).strip()


def sanitize_filename_part(name):
    """Sanitize a brand name for safe file naming."""
    cleaned = re.sub(r'[^a-z0-9_]+', '_', name.lower()).strip('_')
    return cleaned or 'brand'


def parse_summary_sheet(sheet):
    """
    Parse Summary sheet: Brand_Assets table at B2:E...
    B=Brands, C=Assets, D=Example found, E=Notes (optional)
    """
    result = {
        'brands': [],
        'locations': [],
        'combinations': [],
        'summary_notes': []
    }

    rows = list(sheet.iter_rows(values_only=True))
    if len(rows) < 3:
        return result

    seen_brands = set()
    seen_locations = set()
    seen_combos = set()

    for r_idx in range(2, len(rows)):  # Start from row 3 (index 2)
        row = rows[r_idx]
        if len(row) < 4:
            continue

        brand_value = row[1]  # Column B (index 1)
        asset_value = row[2]  # Column C (index 2)
        note_value = row[4] if len(row) > 4 else None  # Column E (index 4)

        if brand_value is None or str(brand_value).strip() == '':
            continue

        if isinstance(brand_value, (int, float)):
            brand_name = str(int(brand_value)) if float(brand_value).is_integer() else str(brand_value)
        else:
            brand_name = normalize_whitespace(brand_value)

        if asset_value is None or str(asset_value).strip() == '':
            continue

        asset_name = normalize_whitespace(asset_value)

        if brand_name not in seen_brands:
            result['brands'].append(brand_name)
            seen_brands.add(brand_name)

        if asset_name not in seen_locations:
            result['locations'].append(asset_name)
            seen_locations.add(asset_name)

        combo_key = (brand_name.lower(), asset_name.lower())
        if combo_key not in seen_combos:
            seen_combos.add(combo_key)
            combo = {
                'brand': brand_name,
                'location': asset_name,
                'auto_closed': False
            }
            if note_value is not None and str(note_value).strip():
                combo['notes'] = str(note_value).strip()
            result['combinations'].append(combo)

        # Also check Notes in col K (index 10) for Files to monitor
        if len(row) > 10 and row[10] is not None and str(row[10]).strip():
            result['summary_notes'].append(str(row[10]).strip())

    return result


def resolve_zip_path(base_dir, target):
    """Resolve a relationship Target path inside an OOXML zip archive."""
    if target.startswith('/'):
        return target.lstrip('/')
    joined = posixpath.join(base_dir, target)
    return posixpath.normpath(joined)


def map_sheets_to_drawings(zf):
    """
    Map sheet names (exact and lowercase) to their drawing XML paths via
    xl/workbook.xml -> xl/_rels/workbook.xml.rels -> xl/worksheets/_rels/sheetX.xml.rels.
    """
    sheet_to_drawings = {}
    namelist = set(zf.namelist())

    if 'xl/workbook.xml' not in namelist or 'xl/_rels/workbook.xml.rels' not in namelist:
        return sheet_to_drawings

    wb_root = ET.fromstring(zf.read('xl/workbook.xml'))
    wb_rels_root = ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'))

    rel_map = {}
    for rel in wb_rels_root:
        rid = rel.get('Id')
        target = rel.get('Target')
        if rid and target:
            rel_map[rid] = resolve_zip_path('xl', target)

    ns_wb = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    for sheet_elem in wb_root.findall('.//main:sheet', ns_wb):
        sheet_name = sheet_elem.get('name')
        rid = sheet_elem.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        if not sheet_name or not rid or rid not in rel_map:
            continue

        ws_path = rel_map[rid]
        ws_dir = posixpath.dirname(ws_path)
        ws_file = posixpath.basename(ws_path)
        ws_rels_path = posixpath.join(ws_dir, '_rels', f"{ws_file}.rels")

        drawings = []
        if ws_rels_path in namelist:
            ws_rels_root = ET.fromstring(zf.read(ws_rels_path))
            for rel in ws_rels_root:
                target = rel.get('Target', '')
                rel_type = rel.get('Type', '')
                if 'drawing' in rel_type.lower() or 'drawing' in target.lower():
                    d_path = resolve_zip_path(ws_dir, target)
                    if d_path in namelist:
                        drawings.append(d_path)

        sheet_to_drawings[sheet_name] = drawings
        sheet_to_drawings[sheet_name.strip().lower()] = drawings

    return sheet_to_drawings


def parse_drawing_elements(zf, drawing_path):
    """
    Parse a drawing XML file to extract image placements and shape overlays.
    Supports both twoCellAnchor and oneCellAnchor.
    Returns (pic_placements, shape_elements).
    """
    pic_placements = []
    shape_elements = []

    try:
        if drawing_path not in zf.namelist():
            return pic_placements, shape_elements

        root = ET.fromstring(zf.read(drawing_path))
        ns = {
            'xdr': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
            'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
            'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
        }

        anchors = list(root.findall('xdr:twoCellAnchor', ns)) + list(root.findall('xdr:oneCellAnchor', ns))
        for anchor in anchors:
            from_elem = anchor.find('xdr:from', ns)
            if from_elem is None:
                continue
            from_col = int(from_elem.findtext('xdr:col', '0', ns))
            from_row = int(from_elem.findtext('xdr:row', '0', ns))

            to_elem = anchor.find('xdr:to', ns)
            if to_elem is not None:
                to_col = int(to_elem.findtext('xdr:col', str(from_col), ns))
                to_row = int(to_elem.findtext('xdr:row', str(from_row), ns))
            else:
                to_col = from_col
                to_row = from_row

            # Check for picture
            for pic in anchor.findall('.//xdr:pic', ns):
                blip = pic.find('.//a:blip', ns)
                if blip is not None:
                    embed_id = blip.get('{' + ns['r'] + '}embed')
                    if embed_id:
                        pic_placements.append({
                            'embed_id': embed_id,
                            'from_col': from_col,
                            'from_row': from_row,
                            'to_col': to_col,
                            'to_row': to_row,
                        })

            # Check for shape
            for shape in anchor.findall('.//xdr:sp', ns):
                stroke_color = None
                sp_pr = shape.find('xdr:spPr', ns)
                if sp_pr is not None:
                    ln = sp_pr.find('a:ln', ns)
                    if ln is not None:
                        srgb = ln.find('.//a:srgbClr', ns)
                        if srgb is not None and srgb.get('val'):
                            stroke_color = srgb.get('val').upper()

                texts = [t.text for t in shape.findall('.//a:t', ns) if t.text and t.text.strip()]
                shape_text = ''.join(texts).strip() if texts else None

                shape_elements.append({
                    'from_col': from_col,
                    'from_row': from_row,
                    'to_col': to_col,
                    'to_row': to_row,
                    'color': stroke_color,
                    'text': shape_text,
                })

    except Exception as e:
        print(f"Warning: Could not parse {drawing_path}: {e}")

    return pic_placements, shape_elements


def parse_drawing_rels(zf, drawing_path):
    """
    Parse drawing rels file to map embed IDs to media paths.
    """
    id_to_media = {}
    try:
        d_dir = posixpath.dirname(drawing_path)
        d_file = posixpath.basename(drawing_path)
        rels_path = posixpath.join(d_dir, '_rels', f"{d_file}.rels")
        if rels_path not in zf.namelist():
            return id_to_media

        root = ET.fromstring(zf.read(rels_path))
        for rel in root.findall('.//{http://schemas.openxmlformats.org/package/2006/relationships}Relationship'):
            rel_id = rel.get('Id')
            target = rel.get('Target')
            if rel_id and target:
                id_to_media[rel_id] = resolve_zip_path(d_dir, target)
    except Exception as e:
        print(f"Warning: Could not parse rels for {drawing_path}: {e}")

    return id_to_media


def color_to_annotation_type(color_hex):
    """Map hex stroke color to annotation type."""
    if not color_hex:
        return None
    c = color_hex.upper().lstrip('#')
    if c == 'FF0000':
        return 'exclude'
    if c in ('FFC000', 'FFFF00', 'FFA500'):
        return 'variant'
    if c in ('00B050', '00FF00'):
        return 'include'
    return None


def boxes_overlap(a, b):
    """Check whether two cell bounding boxes (row/col ranges) overlap."""
    return (
        a['from_row'] <= b['to_row']
        and a['to_row'] >= b['from_row']
        and a['from_col'] <= b['to_col']
        and a['to_col'] >= b['from_col']
    )


def parse_brand_sheets(wb, filepath, brands, brief_dir):
    """
    Parse brand sheets for example images using exact sheet->drawing XML mapping.
    """
    images = []
    used_names = {p.name for p in Path(brief_dir).iterdir() if p.is_file()}

    try:
        with zipfile.ZipFile(filepath, 'r') as zf:
            media_data = {
                name: zf.read(name)
                for name in zf.namelist()
                if name.startswith('xl/media/') and not name.endswith('/')
            }
            sheet_to_drawings = map_sheets_to_drawings(zf)

            for brand_name in brands:
                try:
                    sheet = find_sheet(wb, [brand_name])
                    if not sheet:
                        continue

                    drawings = sheet_to_drawings.get(sheet.title) or sheet_to_drawings.get(sheet.title.strip().lower(), [])
                    if not drawings:
                        continue

                    rows = list(sheet.iter_rows(values_only=True))
                    # Find Asset column index from row 1 headers (default 3 = Column D)
                    asset_col_idx = 3
                    if rows:
                        for c_idx, hdr in enumerate(rows[0]):
                            if isinstance(hdr, str) and hdr.strip().lower() == 'asset':
                                asset_col_idx = c_idx
                                break

                    safe_brand = sanitize_filename_part(brand_name)

                    for drawing_path in drawings:
                        placements, _shapes = parse_drawing_elements(zf, drawing_path)
                        id_to_media = parse_drawing_rels(zf, drawing_path)

                        # Sort top-to-bottom, left-to-right
                        placements.sort(key=lambda p: (p['from_row'], p['from_col']))

                        for placement in placements:
                            embed_id = placement['embed_id']
                            from_row = placement['from_row']

                            media_path = id_to_media.get(embed_id)
                            if not media_path or media_path not in media_data:
                                continue

                            img_binary = media_data[media_path]
                            try:
                                img = Image.open(BytesIO(img_binary))
                                if img.width < 32 or img.height < 32:
                                    continue

                                filename = allocate_unique_filename(brief_dir, safe_brand, 'png', used_names)
                                filepath_out = brief_dir / filename
                                img.save(filepath_out, format='PNG')

                                location_name = None
                                if from_row < len(rows):
                                    row_data = rows[from_row]
                                    if len(row_data) > asset_col_idx and row_data[asset_col_idx]:
                                        location_name = normalize_whitespace(row_data[asset_col_idx])

                                images.append({
                                    'type': 'example',
                                    'filename': filename,
                                    'brand': brand_name,
                                    'location': location_name,
                                    'sort_order': len(images)
                                })
                            except Exception as e:
                                print(f"Warning: Could not save image for {brand_name}: {e}")
                                continue

                except Exception as e:
                    print(f"Warning: Could not process brand sheet {brand_name}: {e}")
                    continue

    except Exception as e:
        print(f"Warning: Error in parse_brand_sheets: {e}")

    return images


def parse_annotations_sheet(wb, filepath, brief_dir):
    """
    Parse Annotations / Annotation sheet:
    - Extracts text instructions/legend from sheet cells and shape textboxes into rules string.
    - Extracts annotation images using exact sheet->drawing mapping, skipping spacer icons (<32px).
    - Determines annotation_type by overlapping shape stroke colors.
    """
    annotation_images = []
    rules_lines = []
    used_ann_names = {p.name for p in Path(brief_dir).iterdir() if p.is_file()}

    ann_sheet = find_sheet(wb, ['Annotations', 'Annotation'])
    if not ann_sheet:
        return annotation_images, None

    # Collect text instructions from sheet cells
    for r_idx in range(1, ann_sheet.max_row + 1):
        row_texts = []
        for c_idx in range(1, ann_sheet.max_column + 1):
            val = ann_sheet.cell(r_idx, c_idx).value
            if val is not None and str(val).strip():
                row_texts.append(normalize_whitespace(val))
        if row_texts:
            rules_lines.append(' — '.join(row_texts))

    try:
        with zipfile.ZipFile(filepath, 'r') as zf:
            media_data = {
                name: zf.read(name)
                for name in zf.namelist()
                if name.startswith('xl/media/') and not name.endswith('/')
            }
            sheet_to_drawings = map_sheets_to_drawings(zf)
            drawings = sheet_to_drawings.get(ann_sheet.title) or sheet_to_drawings.get(ann_sheet.title.strip().lower(), [])

            for drawing_path in drawings:
                placements, shapes = parse_drawing_elements(zf, drawing_path)
                id_to_media = parse_drawing_rels(zf, drawing_path)

                # Capture any text from shape textboxes if not already in cells
                for sp in shapes:
                    if sp.get('text') and sp['text'] not in rules_lines:
                        rules_lines.append(sp['text'])

                placements.sort(key=lambda p: (p['from_row'], p['from_col']))

                for placement in placements:
                    embed_id = placement['embed_id']
                    media_path = id_to_media.get(embed_id)
                    if not media_path or media_path not in media_data:
                        continue

                    img_binary = media_data[media_path]
                    try:
                        img = Image.open(BytesIO(img_binary))
                        if img.width < 32 or img.height < 32:
                            continue

                        # Determine annotation_type from overlapping shapes
                        overlapping_types = []
                        for sp in shapes:
                            ann_t = color_to_annotation_type(sp.get('color'))
                            if ann_t and boxes_overlap(placement, sp):
                                overlapping_types.append(ann_t)

                        if 'exclude' in overlapping_types:
                            ann_type = 'exclude'
                        elif 'variant' in overlapping_types:
                            ann_type = 'variant'
                        else:
                            ann_type = 'include'

                        idx = len(annotation_images)
                        filename = allocate_unique_filename(brief_dir, 'annotation', 'png', used_ann_names)
                        filepath_out = brief_dir / filename
                        img.save(filepath_out, format='PNG')

                        annotation_images.append({
                            'type': 'annotation',
                            'filename': filename,
                            'annotation_type': ann_type,
                            'sort_order': idx
                        })
                    except Exception as e:
                        print(f"Warning: Could not save annotation image: {e}")
                        continue

    except Exception as e:
        print(f"Warning: Error in parse_annotations_sheet: {e}")

    rules_text = '\n'.join(rules_lines) if rules_lines else None
    return annotation_images, rules_text


def process_excel_file(filepath, output_dir, brief_id=None):
    """Process a single Excel file and create brief package"""
    print(f"Processing: {filepath.name}")

    try:
        wb = load_workbook(filepath, data_only=True)

        if not brief_id:
            brief_id = generate_id(output_dir)
        brief_dir = output_dir / brief_id
        brief_dir.mkdir(parents=True, exist_ok=True)

        summary_sheet = find_sheet(wb, ['Summary'])
        if summary_sheet:
            summary_data = parse_summary_sheet(summary_sheet)
        else:
            print("Warning: No Summary sheet found")
            summary_data = {'brands': [], 'locations': [], 'combinations': [], 'summary_notes': []}

        images = parse_brand_sheets(wb, filepath, summary_data['brands'], brief_dir)
        annotation_images, rules_text = parse_annotations_sheet(wb, filepath, brief_dir)
        source_clips = extract_source_clips(summary_sheet)

        inferred_metadata = {}
        if source_clips:
            inferred_metadata = parse_clip_name(source_clips[0])
        if not inferred_metadata:
            inferred_metadata = parse_clip_name(filepath.stem)

        sidecar_metadata = read_sidecar_file(filepath)
        sidecar_path = sidecar_metadata.pop('_sidecar_path', None)

        notes_text = '\n'.join(summary_data['summary_notes']) if summary_data.get('summary_notes') else None

        brief_data = {
            'id': brief_id,
            'client': '',
            'event': inferred_metadata.get('event', filepath.stem),
            'competition': None,
            'sport': None,
            'broadcaster': inferred_metadata.get('broadcaster'),
            'date_start': inferred_metadata.get('date_start'),
            'date_end': None,
            'notes': notes_text,
            'rules': rules_text,
            'source_clips': source_clips if source_clips else None,
            'brands': summary_data['brands'],
            'locations': summary_data['locations'],
            'combinations': summary_data['combinations'],
            'images': images,
            'annotation_images': annotation_images,
            'created_at': datetime.now().isoformat()
        }

        for key in ['client', 'event', 'competition', 'sport', 'date_start', 'date_end', 'broadcaster', 'notes', 'rules']:
            if key in sidecar_metadata:
                brief_data[key] = sidecar_metadata[key]

        if sidecar_path and sidecar_path.exists():
            try:
                sidecar_path.unlink()
                print(f"✓ Deleted sidecar file: {sidecar_path.name}")
            except Exception as e:
                print(f"Warning: Could not delete sidecar {sidecar_path.name}: {e}")

        # Validate: fail if no brands found
        if len(brief_data['brands']) == 0:
            print(f"✗ Error: No brands found in {filepath.name}")
            print("  The brief cannot be published without brands.")
            print("  Please check:")
            print("    - Summary sheet exists and is named 'Summary'")
            print("    - Brand_Assets table starts at B2:E...")
            print("    - Column B contains brand names")
            print("    - Column C contains asset/location names")
            print("    - Rows have both brand and asset values")
            # Clean up the brief directory since it's invalid
            import shutil
            if brief_dir.exists():
                shutil.rmtree(brief_dir)
            return False

        with open(brief_dir / 'brief.json', 'w', encoding='utf-8') as f:
            json.dump(brief_data, f, ensure_ascii=False, indent=2)

        print(f"✓ Created brief: {brief_id}")
        print(f"  Brands: {len(brief_data['brands'])}")
        print(f"  Locations: {len(brief_data['locations'])}")
        print(f"  Combinations: {len(summary_data['combinations'])}")
        print(f"  Example images: {len(images)}")
        print(f"  Annotation images: {len(annotation_images)}")

        return True

    except Exception as e:
        print(f"✗ Error processing {filepath.name}: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Main processing function"""
    repo_root = Path(__file__).parent.parent
    inbox_dir = repo_root / 'briefs-inbox'
    output_dir = repo_root / 'briefs'

    inbox_dir.mkdir(exist_ok=True)
    output_dir.mkdir(exist_ok=True)

    excel_files = sorted(p for p in inbox_dir.iterdir() if p.is_file() and p.suffix.lower() in {'.xlsx', '.xlsm', '.xls'})

    if not excel_files:
        print("No Excel files found in briefs-inbox/")
        return

    print(f"Found {len(excel_files)} file(s) to process\n")

    processed_count = 0
    for filepath in excel_files:
        if process_excel_file(filepath, output_dir):
            processed_count += 1
            filepath.unlink()
            print(f"✓ Deleted inbox file: {filepath.name}\n")

    print(f"\nProcessed {processed_count}/{len(excel_files)} files successfully")
    
    # Exit with error if any files failed
    if processed_count < len(excel_files):
        sys.exit(1)


if __name__ == '__main__':
    main()
