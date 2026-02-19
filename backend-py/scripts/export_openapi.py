"""Export the FastAPI OpenAPI schema to a JSON file.

Usage:
    uv run python scripts/export_openapi.py [output_path]

Defaults to writing ../frontend/openapi.json relative to this script.
"""

import json
import sys
from pathlib import Path


def main() -> None:
    from voxpilot.main import app

    schema = app.openapi()

    default_output = Path(__file__).resolve().parent.parent.parent / "frontend" / "openapi.json"
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else default_output

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(schema, indent=2) + "\n")
    print(f"OpenAPI spec written to {output}")


if __name__ == "__main__":
    main()
