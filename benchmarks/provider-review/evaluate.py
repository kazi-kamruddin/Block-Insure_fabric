"""Compare two provider-level review models on the fixed local claims CSVs."""
import argparse
from collections import defaultdict
import csv
from datetime import date
import hashlib
import json
import math
from pathlib import Path

CUTOFF = "2009-10-01"
BUDGET = 0.20
SCALE = 10**6
FEATURES = ("log_claim_count", "mean_log_reimbursement", "inpatient_share",
            "mean_duration_days", "documented_positive_deductible_share", "unique_beneficiary_share")


def partition(provider):
    value = int(hashlib.sha256(("provider-review-v1:" + provider).encode()).hexdigest()[:8], 16) % 100
    return "train" if value < 64 else "calibration" if value < 72 else "conformal" if value < 80 else "test"


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        yield from csv.DictReader(stream)


def load(directory):
    labels = {row["Provider"]: int(row["PotentialFraud"] == "Yes")
              for row in read_csv(directory / "Train-1542865627584.csv")}
    aggregates = defaultdict(lambda: [0, 0.0, 0, 0, 0, set()])
    beneficiaries = defaultdict(set)
    partitions = {provider: partition(provider) for provider in labels}
    for setting in ("Inpatient", "Outpatient"):
        for row in read_csv(directory / f"Train_{setting}data-1542865627584.csv"):
            if row["ClaimEndDt"] >= CUTOFF:
                continue
            provider = row["Provider"]
            counts = aggregates[provider]
            counts[0] += 1
            counts[1] += math.log1p(max(0, int(row["InscClaimAmtReimbursed"])))
            counts[2] += setting == "Inpatient"
            counts[3] += (date.fromisoformat(row["ClaimEndDt"]) - date.fromisoformat(row["ClaimStartDt"])).days
            deductible = row["DeductibleAmtPaid"]
            counts[4] += deductible not in ("", "NA") and float(deductible) > 0
            counts[5].add(row["BeneID"])
            beneficiaries[partitions[provider]].add(row["BeneID"])
    splits = defaultdict(list)
    for provider, (n, dollars, inpatient, days, deductible, patients) in sorted(aggregates.items()):
        features = [math.log1p(n), dollars/n, inpatient/n, days/n, deductible/n, len(patients)/n]
        splits[partitions[provider]].append((provider, labels[provider], features))
    names = sorted(splits)
    overlap = {f"{a}/{b}": len(beneficiaries[a] & beneficiaries[b])
               for i, a in enumerate(names) for b in names[i+1:]}
    return splits, overlap


def sigmoid(x):
    return 1 / (1 + math.exp(-max(-35, min(35, x))))


def margin(weights, vector):
    return weights[0] + sum(w*x for w, x in zip(weights[1:], vector, strict=True))


def fit(examples, positive_slope=False):
    weights = [0.0] * (len(examples[0][0]) + 1)
    for _ in range(300):
        gradient = [0.0] * len(weights)
        for x, y in examples:
            error = sigmoid(margin(weights, x)) - y
            gradient[0] += error
            for j, value in enumerate(x, 1):
                gradient[j] += error * value
        for j in range(len(weights)):
            weights[j] -= 0.2 * (gradient[j]/len(examples) + (0.02*weights[j] if j else 0))
        if positive_slope:
            weights[1] = max(0, weights[1])
    return weights


def transform(model, vector):
    if model["kind"] == "logistic":
        return [(x-m)/s for x,m,s in zip(vector, model["means"], model["scales"], strict=True)]
    return [float(x > cut) for x, cuts in zip(vector, model["cuts"], strict=True) for cut in cuts]


def score(model, vector):
    transformed = transform(model, vector)
    raw = margin(model["weights"], transformed)
    units = round(SCALE * sigmoid(margin(model["calibration"], [raw])))
    contributions = [0.0] * len(FEATURES)
    for feature, value, weight in zip(model["featureIndices"], transformed, model["weights"][1:], strict=True):
        contributions[feature] += value * weight
    reasons = [{"feature": FEATURES[i], "marginContribution": contributions[i]}
               for i in sorted(range(len(FEATURES)), key=lambda i: (-abs(contributions[i]), i))[:3]]
    return units, reasons


def prediction_set(model, units):
    return [label for label, nonconformity in enumerate([units, SCALE-units])
            if nonconformity <= model["conformalCutoffUnits"]]


def fit_and_evaluate(model, splits):
    model["weights"] = fit([(transform(model, x), y) for _, y, x in splits["train"]])
    model["calibration"] = fit([([margin(model["weights"], transform(model, x))], y)
                                for _, y, x in splits["calibration"]], positive_slope=True)
    conf = []
    for _, y, x in splits["conformal"]:
        units, _ = score(model, x)
        conf.append(SCALE-units if y else units)
    rank = math.ceil((len(conf)+1)*0.9)
    model["conformalCutoffUnits"] = sorted(conf)[rank-1] if rank <= len(conf) else SCALE
    test = sorted(((score(model, x)[0], provider, y) for provider,y,x in splits["test"]),
                  key=lambda item: (-item[0], item[1]))
    k = math.ceil(BUDGET*len(test))
    positives = sum(y for _,_,y in test)
    hits = sum(y for _,_,y in test[:k])
    return {"reviewed": k, "recall": hits/positives, "precision": hits/k,
            "brier": sum((units/SCALE-y)**2 for units,_,y in test)/len(test),
            "coverage": sum(y in prediction_set(model, units) for units,_,y in test)/len(test),
            "abstention": sum(len(prediction_set(model, units)) != 1 for units,_,_ in test)/len(test)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    splits, overlap = load(args.raw)
    for name in ("train", "calibration", "conformal", "test"):
        if {row[1] for row in splits[name]} != {0, 1}:
            raise ValueError(f"Both provider labels required in {name}")
    columns = [sorted(column) for column in zip(*(row[2] for row in splits["train"]))]
    means = [sum(items)/len(items) for items in columns]
    scales = [max(1e-9, math.sqrt(sum((x-m)**2 for x in items)/len(items))) for items,m in zip(columns,means)]
    cuts = [sorted({items[len(items)*q//4] for q in (1,2,3)}) for items in columns]
    models = [{"kind": "logistic", "means": means, "scales": scales, "featureIndices": list(range(len(FEATURES)))},
              {"kind": "additive-bins", "cuts": cuts, "featureIndices": [i for i,row in enumerate(cuts) for _ in row]}]
    results = {model["kind"]: fit_and_evaluate(model, splits) for model in models}
    replay = [{"features": values, "scores": [score(model, values)[0] for model in models]}
              for values in [means, [items[0] for items in columns], [items[-1] for items in columns]]]
    report = {"task":"provider review only", "target":"weak provider-level PotentialFraud",
              "observationCutoff": CUTOFF, "reviewCapacity": BUDGET, "scoreScale": SCALE,
              "features": FEATURES, "groups": {name: {"providers":len(group),"positives":sum(row[1] for row in group)}
                                               for name, group in splits.items()},
              "beneficiaryOverlap": overlap, "results": results, "models": models, "replay": replay}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
