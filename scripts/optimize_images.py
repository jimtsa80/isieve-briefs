#!/usr/bin/env python3
"""
Optimize images in an existing brief folder.
Creates thumbnails and optimizes full-size images.
Idempotent - safe to run multiple times.
Never leaves brief.json references pointing at missing files.
Picks unique output names when a target filename is already used.
"""

import json
import sys
from pathlib import Path
from PIL import Image
import argparse


def optimize_image(input_path, output_path, max_size, quality, strip_exif=True):
    """
    Optimize and resize an image.

    Args:
        input_path: Path to input image
        output_path: Path to save optimized image
        max_size: Maximum dimension (width or height)
        quality: JPEG quality (1-100)
        strip_exif: Whether to strip EXIF data
    """
    img = Image.open(input_path)

    # Convert RGBA to RGB if needed (for JPEG)
    if img.mode in ('RGBA', 'LA', 'P'):
        # Check if image actually uses transparency
        if img.mode == 'RGBA':
            # Check if alpha channel has any transparency
            extrema = img.getextrema()
            if len(extrema) >= 4 and extrema[3][0] < 255:
                # Has transparency, keep as PNG
                output_path = Path(output_path).with_suffix('.png')
                img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                img.save(output_path, 'PNG', optimize=True)
                return str(output_path)

        # No transparency, convert to RGB
        background = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
        img = background

    # Convert to RGB if needed
    if img.mode != 'RGB':
        img = img.convert('RGB')

    # Resize if larger than max_size
    if img.width > max_size or img.height > max_size:
        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

    # Ensure output is JPEG
    output_path = Path(output_path).with_suffix('.jpg')

    # Save as progressive JPEG
    img.save(output_path, 'JPEG', quality=quality, optimize=True, progressive=True)

    return str(output_path)


def next_available_path(path, used_names, allow_overwrite=None):
    """
    Return a Path near `path` whose name is not in used_names and does not
    already exist, unless it is allow_overwrite (the source file being replaced).
    """
    path = Path(path)
    parent = path.parent
    stem = path.stem
    suffix = path.suffix
    allow = Path(allow_overwrite).resolve() if allow_overwrite is not None else None

    i = 0
    while True:
        candidate = parent / (f"{stem}{suffix}" if i == 0 else f"{stem}_{i}{suffix}")
        i += 1
        if candidate.name in used_names:
            continue
        if candidate.exists():
            if allow is None or candidate.resolve() != allow:
                continue
        used_names.add(candidate.name)
        return candidate


def resolve_existing_image(brief_folder, filename):
    """Return an existing Path for filename, trying a jpg sibling if the listed file is missing."""
    brief_folder = Path(brief_folder)
    img_path = brief_folder / filename
    if img_path.exists():
        return img_path
    alt = img_path.with_suffix('.jpg')
    if alt != img_path and alt.exists():
        return alt
    alt_png = img_path.with_suffix('.png')
    if alt_png != img_path and alt_png.exists():
        return alt_png
    return None


