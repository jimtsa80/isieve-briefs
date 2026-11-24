#!/usr/bin/env python3
"""
Optimize images in an existing brief folder.
Creates thumbnails and optimizes full-size images.
Idempotent - safe to run multiple times.
"""

import json
import os
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
    
    # Process images and annotation_images
    for img_list_name in ['images', 'annotation_images']:
        images = brief_data.get(img_list_name, [])
        
        for img in images:
            filename = img['filename']
            img_path = brief_folder / filename
            
            if not img_path.exists():
                print(f"Warning: {img_path} not found, skipping")
                continue
            
            # Skip if already optimized (has thumbnail field)
            if 'thumbnail' in img:
                print(f"Skipping {filename} - already optimized")
                continue
            
            print(f"Processing {filename}...")
            
            # Create thumbnail
            thumb_filename = f"thumb_{Path(filename).stem}.jpg"
            thumb_path = thumbs_dir / thumb_filename
            
            try:
                actual_thumb = Path(optimize_image(img_path, thumb_path, max_size=480, quality=70))
                img['thumbnail'] = f"thumbs/{actual_thumb.name}"
                print(f"  Created thumbnail: {actual_thumb.name}")
            except Exception as e:
                print(f"  Error creating thumbnail: {e}")
                continue
            
            # Optimize full-size image
            temp_path = img_path.with_stem(img_path.stem + '_optimized')
            
            try:
                optimized_path = optimize_image(img_path, temp_path, max_size=1600, quality=82)
                optimized_path = Path(optimized_path)
                
                # Replace original with optimized
                img_path.unlink()
                optimized_path.rename(img_path.with_suffix(optimized_path.suffix))
                
                # Update filename in JSON if extension changed
                new_filename = img_path.with_suffix(optimized_path.suffix).name
                if new_filename != filename:
                    img['filename'] = new_filename
                    print(f"  Optimized and renamed: {new_filename}")
                else:
                    print(f"  Optimized full-size image")
                
            except Exception as e:
                print(f"  Error optimizing full-size: {e}")
                # Clean up temp file if it exists
                if temp_path.exists():
                    temp_path.unlink()
    
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
