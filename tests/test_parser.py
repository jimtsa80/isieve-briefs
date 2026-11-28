#!/usr/bin/env python3
"""
Tests for process_inbox.py parser.
Ensures existing formats still work and new validation catches errors.
"""

import os
import sys
import json
import tempfile
import shutil
from pathlib import Path

# Add parent directory to path to import scripts
sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))

from openpyxl import Workbook
from openpyxl.drawing.image import Image as OpenpyxlImage
from PIL import Image
import io
import process_inbox


def create_minimal_test_workbook():
    """Create a minimal valid test workbook with brands and locations."""
    wb = Workbook()
    
    # Remove default sheet
    if 'Sheet' in wb.sheetnames:
        wb.remove(wb['Sheet'])
    
    # Create Summary sheet with Brand_Assets table
    summary = wb.create_sheet('Summary')
    
    # Headers (row 2, columns B-E)
    summary['B1'] = 'Brand'
    summary['C1'] = 'Asset'
    summary['D1'] = 'Example'
    summary['E1'] = 'Notes'
    
    # Data rows (starting from row 3 per parser expectation - row 2 is headers)
    summary['B3'] = 'Brand A'
    summary['C3'] = 'Location 1'
    summary['D3'] = 'x'
    
    summary['B4'] = 'Brand A'
    summary['C4'] = 'Location 2'
    summary['D4'] = 'x'
    
    summary['B5'] = 'Brand B'
    summary['C5'] = 'Location 1'
    summary['D5'] = 'x'
    
    summary['B6'] = 'Brand B'
    summary['C6'] = 'Location 3'
    summary['D6'] = 'x'
    
    return wb


def create_empty_brands_workbook():
    """Create a workbook with no brands (should fail validation)."""
    wb = Workbook()
    
    # Remove default sheet
    if 'Sheet' in wb.sheetnames:
        wb.remove(wb['Sheet'])
    
    # Create Summary sheet but leave it empty
    summary = wb.create_sheet('Summary')
    summary['B1'] = 'Brand'
    summary['C1'] = 'Asset'
    # No data rows - should result in 0 brands
    
    return wb


def test_minimal_valid_brief():
    """Test that a minimal valid brief parses correctly."""
    print("\n=== Test: Minimal Valid Brief ===")
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        inbox_file = tmpdir / "test_brief.xlsx"
        output_dir = tmpdir / "output"
        output_dir.mkdir()
        
        # Create and save test workbook
        wb = create_minimal_test_workbook()
        wb.save(inbox_file)
        
        # Process the file
        success = process_inbox.process_excel_file(inbox_file, output_dir)
        
        if not success:
            print("❌ FAILED: Parser returned False")
            return False
        
        # Find the created brief
        brief_dirs = list(output_dir.glob("brief-*"))
        if len(brief_dirs) != 1:
            print(f"❌ FAILED: Expected 1 brief directory, found {len(brief_dirs)}")
            return False
        
        brief_dir = brief_dirs[0]
        brief_json_path = brief_dir / "brief.json"
        
        if not brief_json_path.exists():
            print("❌ FAILED: brief.json not created")
            return False
        
        # Load and validate the brief
        with open(brief_json_path, 'r') as f:
            brief_data = json.load(f)
        
        expected_brands = {'Brand A', 'Brand B'}
        expected_locations = {'Location 1', 'Location 2', 'Location 3'}
        
        actual_brands = set(brief_data['brands'])
        actual_locations = set(brief_data['locations'])
        
        if actual_brands != expected_brands:
            print(f"❌ FAILED: Brands mismatch")
            print(f"  Expected: {expected_brands}")
            print(f"  Got: {actual_brands}")
            return False
        
        if actual_locations != expected_locations:
            print(f"❌ FAILED: Locations mismatch")
            print(f"  Expected: {expected_locations}")
            print(f"  Got: {actual_locations}")
            return False
        
        if len(brief_data['combinations']) != 4:
            print(f"❌ FAILED: Expected 4 combinations, got {len(brief_data['combinations'])}")
            return False
        
        print("✅ PASSED")
        return True


