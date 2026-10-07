#!/usr/bin/env python3
"""Operator entry point for the separately maintained, read-only scanner."""
from pathlib import Path
import subprocess
import sys

component = Path(__file__).resolve().parents[1] / "security" / "zoer-wordpress-security"
if not (component / "zoer_wp_security" / "__main__.py").is_file():
    raise SystemExit("Initialize the scanner: git submodule update --init security/zoer-wordpress-security")
raise SystemExit(subprocess.call([sys.executable, "-m", "zoer_wp_security", *sys.argv[1:]], cwd=component))
