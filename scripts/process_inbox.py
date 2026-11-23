#!/usr/bin/env python3
"""
Process .xlsx files from briefs-inbox/ directory.
Extracts data, images by drawing anchor, reads shape fill colors from XML.
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime
import re
from io import BytesIO
import zipfile
import xml.etree.ElementTree as ET

try:
    from openpyxl import load_workbook
    from PIL import Image
except ImportError:
    print("Error: Required packages not installed")
    print("Run: pip install openpyxl Pillow")
    sys.exit(1)


def generate_id():
    """Generate a unique ID for the brief"""
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    return f"brief-{timestamp}"


def split_camel_case(text):
    """Split CamelCase into words: 'LionsvsBulls' -> 'Lions vs Bulls'"""
    # Insert space before uppercase letters that follow lowercase
    result = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
    return result


def parse_clip_name(clip_name):
    """
    Parse clip name like: 20260802_LionsvsBulls_Stan_0105
    Returns dict with: date, event, broadcaster, clip_id
    Pattern: YYYYMMDD_<TeamA>vs<TeamB>_<Broadcaster>_<ClipId>
    """
    metadata = {}
    
    # Match pattern: YYYYMMDD_<event>_<broadcaster>_<clipid>
    pattern = r'(\d{8})_([^_]+)_([^_]+)_(.+)'
    match = re.match(pattern, clip_name, re.IGNORECASE)
    
    if match:
        date_str, event_part, broadcaster, clip_id = match.groups()
        
        # Parse date
        try:
            year = int(date_str[0:4])
            month = int(date_str[4:6])
            day = int(date_str[6:8])
            metadata['date_start'] = f"{year:04d}-{month:02d}-{day:02d}"
        except:
            pass
        
        # Parse event: look for 'vs' (case insensitive)
        vs_match = re.search(r'(.+?)vs(.+)', event_part, re.IGNORECASE)
        if vs_match:
            team_a = vs_match.group(1).strip()
            team_b = vs_match.group(2).strip()
            # Split CamelCase
            team_a = split_camel_case(team_a)
            team_b = split_camel_case(team_b)
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
    
    # Map Greek keys to English
    greek_to_english = {
        'πελάτης': 'client',
        'διοργάνωση': 'competition',
        'άθλημα': 'sport',
        'ημερομηνία': 'date_start',
        'σημειώσεις': 'notes',
        'αθλητής': 'athlete',  # athlete
        'γεγονός': 'event',  # event
    }
    
    stem = xlsx_path.stem
    parent = xlsx_path.parent
    
    # Try .txt first
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
                        
                        # Map Greek to English
                        if key in greek_to_english:
                            key = greek_to_english[key]
                        
                        if value:
                            metadata[key] = value
            
            metadata['_sidecar_path'] = txt_path
        except Exception as e:
            print(f"Warning: Could not read sidecar {txt_path.name}: {e}")
    
    # Try .json
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
    Extract source clip names from FilesTable at F2:F in Summary sheet.
    Returns list of clip names (skips header).
    """
    clips = []
    
    if not sheet:
        return clips
    
    try:
        # FilesTable starts at F2 (header), data at F3+
        for row in sheet.iter_rows(min_row=3, min_col=6, max_col=6, values_only=True):
            if row[0] and isinstance(row[0], str) and row[0].strip():
                clip_name = row[0].strip()
                # Skip if it looks like a header
                if clip_name.lower() not in ['clip', 'clips', 'file', 'files', 'filename']:
                    clips.append(clip_name)
    except Exception as e:
        print(f"Warning: Could not extract source clips: {e}")
    
    return clips


def find_sheet(wb, names):
    """Find a sheet by one of several possible names (case-insensitive)"""
    for name in names:
        for sheet_name in wb.sheetnames:
            if sheet_name.lower() == name.lower():
                return wb[sheet_name]
    return None


