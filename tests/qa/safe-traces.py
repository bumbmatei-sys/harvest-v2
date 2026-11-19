"""Keep only action metadata. Request, DOM, header and response data stay local."""
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile

safe_label = re.compile(r"[A-Za-z0-9_.:-]{1,120}\Z")


def run(source, destination):
    for archive in sorted(source.rglob("trace.zip")):
        target = destination / archive.parent.relative_to(source) / "trace-actions.jsonl"
        target.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(archive) as trace, target.open("w", encoding="utf8") as output:
            for entry in trace.namelist():
                if not entry.endswith(".trace") or entry.endswith(".network"):
                    continue
                for line in trace.read(entry).splitlines():
                    item = json.loads(line)
                    if item.get("type") not in ("before", "after"):
                        continue
                    action = {"type": item["type"]}
                    for key in ("callId", "apiName", "class", "method"):
                        value = item.get(key)
                        if isinstance(value, str) and safe_label.fullmatch(value):
                            action[key] = value
                    for key in ("startTime", "endTime"):
                        value = item.get(key)
                        if type(value) in (int, float):
                            action[key] = value
                    if item.get("error"):
                        action["failed"] = True
                    output.write(json.dumps(action) + "\n")


if __name__ == "__main__":
    run(Path(sys.argv[1]), Path(sys.argv[2]))
