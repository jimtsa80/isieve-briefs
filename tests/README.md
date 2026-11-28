# Brief Parser Tests

Test suite for the Excel brief parser (`process_inbox.py`).

## Running Tests

```bash
python tests/test_parser.py
```

## Test Cases

### 1. Minimal Valid Brief
Creates a synthetic Excel file with the minimum required data:
- Summary sheet with Brand_Assets table
- 2 brands, 3 locations, 4 combinations
- Verifies the parser extracts all data correctly

### 2. Zero Brands Validation
Creates an Excel file with an empty Summary sheet (0 brands).
- Verifies the parser **fails** with a clear error message
- Ensures no brief directory is created for invalid files
- Tests the validation added to prevent 0-brand briefs

### 3. Existing Briefs Compatibility
Validates all existing briefs in `briefs/` directory:
- Checks that all brief.json files are valid JSON
- Verifies required fields exist (brands, locations, combinations)
- Ensures no brief has 0 brands (would indicate a past parser bug)

## CI Integration

Tests run automatically in GitHub Actions before processing inbox files.
See `.github/workflows/process-briefs.yml`.

## Adding New Tests

To add a new test:

1. Create a function `test_your_feature()` that returns `True` on success
2. Add it to the `tests` list in `run_all_tests()`
3. Use `create_*_workbook()` helpers or create new fixtures

Example:

```python
def test_your_feature():
    """Test description."""
    print("\n=== Test: Your Feature ===")
    
    # Test logic here
    
    if test_passed:
        print("✅ PASSED")
        return True
    else:
        print("❌ FAILED: reason")
        return False
```

## Dependencies

Same as main scripts:
- openpyxl
- Pillow

## Notes

- Tests use temporary directories (automatically cleaned up)
- Tests create minimal synthetic Excel files (not 57 MB uploads)
- Each test is independent and can run in any order