def parse_summary_sheet(sheet):
    """
    Parse Summary sheet: Brand_Assets table at B2:D170
    B=Brands, C=Assets, D=Example found (1/0)
    """
    result = {
        'brands': [],
        'locations': [],
        'combinations': []
    }
    
    rows = list(sheet.iter_rows(values_only=True))
    if len(rows) < 3:
        return result
    
    # Header at row 2 (index 1), data starts at row 3 (index 2)
    seen_brands = set()
    seen_locations = set()
    
    for r_idx in range(2, len(rows)):  # Start from row 3 (index 2)
        row = rows[r_idx]
        if len(row) < 4:
            continue
        
        brand_value = row[1]  # Column B (index 1)
        asset_value = row[2]  # Column C (index 2)
        example_found = row[3]  # Column D (index 3)
        
        # Skip if brand is empty or None
        if brand_value is None or brand_value == '':
            continue
        
        # Convert numeric brands to strings (e.g., 947 → "947")
        if isinstance(brand_value, (int, float)):
            brand_name = str(int(brand_value)) if float(brand_value).is_integer() else str(brand_value)
        else:
            brand_name = str(brand_value).strip()
        
        # Skip if asset is empty
        if asset_value is None or asset_value == '':
            continue
        
        asset_name = str(asset_value).strip()
        
        # Add brand if new
        if brand_name not in seen_brands:
            result['brands'].append(brand_name)
            seen_brands.add(brand_name)
        
        # Add location if new
        if asset_name not in seen_locations:
            result['locations'].append(asset_name)
            seen_locations.add(asset_name)
        
        # Add combination
        result['combinations'].append({
            'brand': brand_name,
            'location': asset_name,
            'auto_closed': False
        })
    
    return result


def extract_images_from_zip(filepath):
    """
    Extract images and their metadata directly from the .xlsx ZIP structure.
    Returns dict mapping media filenames to their binary data.
    """
    images_data = {}
    
    try:
        with zipfile.ZipFile(filepath, 'r') as zf:
            # Get all media files
            for name in zf.namelist():
                if name.startswith('xl/media/') and not name.endswith('/'):
                    # Extract image
                    img_data = zf.read(name)
                    filename = Path(name).name
                    images_data[name] = img_data
    except Exception as e:
        print(f"Warning: Could not read ZIP structure: {e}")
    
    return images_data


def parse_drawing_xml(zf, drawing_num):
    """
    Parse xl/drawings/drawingN.xml to get image references and anchors.
    Returns list of {media_ref, from_col, from_row, ...}
    """
    placements = []
    
    try:
        drawing_path = f'xl/drawings/drawing{drawing_num}.xml'
        if drawing_path not in zf.namelist():
            return placements
        
        xml_content = zf.read(drawing_path)
        root = ET.fromstring(xml_content)
        
        # Namespaces
        ns = {
            'xdr': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
            'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
            'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
        }
        
        # Find all two-cell anchors with pictures
        for anchor in root.findall('.//xdr:twoCellAnchor', ns):
            # Get from position
            from_elem = anchor.find('xdr:from', ns)
            if from_elem is not None:
                from_col = from_elem.findtext('xdr:col', '0', ns)
                from_row = from_elem.findtext('xdr:row', '0', ns)
                
                # Get pic reference
                pic = anchor.find('.//xdr:pic', ns)
                if pic is not None:
                    blipFill = pic.find('.//xdr:blipFill', ns)
                    if blipFill is not None:
                        blip = blipFill.find('a:blip', ns)
                        if blip is not None:
                            embed_id = blip.get('{' + ns['r'] + '}embed')
                            if embed_id:
                                placements.append({
                                    'embed_id': embed_id,
                                    'from_col': int(from_col),
                                    'from_row': int(from_row)
                                })
    except Exception as e:
        print(f"Warning: Could not parse drawing{drawing_num}.xml: {e}")
    
    return placements