def test_zero_brands_validation():
    """Test that a brief with 0 brands fails validation."""
    print("\n=== Test: Zero Brands Validation ===")
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        inbox_file = tmpdir / "test_no_brands.xlsx"
        output_dir = tmpdir / "output"
        output_dir.mkdir()
        
        # Create and save test workbook with no brands
        wb = create_empty_brands_workbook()
        wb.save(inbox_file)
        
        # Process the file - should fail
        success = process_inbox.process_excel_file(inbox_file, output_dir)
        
        if success:
            print("❌ FAILED: Parser should have returned False for 0 brands")
            return False
        
        # Verify no brief directory was created
        brief_dirs = list(output_dir.glob("brief-*"))
        if len(brief_dirs) != 0:
            print(f"❌ FAILED: Brief directory should not exist for failed validation, found {len(brief_dirs)}")
            return False
        
        print("✅ PASSED")
        return True


def test_existing_briefs_still_parse():
    """Test that existing briefs in the repo still parse correctly."""
    print("\n=== Test: Existing Briefs Compatibility ===")
    
    repo_root = Path(__file__).parent.parent
    briefs_dir = repo_root / 'briefs'
    
    if not briefs_dir.exists():
        print("⚠️  SKIPPED: briefs/ directory not found")
        return True
    
    # Count existing briefs
    brief_dirs = list(briefs_dir.glob("brief-*"))
    if len(brief_dirs) == 0:
        print("⚠️  SKIPPED: No existing briefs found")
        return True
    
    print(f"  Checking {len(brief_dirs)} existing briefs...")
    
    all_valid = True
    for brief_dir in brief_dirs:
        brief_json = brief_dir / "brief.json"
        if not brief_json.exists():
            continue
        
        try:
            with open(brief_json, 'r') as f:
                brief_data = json.load(f)
            
            # Verify critical fields exist
            if 'brands' not in brief_data:
                print(f"❌ FAILED: {brief_dir.name} missing 'brands' field")
                all_valid = False
                continue
            
            if 'locations' not in brief_data:
                print(f"❌ FAILED: {brief_dir.name} missing 'locations' field")
                all_valid = False
                continue
            
            if 'combinations' not in brief_data:
                print(f"❌ FAILED: {brief_dir.name} missing 'combinations' field")
                all_valid = False
                continue
            
            # Verify brands count > 0 for existing briefs
            brand_count = len(brief_data['brands'])
            if brand_count == 0:
                print(f"❌ FAILED: {brief_dir.name} has 0 brands (should not exist)")
                all_valid = False
                continue
            
        except Exception as e:
            print(f"❌ FAILED: {brief_dir.name} error reading: {e}")
            all_valid = False
            continue
    
    if all_valid:
        print(f"✅ PASSED: All {len(brief_dirs)} existing briefs are valid")
    else:
        print("❌ FAILED: Some existing briefs have issues")
    
    return all_valid


def test_tracked_brands_layout():
    """Test parsing of tracked_brands layout (URC2526 style)."""
    print("\n=== Test: Tracked Brands Layout ===")
    
    repo_root = Path(__file__).parent.parent
    fixture_path = repo_root / 'tests' / 'fixtures' / 'tracked_brands_layout.xlsx'
    
    if not fixture_path.exists():
        print("⚠️  SKIPPED: Fixture not found")
        return True
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        output_dir = tmpdir / 'output'
        output_dir.mkdir()
        
        success = process_inbox.process_excel_file(fixture_path, output_dir)
        
        if not success:
            print("❌ FAILED: Parser returned False")
            return False
        
        brief_dirs = list(output_dir.glob("brief-*"))
        if len(brief_dirs) != 1:
            print(f"❌ FAILED: Expected 1 brief directory, found {len(brief_dirs)}")
            return False
        
        brief_json_path = brief_dirs[0] / "brief.json"
        with open(brief_json_path, 'r') as f:
            brief_data = json.load(f)
        
        # Verify counts
        if len(brief_data['brands']) < 2:
            print(f"❌ FAILED: Expected at least 2 brands, got {len(brief_data['brands'])}")
            return False
        
        if len(brief_data['locations']) < 2:
            print(f"❌ FAILED: Expected at least 2 locations, got {len(brief_data['locations'])}")
            return False
        
        if len(brief_data['combinations']) < 1:
            print(f"❌ FAILED: Expected at least 1 combination, got {len(brief_data['combinations'])}")
            return False
        
        if len(brief_data['images']) < 1:
            print(f"❌ FAILED: Expected at least 1 image, got {len(brief_data['images'])}")
            return False
        
        print(f"  ✓ Brands: {len(brief_data['brands'])}")
        print(f"  ✓ Locations: {len(brief_data['locations'])}")
        print(f"  ✓ Combinations: {len(brief_data['combinations'])}")
        print(f"  ✓ Images: {len(brief_data['images'])}")
        print("✅ PASSED")
        return True


