# Deployment Guide

## Deployment Boundary

AXIOM OS can be run in four profiles: simulation, local, remote, and hybrid. The simulation profile validates the complete control-plane contract without infrastructure. The local profile adds local model and observability services. The remote profile deploys the controller and workload contract into a Kubernetes cluster. Hybrid combines them through a signed task gateway and mTLS.

| Profile | Required dependencies | Appropriate use | External services |
|---|---|---|---|
| Simulation | Python and `uv` | CI, development, replay verification | None |
| Local | Docker Compose; optional Ollama | Local-first development | Redis, Jaeger, optional model server |
| Remote | Kubernetes, Helm, images, storage, telemetry | Cluster-only execution | OTLP, model service, durable audit store |
| Hybrid | Both local and remote prerequisites | Production placement and spillover | Signed remote gateway with mTLS |

## 1. Run the Simulation Profile

The simulation profile is the required preflight for every change. It uses deterministic executor adapters, writes sanitized JSONL trace records under `AXIOM_HOME`, and never sends a task to a network service.

```bash
uv sync --extra dev
export AXIOM_HOME="$PWD/.axiom"
uv run axiom init --mode simulation
uv run axiom submit \
  --objective "Run a deterministic routing validation" \
  --depth 1 \
  --tokens 8000 \
  --model llama2-7b
```

The command returns an immutable task identifier and a trace identifier. Preserve both values with the deployment evidence for later trace and replay verification.

```bash
uv run axiom trace show --trace-id tr_example
uv run axiom export --task-id task_example --format kubernetes > execution.yaml
uv run axiom verify --task-id task_example
```

## 2. Bring Up Local Services

The included Compose topology uses loopback-only port bindings for Redis, Jaeger, and Ollama. Start the model profile only after reviewing the host cache directory and image tags.

```bash
export AXIOM_MODEL_CACHE="$HOME/.cache/axiom/models"
docker compose -f docker/docker-compose-local.yml --profile models up -d
```

Initialize a local or hybrid profile afterward. To use live model execution, set `AXIOM_LOCAL_ENDPOINT`, `AXIOM_REMOTE_ENDPOINT`, and an externally managed `AXIOM_HMAC_SECRET`. A live remote endpoint must terminate TLS with a trust chain explicitly approved for the target cluster.

```bash
uv run axiom init --mode hybrid --remote-endpoint https://axiom-gateway.example.invalid
AXIOM_HMAC_SECRET='replace-with-managed-secret' \
AXIOM_REMOTE_ENDPOINT='https://axiom-gateway.example.invalid' \
uv run axiom submit --live --objective "Run controlled live validation"
```

> Do not store the HMAC secret in a shell history, repository, Kubernetes manifest, task objective, or trace attribute. Replace the reference HMAC signer with a managed workload identity before production use.

## 3. Prepare a Local Kubernetes Cluster

The local bootstrap script validates that `kind`, `kubectl`, and `helm` are available, creates a two-node cluster, installs the custom resource definition, and creates the `axiom` namespace. It does not install third-party charts or download model weights implicitly.

```bash
./scripts/bootstrap-local.sh
helm upgrade --install axiom ./helm/axiom \
  --namespace axiom --create-namespace
```

Render the chart before application in every environment. The rendered output should be committed or retained as a deployment artifact.

```bash
helm lint ./helm/axiom
helm template axiom ./helm/axiom --namespace axiom > rendered-axiom.yaml
```

## 4. Prepare the Remote Cluster

The Terraform baseline expects private subnet identifiers from a reviewed existing VPC. This deliberate boundary avoids creating unreviewed Internet-facing resources. The remote cluster configuration uses a private Kubernetes API endpoint by default, AWS-managed EKS control-plane logging, secrets encryption, and a labelled managed node group.

```bash
cd terraform
terraform init
terraform plan \
  -var='aws_region=us-east-1' \
  -var='private_subnet_ids=["subnet-aaaaaaaa","subnet-bbbbbbbb"]' \
  -out=tfplan
terraform show tfplan
```

Apply only after the organization has reviewed node types, subnets, KMS access, audit-log retention, networking, access entries, backup recovery, and expected costs.

```bash
terraform apply tfplan
```

## 5. Configure Production Values

Copy `helm/axiom/values-prod.yaml` to an environment-owned location outside source control, then supply real container images, a model-cache PVC, an OTLP collector endpoint, the signed remote gateway endpoint, and certificate secret names. The chart does not generate certificates, load models, or create secrets.

```bash
helm upgrade --install axiom ./helm/axiom \
  --namespace axiom --create-namespace \
  --values /secure/config/axiom-values-prod.yaml \
  --wait --timeout 10m
```

## 6. Prove Operational Readiness

Release acceptance requires more than a successful Helm install. Validate the `AxiomJob` schema, controller status patching, trace continuity, audit redaction, cost labels, model-cache integrity, remote timeout behavior, and local-only degradation. The following commands provide the control-plane evidence; cluster owners must separately execute their model and GPU benchmarks.

```bash
uv run axiom health check
kubectl get axiomjobs -n axiom
kubectl describe axiomjob example -n axiom
uv run axiom cost breakdown --trace-id tr_example
```

## Rollback

AXIOM task envelopes are immutable and audit records are append-only. Roll back the controller chart or container image through the standard cluster release process; do not mutate stored task or trace records. Preserve the rendered manifest, chart version, image digest, values-file checksum, policy snapshot, task digest, and trace identifier to make each rollback diagnosable.