def parse_drawing_rels(zf, drawing_num):
    """
    Parse xl/drawings/_rels/drawingN.xml.rels to map embed IDs to media files.
    Returns dict {embed_id: media_path}
    """
    id_to_media = {}
    
    try:
        rels_path = f'xl/drawings/_rels/drawing{drawing_num}.xml.rels'
        if rels_path not in zf.namelist():
            return id_to_media
        
        xml_content = zf.read(rels_path)
        root = ET.fromstring(xml_content)
        
        for rel in root.findall('.//{http://schemas.openxmlformats.org/package/2006/relationships}Relationship'):
            rel_id = rel.get('Id')
            target = rel.get('Target')
            if rel_id and target:
                # Normalize path (target is relative like ../media/image1.jpeg)
                media_path = 'xl/' + target.replace('../', '')
                id_to_media[rel_id] = media_path
    except Exception as e:
        print(f"Warning: Could not parse drawing{drawing_num} rels: {e}")
    
    return id_to_media


def parse_annotations_shapes(filepath):
    """
    Parse Annotations sheet drawing shapes to extract stroke colors.
    Returns list of {color, type} where color is hex like #00B050
    """
    annotations = []
    
    try:
        with zipfile.ZipFile(filepath, 'r') as zf:
            # Find the annotations drawing (need to map sheet to drawing number)
            # For now, try common drawing numbers
            for draw_num in range(1, 15):
                drawing_path = f'xl/drawings/drawing{draw_num}.xml'
                if drawing_path not in zf.namelist():
                    continue
                
                xml_content = zf.read(drawing_path)
                root = ET.fromstring(xml_content)
                
                ns = {
                    'xdr': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
                    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'
                }
                
                # Look for shapes (rectangles)
                for shape in root.findall('.//xdr:sp', ns):
                    # Get stroke color from ln > solidFill > srgbClr
                    sp_pr = shape.find('.//xdr:spPr', ns)
                    if sp_pr is not None:
                        ln = sp_pr.find('a:ln', ns)
                        if ln is not None:
                            solidFill = ln.find('a:solidFill', ns)
                            if solidFill is not None:
                                srgbClr = solidFill.find('a:srgbClr', ns)
                                if srgbClr is not None:
                                    color = srgbClr.get('val')
                                    if color:
                                        # Map color to type
                                        color_upper = color.upper()
                                        if color_upper == '00B050':
                                            ann_type = 'include'
                                        elif color_upper == 'FF0000':
                                            ann_type = 'exclude'
                                        elif color_upper == 'FFC000':
                                            ann_type = 'variant'
                                        else:
                                            ann_type = 'include'  # default
                                        
                                        annotations.append({
                                            'color': '#' + color.upper(),
                                            'type': ann_type
                                        })
    except Exception as e:
        print(f"Warning: Could not parse annotation shapes: {e}")
    
    return annotations