def test_overview_layout():
    """Test parsing of overview layout."""
    print("\n=== Test: Overview Layout ===")
    
    repo_root = Path(__file__).parent.parent
    fixture_path = repo_root / 'tests' / 'fixtures' / 'overview_layout.xlsx'
    
    if not fixture_path.exists():
        print("⚠️  SKIPPED: Fixture not found")
        return True
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        output_dir = tmpdir / 'output'
        output_dir.mkdir()
        
        success = process_inbox.process_excel_file(fixture_path, output_dir)
        
        if not success:
            print("❌ FAILED: Parser returned False")
            return False
        
        brief_dirs = list(output_dir.glob("brief-*"))
        if len(brief_dirs) != 1:
            print(f"❌ FAILED: Expected 1 brief directory, found {len(brief_dirs)}")
            return False
        
        brief_json_path = brief_dirs[0] / "brief.json"
        with open(brief_json_path, 'r') as f:
            brief_data = json.load(f)
        
        # Verify counts
        if len(brief_data['brands']) < 2:
            print(f"❌ FAILED: Expected at least 2 brands, got {len(brief_data['brands'])}")
            return False
        
        if len(brief_data['locations']) < 1:
            print(f"❌ FAILED: Expected at least 1 location, got {len(brief_data['locations'])}")
            return False
        
        if len(brief_data['combinations']) < 1:
            print(f"❌ FAILED: Expected at least 1 combination, got {len(brief_data['combinations'])}")
            return False
        
        if len(brief_data['images']) < 1:
            print(f"❌ FAILED: Expected at least 1 image, got {len(brief_data['images'])}")
            return False
        
        print(f"  ✓ Brands: {len(brief_data['brands'])}")
        print(f"  ✓ Locations: {len(brief_data['locations'])}")
        print(f"  ✓ Combinations: {len(brief_data['combinations'])}")
        print(f"  ✓ Images: {len(brief_data['images'])}")
        print("✅ PASSED")
        return True


def run_all_tests():
    """Run all tests and report results."""
    print("=" * 60)
    print("Running Brief Parser Tests")
    print("=" * 60)
    
    tests = [
        ("Minimal Valid Brief", test_minimal_valid_brief),
        ("Zero Brands Validation", test_zero_brands_validation),
        ("Tracked Brands Layout", test_tracked_brands_layout),
        ("Overview Layout", test_overview_layout),
        ("Existing Briefs Compatibility", test_existing_briefs_still_parse),
    ]
    
    results = []
    for name, test_func in tests:
        try:
            passed = test_func()
            results.append((name, passed))
        except Exception as e:
            print(f"❌ FAILED with exception: {e}")
            import traceback
            traceback.print_exc()
            results.append((name, False))
    
    print("\n" + "=" * 60)
    print("Test Results Summary")
    print("=" * 60)
    
    passed_count = sum(1 for _, passed in results if passed)
    total_count = len(results)
    
    for name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {name}")
    
    print("=" * 60)
    print(f"Total: {passed_count}/{total_count} tests passed")
    print("=" * 60)
    
    return passed_count == total_count


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)
