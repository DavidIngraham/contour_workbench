"""Refresh native printer/PLA baselines from the pinned PrusaSlicer release.

Usage: python3 web/scripts/update-prusa-profiles.py [PrusaResearch.ini]
The optional local input must match the pinned upstream file digest.
"""

import configparser
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

SOURCE = "https://raw.githubusercontent.com/prusa3d/PrusaSlicer/version_2.9.6/resources/profiles/PrusaResearch.ini"
SHA256 = "a6155d92471d3b0ae11bed051bb04a4c1157fd6b05fef22416eafd12bce9c839"


def main():
    data = Path(sys.argv[1]).read_bytes() if len(sys.argv) > 1 else urllib.request.urlopen(SOURCE).read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        raise ValueError("Upstream profile digest changed; review before updating the pinned baseline")
    parser = configparser.RawConfigParser(strict=False, delimiters=("=",))
    parser.read_string(data.decode("utf-8-sig"))

    def flatten(section, chain=()):
        if section in chain:
            raise ValueError(f"Cyclic profile inheritance: {section}")
        own = dict(parser.items(section))
        result = {}
        kind = section.split(":", 1)[0]
        for parent in own.pop("inherits", "").split(";"):
            if parent.strip():
                result.update(flatten(f"{kind}:{parent.strip()}", (*chain, section)))
        result.update(own)
        return result

    profiles = {}
    for printer_id, name in (("mk4s", "Original Prusa MK4S"), ("core-one", "Prusa CORE One")):
        for material_mode in ("manual", "mmu3"):
            for variant in ("0.25", "0.3", "0.4", "0.5", "0.6", "0.8", "HF0.4", "HF0.5", "HF0.6", "HF0.8"):
                printer_name = f"{name}{' MMU3' if material_mode == 'mmu3' else ''} {variant} nozzle"
                if f"printer:{printer_name}" not in parser:
                    continue
                printer = flatten(f"printer:{printer_name}")
                print_name = printer["default_print_profile"]
                filament_name = printer["default_filament_profile"].strip('"')
                config = {
                    **flatten(f"print:{print_name}"),
                    **flatten(f"filament:{filament_name}"),
                    **printer,
                    "print_settings_id": print_name,
                    "printer_settings_id": printer_name,
                    "filament_settings_id": filament_name,
                }
                config = {key: value for key, value in config.items()
                          if not key.startswith("compatible_") and key not in (
                              "renamed_from", "alias", "octoprint_apikey", "octoprint_host",
                              "serial_port", "serial_speed", "print_host", "printhost_apikey")}
                profiles[f"{printer_id}/{material_mode}/{variant}"] = config
    target = Path(__file__).resolve().parents[1] / "src" / "prusa-profiles.json"
    target.write_text(json.dumps({"source": SOURCE, "sha256": digest, "profiles": profiles}, indent=2) + "\n")
    print(f"Wrote {len(profiles)} native baselines to {target}")


if __name__ == "__main__":
    main()