def parse_brand_sheets(wb, filepath, brands, brief_dir):
    """
    Parse brand sheets for example images.
    Uses ZIP parsing to get images with anchors.
    """
    images = []
    
    try:
        with zipfile.ZipFile(filepath, 'r') as zf:
            # Get all media
            media_data = {}
            for name in zf.namelist():
                if name.startswith('xl/media/'):
                    media_data[name] = zf.read(name)
            
            # Map sheet names to drawing numbers by parsing workbook.xml.rels
            sheet_to_drawing = {}
            wb_rels_path = 'xl/_rels/workbook.xml.rels'
            if wb_rels_path in zf.namelist():
                wb_rels_xml = zf.read(wb_rels_path)
                wb_rels_root = ET.fromstring(wb_rels_xml)
                
                # Also need sheet order from workbook.xml
                wb_path = 'xl/workbook.xml'
                if wb_path in zf.namelist():
                    wb_xml = zf.read(wb_path)
                    wb_root = ET.fromstring(wb_xml)
                    
                    ns_wb = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                    sheets_elem = wb_root.find('main:sheets', ns_wb)
                    if sheets_elem is not None:
                        sheet_id_to_name = {}
                        for sheet_elem in sheets_elem.findall('main:sheet', ns_wb):
                            sheet_name = sheet_elem.get('name')
                            sheet_id = sheet_elem.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
                            if sheet_name and sheet_id:
                                sheet_id_to_name[sheet_id] = sheet_name
                        
                        # Map sheet IDs to drawing paths
                        ns_rels = {'r': 'http://schemas.openxmlformats.org/package/2006/relationships'}
                        for rel in wb_rels_root.findall('r:Relationship', ns_rels):
                            rel_id = rel.get('Id')
                            target = rel.get('Target')
                            if rel_id in sheet_id_to_name and target:
                                sheet_name = sheet_id_to_name[rel_id]
                                # This gives us worksheets/sheetN.xml
                                # We need to look in worksheets/_rels/sheetN.xml.rels for drawings
            
            # Simpler approach: iterate through each brand sheet and try to find its drawings
            for brand_idx, brand_name in enumerate(brands):
                try:
                    sheet = find_sheet(wb, [brand_name])
                    if not sheet:
                        continue
                    
                    # Try to find the worksheet number for this sheet
                    sheet_num = wb.sheetnames.index(sheet.title) + 1
                    
                    # Look for corresponding drawing rels
                    ws_rels_path = f'xl/worksheets/_rels/sheet{sheet_num}.xml.rels'
                    if ws_rels_path not in zf.namelist():
                        continue
                    
                    ws_rels_xml = zf.read(ws_rels_path)
                    ws_rels_root = ET.fromstring(ws_rels_xml)
                    
                    # Find drawing relationship
                    drawing_num = None
                    ns_rels = {'r': 'http://schemas.openxmlformats.org/package/2006/relationships'}
                    for rel in ws_rels_root.findall('r:Relationship', ns_rels):
                        target = rel.get('Target')
                        if target and 'drawing' in target:
                            # Extract number from ../drawings/drawing1.xml
                            match = re.search(r'drawing(\d+)\.xml', target)
                            if match:
                                drawing_num = int(match.group(1))
                                break
                    
                    if drawing_num is None:
                        continue
                    
                    # Parse the drawing XML to get placements
                    placements = parse_drawing_xml(zf, drawing_num)
                    id_to_media = parse_drawing_rels(zf, drawing_num)
                    
                    # Get sheet data to find asset names
                    rows = list(sheet.iter_rows(values_only=True))
                    
                    # Process each placement
                    for idx, placement in enumerate(placements):
                        embed_id = placement['embed_id']
                        from_row = placement['from_row']
                        from_col = placement['from_col']
                        
                        # Get media path
                        if embed_id not in id_to_media:
                            continue
                        
                        media_path = id_to_media[embed_id]
                        if media_path not in media_data:
                            continue
                        
                        # Save image
                        img_binary = media_data[media_path]
                        extension = Path(media_path).suffix.lower().replace('.', '') or 'jpg'
                        filename = f"{brand_name.lower().replace(' ', '_')}_{idx}.{extension}"
                        filepath_out = brief_dir / filename
                        
                        try:
                            # Save with PIL to ensure consistent format
                            img = Image.open(BytesIO(img_binary))
                            img.save(filepath_out, format='PNG')
                            
                            # Try to find location name from row
                            location_name = None
                            if from_row < len(rows):
                                row_data = rows[from_row]
                                # Asset is in column C (index 2) based on brand sheet structure
                                if len(row_data) > 3:
                                    asset_val = row_data[3]  # Column D (Asset)
                                    if asset_val:
                                        location_name = str(asset_val).strip()
                            
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


