#!/usr/bin/env python3
"""
Rebuild the briefs/index.json file from all brief packages.
"""

import json
from pathlib import Path
from datetime import datetime


def collect_brief_summaries(briefs_dir):
    """Collect summary information from all briefs"""
    summaries = []
    
    # Find all brief directories
    for brief_dir in sorted(briefs_dir.iterdir()):
        if not brief_dir.is_dir() or brief_dir.name.startswith('.'):
            continue
        
        brief_json = brief_dir / 'brief.json'
        if not brief_json.exists():
            print(f"Warning: {brief_dir.name} has no brief.json")
            continue
        
        try:
            with open(brief_json, 'r', encoding='utf-8') as f:
                brief_data = json.load(f)
            
            # Create summary
            summary = {
                'id': brief_data.get('id', brief_dir.name),
                'client': brief_data.get('client', ''),
                'event': brief_data.get('event', ''),
                'competition': brief_data.get('competition'),
                'sport': brief_data.get('sport'),
                'date_start': brief_data.get('date_start'),
                'date_end': brief_data.get('date_end'),
                'brand_count': len(brief_data.get('brands', [])),
                'location_count': len(brief_data.get('locations', [])),
                'combination_count': len(brief_data.get('combinations', [])),
                'brands': brief_data.get('brands', []),
                'locations': brief_data.get('locations', []),
                'created_at': brief_data.get('created_at', datetime.now().isoformat())
            }
            
            summaries.append(summary)
            
        except Exception as e:
            print(f"Error reading {brief_json}: {e}")
            continue
    
    # Sort by creation date (newest first)
    summaries.sort(key=lambda x: x['created_at'], reverse=True)
    
    return summaries


def main():
    """Main function"""
    repo_root = Path(__file__).parent.parent
    briefs_dir = repo_root / 'briefs'
    index_file = briefs_dir / 'index.json'
    
    if not briefs_dir.exists():
        print("Error: briefs/ directory not found")
        return
    
    print("Rebuilding briefs index...")
    
    # Collect summaries
    summaries = collect_brief_summaries(briefs_dir)
    
    # Write index.json
    with open(index_file, 'w', encoding='utf-8') as f:
        json.dump(summaries, f, ensure_ascii=False, indent=2)
    
    print(f"✓ Index rebuilt with {len(summaries)} briefs")
    
    # Print summary
    if summaries:
        print("\nBriefs in library:")
        for s in summaries:
            print(f"  - {s['event']} ({s['client']})")


if __name__ == '__main__':
    main()
