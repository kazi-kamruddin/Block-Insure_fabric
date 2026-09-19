package insurance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const evidenceLeafEncoding = "block-insure-evidence-leaf-v1"

func evidenceLeafHash(evidence *EvidenceReference) string {
	return canonicalProtocolHash(
		evidenceLeafEncoding,
		evidence.ID,
		evidence.ClaimID,
		fmt.Sprint(evidence.ClaimVersion),
		evidence.DocumentType,
		strings.ToLower(evidence.ContentHash),
		strings.ToLower(evidence.StorageReferenceHash),
	)
}

func evidenceMerkleParent(left, right string) (string, error) {
	leftBytes, err := hex.DecodeString(left)
	if err != nil || len(leftBytes) != sha256.Size {
		return "", fmt.Errorf("invalid left Merkle hash")
	}
	rightBytes, err := hex.DecodeString(right)
	if err != nil || len(rightBytes) != sha256.Size {
		return "", fmt.Errorf("invalid right Merkle hash")
	}
	payload := make([]byte, 1, 1+len(leftBytes)+len(rightBytes))
	payload[0] = 0x01
	payload = append(payload, leftBytes...)
	payload = append(payload, rightBytes...)
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:]), nil
}

func evidenceMerkleRoot(leaves []string) (string, error) {
	if len(leaves) == 0 {
		return "", fmt.Errorf("at least one evidence leaf is required")
	}
	level := append([]string(nil), leaves...)
	for len(level) > 1 {
		next := make([]string, 0, (len(level)+1)/2)
		for index := 0; index < len(level); index += 2 {
			right := level[index]
			if index+1 < len(level) {
				right = level[index+1]
			}
			parent, err := evidenceMerkleParent(level[index], right)
			if err != nil {
				return "", err
			}
			next = append(next, parent)
		}
		level = next
	}
	return level[0], nil
}

func evidenceLeaves(ctx contractapi.TransactionContextInterface, contract *Contract, evidenceIDs []string) ([]string, error) {
	leaves := make([]string, 0, len(evidenceIDs))
	for _, evidenceID := range evidenceIDs {
		evidence, err := contract.ReadEvidenceReference(ctx, evidenceID)
		if err != nil {
			return nil, err
		}
		leaves = append(leaves, evidenceLeafHash(evidence))
	}
	return leaves, nil
}

func (c *Contract) PublishEvidenceMerkleBatch(ctx contractapi.TransactionContextInterface, id, evidenceIDsJSON, rootHash string) (*EvidenceMerkleBatch, error) {
	publishedBy, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin")
	if err != nil {
		return nil, err
	}
	if err := validateHash("rootHash", rootHash); err != nil {
		return nil, err
	}
	var evidenceIDs []string
	if err := json.Unmarshal([]byte(evidenceIDsJSON), &evidenceIDs); err != nil {
		return nil, fmt.Errorf("evidenceIdsJson must be a JSON string array")
	}
	if len(evidenceIDs) == 0 || len(evidenceIDs) > 256 {
		return nil, fmt.Errorf("evidence batch must contain between 1 and 256 references")
	}
	seen := make(map[string]bool, len(evidenceIDs))
	for _, evidenceID := range evidenceIDs {
		if !idPattern.MatchString(evidenceID) || seen[evidenceID] {
			return nil, fmt.Errorf("evidence IDs must be valid and unique")
		}
		seen[evidenceID] = true
	}
	slices.Sort(evidenceIDs)
	leaves, err := evidenceLeaves(ctx, c, evidenceIDs)
	if err != nil {
		return nil, err
	}
	computedRoot, err := evidenceMerkleRoot(leaves)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(computedRoot, rootHash) {
		return nil, fmt.Errorf("rootHash does not match the canonical evidence Merkle root")
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	batch := &EvidenceMerkleBatch{
		AssetType: "evidenceMerkleBatch", SchemaVersion: SchemaVersion, ID: id,
		RootHash: strings.ToLower(rootHash), HashAlgorithm: "SHA-256", LeafEncoding: evidenceLeafEncoding,
		EvidenceIDs: evidenceIDs, LeafCount: len(evidenceIDs), PublishedBy: publishedBy, CreatedAt: now,
	}
	if err := putState(ctx, "evidenceMerkleBatch", id, batch); err != nil {
		return nil, err
	}
	if err := emit(ctx, "EvidenceMerkleBatchPublished", batch); err != nil {
		return nil, err
	}
	return batch, nil
}

func (c *Contract) ReadEvidenceMerkleBatch(ctx contractapi.TransactionContextInterface, id string) (*EvidenceMerkleBatch, error) {
	return getState[EvidenceMerkleBatch](ctx, "evidenceMerkleBatch", id)
}

func (c *Contract) VerifyEvidenceInclusion(ctx contractapi.TransactionContextInterface, batchID, evidenceID, proofJSON string) (*EvidenceInclusionVerification, error) {
	batch, err := c.ReadEvidenceMerkleBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	evidence, err := c.ReadEvidenceReference(ctx, evidenceID)
	if err != nil {
		return nil, err
	}
	var proof []MerkleProofStep
	if err := json.Unmarshal([]byte(proofJSON), &proof); err != nil {
		return nil, fmt.Errorf("proofJson must be a JSON Merkle proof array")
	}
	if len(proof) > 16 {
		return nil, fmt.Errorf("Merkle proof exceeds the maximum supported depth")
	}
	current := evidenceLeafHash(evidence)
	for _, step := range proof {
		if err := validateHash("proof hash", step.Hash); err != nil {
			return nil, err
		}
		switch strings.ToUpper(strings.TrimSpace(step.Position)) {
		case "LEFT":
			current, err = evidenceMerkleParent(strings.ToLower(step.Hash), current)
		case "RIGHT":
			current, err = evidenceMerkleParent(current, strings.ToLower(step.Hash))
		default:
			return nil, fmt.Errorf("proof position must be LEFT or RIGHT")
		}
		if err != nil {
			return nil, err
		}
	}
	inBatch := slices.Contains(batch.EvidenceIDs, evidenceID)
	return &EvidenceInclusionVerification{
		BatchID: batch.ID, EvidenceID: evidence.ID, LeafHash: evidenceLeafHash(evidence),
		ComputedRoot: current, AnchoredRoot: batch.RootHash, ProofSteps: len(proof),
		Included: inBatch && current == batch.RootHash,
		HashAlgorithm: batch.HashAlgorithm, LeafEncoding: batch.LeafEncoding,
	}, nil
}