def parse_annotations_images(filepath, brief_dir):
    """
    Parse Annotations sheet images and shapes.
    """
    annotation_images = []
    
    try:
        with zipfile.ZipFile(filepath, 'r') as zf:
            # Get shape colors first
            shape_annotations = parse_annotations_shapes(filepath)
            
            # Find Annotations sheet drawing
            # Try to locate it (usually one of the early drawings)
            for draw_num in range(1, 5):
                placements = parse_drawing_xml(zf, draw_num)
                if not placements:
                    continue
                
                id_to_media = parse_drawing_rels(zf, draw_num)
                
                # Get media data
                media_data = {}
                for name in zf.namelist():
                    if name.startswith('xl/media/'):
                        media_data[name] = zf.read(name)
                
                # Check if this looks like annotations (multiple images)
                if len(placements) >= 5:  # Annotations has 7 images
                    for idx, placement in enumerate(placements):
                        embed_id = placement['embed_id']
                        
                        if embed_id not in id_to_media:
                            continue
                        
                        media_path = id_to_media[embed_id]
                        if media_path not in media_data:
                            continue
                        
                        # Save image
                        img_binary = media_data[media_path]
                        extension = Path(media_path).suffix.lower().replace('.', '') or 'jpg'
                        filename = f"annotation_{idx}.{extension}"
                        filepath_out = brief_dir / filename
                        
                        try:
                            img = Image.open(BytesIO(img_binary))
                            img.save(filepath_out, format='PNG')
                            
                            # Assign annotation type (cycle through detected colors)
                            if idx < len(shape_annotations):
                                ann_type = shape_annotations[idx]['type']
                            else:
                                ann_type = 'include'
                            
                            annotation_images.append({
                                'type': 'annotation',
                                'filename': filename,
                                'annotation_type': ann_type,
                                'sort_order': len(annotation_images)
                            })
                        except Exception as e:
                            print(f"Warning: Could not save annotation image {idx}: {e}")
                            continue
                    
                    break  # Found annotations sheet
    
    except Exception as e:
        print(f"Warning: Error in parse_annotations_images: {e}")
    
    return annotation_images


def process_excel_file(filepath, output_dir):
    """Process a single Excel file and create brief package"""
    print(f"Processing: {filepath.name}")
    
    try:
        # Load workbook
        wb = load_workbook(filepath, data_only=True)
        
        # Generate brief ID
        brief_id = generate_id()
        brief_dir = output_dir / brief_id
        brief_dir.mkdir(parents=True, exist_ok=True)
        
        # Parse Summary sheet
        summary_sheet = find_sheet(wb, ['Summary'])
        if summary_sheet:
            summary_data = parse_summary_sheet(summary_sheet)
        else:
            print(f"Warning: No Summary sheet found")
            summary_data = {'brands': [], 'locations': [], 'combinations': []}
        
        # Parse brand sheets for example images
        images = parse_brand_sheets(wb, filepath, summary_data['brands'], brief_dir)
        
        # Parse Annotations sheet
        annotation_images = parse_annotations_images(filepath, brief_dir)
        
        # Extract source clips from FilesTable
        source_clips = extract_source_clips(summary_sheet)
        
        # Infer metadata from first clip name or filename
        inferred_metadata = {}
        if source_clips:
            inferred_metadata = parse_clip_name(source_clips[0])
        if not inferred_metadata:
            # Fallback to filename
            inferred_metadata = parse_clip_name(filepath.stem)
        
        # Read optional sidecar file
        sidecar_metadata = read_sidecar_file(filepath)
        sidecar_path = sidecar_metadata.pop('_sidecar_path', None)
        
        # Build brief data with inferred values
        brief_data = {
            'id': brief_id,
            'client': '',  # Empty string instead of 'Unknown'
            'event': inferred_metadata.get('event', filepath.stem),
            'competition': None,
            'sport': None,
            'broadcaster': inferred_metadata.get('broadcaster'),
            'date_start': inferred_metadata.get('date_start'),
            'date_end': None,
            'notes': None,
            'rules': None,
            'source_clips': source_clips if source_clips else None,
            'brands': summary_data['brands'],
            'locations': summary_data['locations'],
            'combinations': summary_data['combinations'],
            'images': images,
            'annotation_images': annotation_images,
            'created_at': datetime.now().isoformat()
        }
        
        # Override with sidecar values
        for key in ['client', 'event', 'competition', 'sport', 'date_start', 'date_end', 'broadcaster', 'notes', 'rules']:
            if key in sidecar_metadata:
                brief_data[key] = sidecar_metadata[key]
        
        # Delete sidecar file after processing
        if sidecar_path and sidecar_path.exists():
            try:
                sidecar_path.unlink()
                print(f"✓ Deleted sidecar file: {sidecar_path.name}")
            except Exception as e:
                print(f"Warning: Could not delete sidecar {sidecar_path.name}: {e}")
        
        # Save brief.json
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
    
    excel_files = list(inbox_dir.glob('*.xlsx')) + list(inbox_dir.glob('*.xls'))
    
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


if __name__ == '__main__':
    main()