def process_brief_folder(brief_folder):
    """Process all images in a brief folder."""
    brief_folder = Path(brief_folder)

    # Read brief.json
    brief_json_path = brief_folder / 'brief.json'
    if not brief_json_path.exists():
        print(f"Error: {brief_json_path} not found")
        return False

    with open(brief_json_path, 'r', encoding='utf-8') as f:
        brief_data = json.load(f)

    # Create thumbs directory
    thumbs_dir = brief_folder / 'thumbs'
    thumbs_dir.mkdir(exist_ok=True)

    used_full = set()
    used_thumbs = set()

    # Reserve names already kept by previously optimized entries whose files exist
    for img_list_name in ['images', 'annotation_images']:
        for img in brief_data.get(img_list_name, []):
            filename = img.get('filename')
            if not filename:
                continue
            existing = resolve_existing_image(brief_folder, filename)
            if existing and img.get('thumbnail') and (brief_folder / img['thumbnail']).exists():
                used_full.add(existing.name)
                used_thumbs.add(Path(img['thumbnail']).name)

    # Process images and annotation_images
    for img_list_name in ['images', 'annotation_images']:
        images = brief_data.get(img_list_name, [])
        kept = []

        for img in images:
            filename = img.get('filename')
            if not filename:
                print("Warning: image entry has no filename, dropping")
                continue

            img_path = resolve_existing_image(brief_folder, filename)
            if img_path is None:
                print(f"Warning: {brief_folder / filename} not found, dropping missing reference")
                continue

            # Already optimized and both files present: keep as-is (update filename if we resolved a sibling)
            thumb_rel = img.get('thumbnail')
            thumb_ok = bool(thumb_rel) and (brief_folder / thumb_rel).exists()
            if thumb_ok:
                if img['filename'] != img_path.name:
                    print(f"Updating missing {filename} -> existing {img_path.name}")
                    img['filename'] = img_path.name
                used_full.add(img_path.name)
                used_thumbs.add(Path(thumb_rel).name)
                kept.append(img)
                continue

            print(f"Processing {img_path.name}...")

            try:
                thumb_target = next_available_path(
                    thumbs_dir / f"thumb_{img_path.stem}.jpg",
                    used_thumbs,
                )
                # Release the reservation so optimize_image can write; re-reserve the actual name after.
                used_thumbs.discard(thumb_target.name)
                actual_thumb = Path(optimize_image(img_path, thumb_target, max_size=480, quality=70))
                if actual_thumb.name in used_thumbs:
                    unique_thumb = next_available_path(actual_thumb, used_thumbs)
                    if unique_thumb.resolve() != actual_thumb.resolve():
                        if unique_thumb.exists():
                            unique_thumb.unlink()
                        actual_thumb.rename(unique_thumb)
                        actual_thumb = unique_thumb
                else:
                    used_thumbs.add(actual_thumb.name)
                img['thumbnail'] = f"thumbs/{actual_thumb.name}"
                print(f"  Created thumbnail: {actual_thumb.name}")
            except Exception as e:
                print(f"  Error creating thumbnail: {e}")
                continue

            temp_path = img_path.with_name(f".{img_path.stem}_optimized{img_path.suffix}")
            try:
                if temp_path.exists():
                    temp_path.unlink()
                optimized_path = Path(optimize_image(img_path, temp_path, max_size=1600, quality=82))

                desired = img_path.with_suffix(optimized_path.suffix)
                final_path = next_available_path(desired, used_full, allow_overwrite=img_path)

                if img_path.exists() and img_path.resolve() != final_path.resolve():
                    img_path.unlink()
                if optimized_path.resolve() != final_path.resolve():
                    if final_path.exists():
                        final_path.unlink()
                    optimized_path.rename(final_path)

                img['filename'] = final_path.name
                print(f"  Optimized full-size image: {final_path.name}")
                kept.append(img)
            except Exception as e:
                print(f"  Error optimizing full-size: {e}")
                if temp_path.exists():
                    temp_path.unlink()
                # Keep the original if it still exists so we do not invent a missing ref
                if img_path.exists():
                    img['filename'] = img_path.name
                    used_full.add(img_path.name)
                    kept.append(img)
                else:
                    print(f"  Dropping {filename}: original missing after failed optimize")

        brief_data[img_list_name] = kept

    # Final safety pass: never leave missing refs
    for img_list_name in ['images', 'annotation_images']:
        cleaned = []
        for img in brief_data.get(img_list_name, []):
            filename = img.get('filename')
            if not filename or not (brief_folder / filename).exists():
                print(f"Warning: dropping stale reference {filename!r}")
                continue
            thumb = img.get('thumbnail')
            if thumb and not (brief_folder / thumb).exists():
                img.pop('thumbnail', None)
            cleaned.append(img)
        brief_data[img_list_name] = cleaned

    # Save updated brief.json
    with open(brief_json_path, 'w', encoding='utf-8') as f:
        json.dump(brief_data, f, indent=2, ensure_ascii=False)

    print(f"\n✓ Updated {brief_json_path}")
    return True


def main():
    parser = argparse.ArgumentParser(description='Optimize images in a brief folder')
    parser.add_argument('brief_folder', help='Path to brief folder (e.g. briefs/brief-20261123234432)')
    args = parser.parse_args()

    if not Path(args.brief_folder).is_dir():
        print(f"Error: {args.brief_folder} is not a directory")
        sys.exit(1)

    success = process_brief_folder(args.brief_folder)
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
