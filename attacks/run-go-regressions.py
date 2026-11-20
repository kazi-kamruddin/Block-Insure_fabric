#!/usr/bin/env python3
"""Run the existing Go suites and defensive regression assertions offline."""

import argparse
import collections
import json
import os
from pathlib import Path
import subprocess
import sys


def run_suite(go, module, log):
    counts = collections.Counter()
    packages = collections.Counter()
    env = dict(os.environ, GOTOOLCHAIN="local", GOPROXY="off", GOSUMDB="off", GOMAXPROCS="2", GOWORK="off")
    command = [str(go), "test", "-mod=vendor", "-p=2", "-count=1", "-json", "./..."]
    with log.open("w", encoding="utf-8") as capture:
        with subprocess.Popen(command, cwd=module, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              encoding="utf-8", errors="replace") as process:
            for line in process.stdout:
                capture.write(line)
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                action = event.get("Action")
                if action in {"pass", "fail", "skip"}:
                    name = event.get("Test")
                    if name:
                        group = "subtests" if "/" in name else "tests"
                        counts[group, action] += 1
                    else:
                        packages[action] += 1
            result = process.wait()
    return {
        "exitCode": result,
        "tests": {action: counts["tests", action] for action in ("pass", "fail", "skip")},
        "subtests": {action: counts["subtests", action] for action in ("pass", "fail", "skip")},
        "packages": {action: packages[action] for action in ("pass", "fail", "skip")},
        "log": log.name,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--go", required=True, type=Path, help="Path to the verified Go executable")
    parser.add_argument("--baseline", required=True, type=Path, help="Insurance module in the baseline Git worktree")
    parser.add_argument("--before", required=True, type=Path, help="Current insurance module before adding regressions")
    parser.add_argument("--after", required=True, type=Path, help="Current insurance module with regressions")
    parser.add_argument("--logs", required=True, type=Path, help="Directory for raw JSON logs and counts")
    args = parser.parse_args()
    for module in (args.baseline, args.before, args.after):
        if not (module / "go.mod").is_file() or not (module / "vendor/modules.txt").is_file():
            parser.error(f"Expected a Go module and verified vendor tree in {module}")
    args.logs.mkdir(parents=True, exist_ok=True)
    version = subprocess.check_output([str(args.go.resolve()), "version"], text=True).strip()
    summary = {"scope": "synthetic, one host, unit-level", "toolchain": version, "suites": {}}
    for name, module in (("baseline", args.baseline), ("currentBefore", args.before), ("currentAfter", args.after)):
        result = run_suite(args.go.resolve(), module.resolve(), args.logs / f"{name}.jsonl")
        summary["suites"][name] = result
        (args.logs / "counts.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        print(name, json.dumps(result), flush=True)
        if result["exitCode"]:
            return result["exitCode"]
    return 0


if __name__ == "__main__":
    sys.exit(main())
