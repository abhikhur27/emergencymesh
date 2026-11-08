# Brev provider preparation

The supervisor application stays on ABHIONEMILLION behind its existing authenticated Cloudflare route. Only supervisor inference moves to the approved Brev GPU. Laptop ECSW inference stays on its local 4B model. The target is downloaded `nemotron-3-nano:30b` weights on the48 GB GPU, accessed only through desktop loopback 11435 over private SSH to remote loopback 11434.

## Authentication and approval boundary

Official Brev CLI 0.6.337 is installed in the existing desktop Ubuntu WSL distribution. Its release archive was verified against the published SHA256 `99bf8383618903ab411a91605a43b2e2f5a333781860bd6743ba44bfc4920d4f`. The normal NVIDIA device flow did not finish. The owner separately approved a short-lived organization API key; its actual creation and authenticated desktop installation supersede that device-flow blocker.

The official CLI source describes a 24-hour NVIDIA device session-key lifetime. A single pasted ID JWT does not establish durable refresh through the longer demonstration. The desktop task preflight requires verified cleanup authority lasting beyond the deletion time.

The minimum documented API-key access for deletion is **Read & Write in the RescueMesh organization**. Brev documents only Read and Read & Write, with the creator's existing resource permissions. There is no documented exact-instance or lifecycle-only key scope. The key cannot access another organization. Any approval must accurately describe organization-wide write access, rather than promising finer provider restrictions. The application guard independently permits only the exact approved instance ID/name.

The approved key is named `RescueMesh-Nemotron-deadline`, scoped only to RescueMesh with Read & Write access, and expires at the end of November 10. It was transferred directly to private desktop storage and authenticated with `login-brev-api-key-private.ps1`. Its value is excluded from source and receipts. Authentication metadata confirms the expected organization without printing the key.

`brev login --api-key` saves the key and its server-resolved organization. The installed binary recognizes the flag. API-key commands reject `--org` overrides and cannot list organizations; the lifecycle guard checks saved `APIKeyOrgID` against the approved organization and then uses its fixed key context. `brev refresh` is documented to prepare managed-instance SSH configuration after key login.

The official docs describe issuer-side revocation through Console → API Keys → Delete. `brev logout` only removes local credentials and does not revoke the key. No documented safe self-revocation CLI/SDK command was found. Do not claim automatic issuer revocation without a verified route; use the short explicit expiration and record actual console deletion after compute cleanup when available.

## Compute and budget

The first approved Hyperstack A6000 request failed provisioning and was deleted, with authenticated absence verified. The approved replacement is a MassedCompute A6000 with 48 GB VRAM, 64 GB system memory and 256 GB storage at $0.68/hour total, under a $30 credit cap. It was created November 8 at 10:40:23 UTC; its exact ID remains in the private plan. At 10:55 UTC it was still building without usable SSH or verified model inference. No payment method or auto recharge was added.

The guard computes deletion at the earlier of 2026-11-10T05:00:00Z or the affordable resource lifetime, including prior project spend and a cleanup reserve. Failed provisioning is not assumed free without a billing receipt; a conservative elapsed-rate estimate can be included. A dedicated desktop task supplies deadline deletion independently of the SSH link. No native instance-delete TTL was found in official documentation; the official CI example explicitly calls `brev delete` during cleanup.

Only the exact approved disposable instance is deleted. The guard verifies authenticated inventory, organization and instance identity before issuing deletion, then requires actual inventory absence. An auth failure, blank output or malformed inventory is never interpreted as deletion. No `--all` command is used.

## Verification before activation

The model installer verifies the pinned official Ollama 0.40.15 Linux archive, checks the approved GPU size and free space, keeps model HTTP on remote loopback, bounds context/parallelism/queue, and gives the owned process the explicit deadline. Private forwarding and source attribution must then be observed on the actual instance.

Activation requires native `lookup_resources` and `propose_allocation` calls from the actual 30B model, a matching digest, GPU memory evidence, correct SSH identity and enabled cleanup tasks. The configured Brev provider overrides legacy local-model runner variables. If the Brev link fails later, the application labels deterministic policy fallback; it does not call a desktop or other LLM.

Prepared code passed lifecycle unit tests and supervisor provider-contract tests. The actual desktop guard is enabled and reached its guarding state under the scheduled-task identity; the separate cleanup task is enabled with next run November 10 at 05:00 UTC. These task receipts do not establish that the cloud VM finished provisioning or that Brev model inference works. Activation remains gated on actual private SSH, native tools and GPU evidence.

References: [API-key scopes, expiry and revocation](https://docs.nvidia.com/brev/latest/guides/api-keys), [CLI authentication](https://docs.nvidia.com/brev/cli/getting-started), [CI cleanup example](https://docs.nvidia.com/brev/latest/guides/ci-cd), [instance deletion](https://docs.nvidia.com/brev/cli/instance-management), [pinned NVIDIA auth implementation](https://raw.githubusercontent.com/brevdev/brev-cli/v0.6.337/pkg/auth/kas.go), [official 30B model](https://ollama.com/library/nemotron-3-nano:30b).
