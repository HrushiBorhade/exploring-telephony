# Deployment Guide — Exploring Telephony

> Complete guide to understanding and deploying the AWS infrastructure.
> Updated: 2026-04-06
>
> See also: [Architecture Diagram](./architecture-diagram.png) | [DNS Guide](./DNS_DOMAIN_GUIDE.md) | [Terraform Plan](./TERRAFORM_PLAN.md)
>
> **Note:** The architecture diagram shows "Deepgram ASR" — this has been replaced with Gemini 2.5 Flash STT. The worker ECS service is also not shown separately. Regenerate with Eraser if needed.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Network Architecture](#2-network-architecture)
3. [Security Group Chain](#3-security-group-chain)
4. [How Environment Variables Work](#4-how-environment-variables-work)
5. [How Autoscaling Works](#5-how-autoscaling-works)
6. [CI/CD Pipelines](#6-cicd-pipelines)
7. [How GitHub OIDC Works](#7-how-github-oidc-works)
8. [Prerequisites](#8-prerequisites)
9. [Step-by-Step Deployment](#9-step-by-step-deployment)
10. [Day 2 Operations](#10-day-2-operations)
11. [Cost Estimate](#11-cost-estimate)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Architecture Overview

```
WHAT DEPLOYS WHERE:

  Vercel (frontend)          AWS ECS Fargate (backend)        LiveKit Cloud (agents)
  ┌──────────────┐          ┌──────────────────────┐         ┌─────────────────┐
  │ Next.js 16   │          │ Express API (8080)   │         │ Consent Agent   │
  │ asr.annote   │  ────>   │ asr-api.annote       │  <───>  │ Announce Agent  │
  │ app.com      │          │ app.com              │         │ via lk agent    │
  └──────────────┘          │                      │         │ create          │
                            │ BullMQ Worker        │         └─────────────────┘
                            │ (ffmpeg + Gemini)    │
                            └──────────────────────┘
                                     │
                            ┌────────┴────────┐
                            │ AWS Resources   │
                            │ RDS PostgreSQL  │
                            │ ElastiCache     │
                            │ S3 Recordings   │
                            └─────────────────┘
```

**Three independent deployment targets:**
- **Frontend (Next.js)** → Vercel (auto-deploys on push)
- **Backend (Express API + Worker)** → AWS ECS Fargate (GitHub Actions deploys)
- **LiveKit Agents** → LiveKit Cloud (`lk agent create`)

---

## 2. Network Architecture

```
                        INTERNET
                           │
             ┌─────────────┼─────────────┐
             │             │             │
        Squarespace    Vercel         LiveKit
        DNS (CNAME)    (frontend)     Cloud (agents)
             │
        asr-api.annoteapp.com
             │
       ┌─────┴──────┐
       │    ALB     │  ← PUBLIC SUBNETS (10.0.1.0/24, 10.0.2.0/24)
       │  :443 SSL  │     Internet Gateway + NAT Gateway live here
       │  :80→443   │
       └─────┬──────┘
             │ port 8080 (HTTP inside VPC — SSL terminated at ALB)
       ┌─────┴──────────────────────────────────────┐
       │              PRIVATE SUBNETS                │  ← 10.0.11.0/24, 10.0.12.0/24
       │                                            │
       │  ┌──────────────┐  ┌────────────────────┐ │
       │  │  ECS API     │  │  ECS Worker        │ │
       │  │  2-10 tasks  │  │  1-3 tasks         │ │
       │  │  0.5 vCPU    │  │  1 vCPU, 2GB       │ │
       │  │  1 GB RAM    │  │  ffmpeg + Gemini   │ │
       │  └──────┬───────┘  └────────┬───────────┘ │
       │         │                   │              │
       │  ┌──────┴───────────────────┴──────┐      │
       │  │     ElastiCache Redis 7.1       │      │
       │  │     BullMQ queues, encrypted    │      │
       │  │     cache.t4g.micro ($13/mo)    │      │
       │  └─────────────────────────────────┘      │
       └────────────────────┬───────────────────────┘
                            │ port 5432
       ┌────────────────────┴───────────────────────┐
       │           DATABASE SUBNETS                  │  ← 10.0.21.0/24, 10.0.22.0/24
       │  ┌─────────────────────────────────┐       │
       │  │  RDS PostgreSQL 17              │       │
       │  │  db.t4g.micro, encrypted        │       │
       │  │  7-day backups, Performance     │       │
       │  │  Insights, auto-managed password│       │
       │  └─────────────────────────────────┘       │
       └────────────────────────────────────────────┘

  S3 Recordings Bucket ← VPC Gateway Endpoint (FREE, bypasses NAT)
  ECR (Docker Registry) ← API + Worker images
```

### Why 3 Subnet Tiers?

| Tier | Subnets | What Lives Here | Internet Access |
|------|---------|----------------|----------------|
| **Public** | 10.0.1.0/24, 10.0.2.0/24 | ALB, NAT Gateway | Direct (Internet Gateway) |
| **Private** | 10.0.11.0/24, 10.0.12.0/24 | ECS tasks, Redis | Outbound only (via NAT) |
| **Database** | 10.0.21.0/24, 10.0.22.0/24 | RDS PostgreSQL | None |

### Why Single NAT Gateway?

Multi-AZ NAT = $70/mo. Single = $35/mo. If the NAT's AZ goes down, ECS tasks in the other AZ lose outbound internet (can't reach LiveKit/Gemini APIs). For a startup, the $35/mo savings outweighs the rare AZ failure risk. Flip `single_nat_gateway = false` later for HA.

### S3 VPC Gateway Endpoint

Without it: every S3 upload/download routes through NAT Gateway at $0.045/GB.
With it: S3 traffic stays inside AWS network. **Free.** This saves significant cost since you're constantly uploading/downloading audio recordings.

---

## 3. Security Group Chain

```
Internet ──→ ALB SG (ports 80/443 from 0.0.0.0/0)
                │
                └──→ ECS API SG (port 8080 from ALB SG only)
                │         │
                │         ├──→ RDS SG (port 5432 from ECS API + Worker SGs)
                │         ├──→ Redis SG (port 6379 from ECS API + Worker SGs)
                │         └──→ Internet via NAT Gateway (LiveKit, Gemini APIs)
                │
                └──→ ECS Worker SG (no ingress at all, egress only)
                          │
                          ├──→ RDS SG (port 5432)
                          ├──→ Redis SG (port 6379)
                          └──→ Internet via NAT Gateway (Gemini API)
```

**Key point:** Nobody from the internet can reach RDS, Redis, or ECS containers directly. Only the ALB can reach the API on port 8080. The worker has zero inbound access — it only pulls jobs from Redis.

### Why Standalone ECS Security Groups?

The RDS and Redis SGs need to reference the ECS SG IDs (to allow ingress). But the ECS module also references the Redis endpoint (for env vars). This creates a circular dependency:

```
Redis SG → needs ECS SG ID → ECS → needs Redis address → Redis → needs Redis SG → ...
```

Fix: We create standalone `aws_security_group` resources for ECS services (outside the ECS module), then pass them in. This breaks the cycle.

---

## 4. How Environment Variables Work

ECS containers get env vars from two sources:

### Plain Environment Variables (non-sensitive, in Terraform)

| Variable | Value | Source |
|----------|-------|--------|
| `NODE_ENV` | `production` | Hardcoded |
| `PORT` | `8080` | Hardcoded |
| `S3_BUCKET` | `telephony-recordings-prod` | From S3 module output |
| `S3_REGION` | `ap-south-1` | From variable |
| `FRONTEND_URL` | `https://asr.annoteapp.com` | From variable |
| `REDIS_HOST` | Auto-filled from ElastiCache endpoint | From Redis resource |
| `REDIS_PORT` | `6379` | Hardcoded |

### Secrets (sensitive, pulled from Secrets Manager at startup)

| Secret | Description |
|--------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `LIVEKIT_URL` | LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `LIVEKIT_SIP_TRUNK_ID` | LiveKit SIP trunk (ST_xxx) |
| `S3_ACCESS_KEY` | S3 access key (needed by LiveKit egress) |
| `S3_SECRET_KEY` | S3 secret key (needed by LiveKit egress) |
| `GEMINI_API_KEY` | Google Gemini STT key |

### Two IAM Roles per ECS Service

1. **Execution Role** — Used by ECS itself (not your code) to:
   - Pull Docker images from ECR
   - Inject secrets from Secrets Manager into container env vars
   - Write logs to CloudWatch

2. **Task Role** — Used by your running Node.js code when it calls AWS services:
   - S3: `GetObject`, `PutObject`, `ListBucket` on the recordings bucket

---

## 5. How Autoscaling Works

### API Service
- **Minimum:** 2 tasks (always running for redundancy)
- **Maximum:** 10 tasks
- **Scale out:** Average CPU > 70% for 1 minute → add tasks
- **Scale in:** CPU drops → remove tasks after 5 minute cooldown
- **Circuit breaker:** If a new deploy keeps failing health checks, auto-rollback to previous version

### Worker Service
- **Minimum:** 1 task
- **Maximum:** 3 tasks
- **Same CPU-based scaling** as API
- One worker processes 5 BullMQ jobs concurrently, so 3 tasks = 15 concurrent audio processing jobs

---

## 6. CI/CD Pipelines

### Pipeline 1: `ci.yml` (existing — runs on all pushes)

```
Trigger: push to main, feat/*, or PRs to main
Does: typecheck backend + frontend, build Next.js, build Docker image
Purpose: catch errors before merge
```

### Pipeline 2: `deploy-api.yml` (new)

```
Trigger: push to main touching apps/api/**, packages/**, Dockerfile

Steps:
  1. GitHub proves identity to AWS via OIDC (no stored keys)
  2. Gets temporary AWS credentials (15 min lifetime)
  3. Logs into ECR (Docker registry)
  4. Builds Docker image from root Dockerfile
  5. Tags with git SHA + "latest", pushes both to ECR
  6. Tells ECS: "deploy new version" (force-new-deployment)
  7. ECS pulls new image, starts new containers
  8. ALB health checks /health endpoint
  9. Old containers drain and stop
  10. Waits until new containers are stable

If health checks fail → circuit breaker auto-rolls back
Total time: ~3-4 minutes
```

### Pipeline 3: `deploy-worker.yml` (new)

```
Trigger: push to main touching apps/workers/**, packages/**
Same flow as API but:
  - Builds from apps/workers/Dockerfile
  - Pushes to telephony-worker ECR repo
  - Deploys background-worker ECS service
```

### Pipeline 4: `terraform-ci.yml` (new)

```
Trigger: PRs touching infra/**
Steps: terraform fmt -check, terraform init -backend=false, terraform validate
Purpose: catch Terraform syntax errors before merge
Note: does NOT run terraform apply — infra changes are always manual
```

### What Triggers What

```
Push code to main:
  ├── apps/api/** or packages/** or Dockerfile  → deploy-api.yml → new API on ECS
  ├── apps/workers/** or packages/**             → deploy-worker.yml → new worker on ECS
  ├── apps/web/**                                → Vercel auto-deploys frontend
  └── infra/**                                   → nothing (manual terraform apply)
```

---

## 7. How GitHub OIDC Works

Traditional approach: store `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` as GitHub secrets. If leaked = permanent access.

**OIDC approach (what we use):**

```
1. GitHub Actions says: "I am repo HrushiBorhade/voice-agent-platform, branch main"
2. GitHub signs this claim with a JWT token
3. AWS receives the token, checks the trust policy:
   "Is this repo:HrushiBorhade/voice-agent-platform:ref:refs/heads/main? Yes."
4. AWS issues temporary credentials (15 min lifetime)
5. GitHub Actions uses those creds → push to ECR, update ECS
6. Creds expire automatically
```

**Only `refs/heads/main`** can assume the role. PRs, forks, other branches = denied.

**Only secret needed in GitHub:** `AWS_ACCOUNT_ID` (your 12-digit account number — not sensitive, just convenient to keep as a secret).

---

## 8. Prerequisites

### Tools to Install

```bash
brew install terraform awscli
```

### AWS Account Setup

1. Create an AWS account at https://aws.amazon.com (or use existing)
2. Create an IAM user with `AdministratorAccess` (for initial setup only)
3. Run `aws configure`:
   ```
   AWS Access Key ID: <your-key>
   AWS Secret Access Key: <your-secret>
   Default region: ap-south-1
   Default output format: json
   ```

### Credentials You Already Have (from your .env)

| Secret | Source |
|--------|--------|
| `LIVEKIT_URL` | LiveKit Cloud dashboard |
| `LIVEKIT_API_KEY` | LiveKit Cloud dashboard |
| `LIVEKIT_API_SECRET` | LiveKit Cloud dashboard |
| `LIVEKIT_SIP_TRUNK_ID` | `lk sip outbound create` |
| `S3_ACCESS_KEY` | AWS IAM Console |
| `S3_SECRET_KEY` | AWS IAM Console |
| `GEMINI_API_KEY` | Google AI Studio (rotate first!) |

### What You DON'T Need

- Route53 (DNS stays on Squarespace)
- Stored AWS keys in GitHub (OIDC handles auth)
- A separate infra repo (everything is in `voice-agent-platform/infra/`)

---

## 9. Step-by-Step Deployment

### Step 1: Install Tools (2 min)

```bash
brew install terraform awscli
aws configure
# Enter: Access Key ID, Secret Access Key, Region: ap-south-1, Output: json
```

### Step 2: Replace ACCOUNT_ID Placeholder (1 min)

```bash
# Get your AWS account ID
aws sts get-caller-identity --query Account --output text
# Output: 123456789012

# Edit infra/environments/prod/backend.tf
# Change: bucket = "telephony-terraform-state-ACCOUNT_ID"
# To:     bucket = "telephony-terraform-state-123456789012"
```

### Step 3: Bootstrap — Create State Bucket (2 min)

```bash
cd infra/bootstrap
terraform init
terraform apply
# Type "yes" — creates S3 bucket + DynamoDB table for state
# This is a one-time operation, never touch bootstrap again
```

### Step 4: Deploy All Infrastructure (15-20 min)

```bash
cd ../environments/prod
terraform init      # Downloads modules, connects to S3 backend
terraform plan      # Preview what will be created — review this!
terraform apply     # Type "yes" — creates ~40 AWS resources
```

**IMPORTANT: terraform apply will PAUSE at ACM certificate validation.**

It prints something like:

```
acm_validation_record = {
  "asr-api.annoteapp.com" = {
    name  = "_abc123.asr-api.annoteapp.com."
    type  = "CNAME"
    value = "_xyz789.acm-validations.aws."
  }
}
```

**While Terraform is waiting**, do this in Squarespace:
1. Domains → annoteapp.com → DNS Settings → Custom Records
2. Add Record → Type: **CNAME**
3. Name: `_abc123.asr-api` (remove `.annoteapp.com.` — Squarespace adds it)
4. Data: `_xyz789.acm-validations.aws.`
5. Save

Wait 2-5 minutes. Terraform detects the validation and continues. RDS takes ~8-10 minutes (slowest resource).

### Step 5: Save the Terraform Outputs (1 min)

After `terraform apply` completes:

```bash
terraform output
```

```
alb_dns_name              = "telephony-alb-123456.ap-south-1.elb.amazonaws.com"
ecr_api_repository_url    = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/telephony-api"
ecr_worker_repository_url = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/telephony-worker"
rds_endpoint              = "telephony-db.xxx.ap-south-1.rds.amazonaws.com:5432"
rds_master_secret_arn     = "arn:aws:secretsmanager:ap-south-1:...:secret:rds!..."
redis_endpoint            = "telephony-redis.xxx.cache.amazonaws.com"
github_actions_role_arn   = "arn:aws:iam::123456789012:role/telephony-github-actions-deploy"
sns_alerts_topic_arn      = "arn:aws:sns:ap-south-1:123456789012:telephony-alerts"
```

Save these values — you'll need them in the next steps.

### Step 6: Get the RDS Master Password (2 min)

RDS auto-generated a password in Secrets Manager:

```bash
aws secretsmanager get-secret-value \
  --secret-id "$(terraform output -raw rds_master_secret_arn)" \
  --query SecretString --output text | jq -r '.password'
```

Construct your DATABASE_URL:
```
postgresql://telephony:<that-password>@<rds_endpoint>/telephony
```

Example:
```
postgresql://telephony:xK9mP2vL@telephony-db.abc.ap-south-1.rds.amazonaws.com:5432/telephony
```

### Step 7: Populate Secrets Manager (3 min)

```bash
aws secretsmanager put-secret-value \
  --secret-id telephony/prod/app-secrets \
  --secret-string '{
    "DATABASE_URL": "postgresql://telephony:<password>@<rds-endpoint>:5432/telephony",
    "LIVEKIT_URL": "wss://your-app.livekit.cloud",
    "LIVEKIT_API_KEY": "APIxxxxx",
    "LIVEKIT_API_SECRET": "xxxxx",
    "LIVEKIT_SIP_TRUNK_ID": "ST_xxxxx",
    "S3_ACCESS_KEY": "xxxxx",
    "S3_SECRET_KEY": "xxxxx",
    "GEMINI_API_KEY": "AIzaSy..."
  }'
```

Fill in actual values from your `.env` file.

### Step 8: Run Database Migration (2 min)

```bash
# From the monorepo root
DATABASE_URL="postgresql://telephony:<password>@<rds-endpoint>:5432/telephony" \
  npx drizzle-kit push
```

This creates all tables (user, session, verification, captures_v2, etc.) in the production database.

### Step 9: Push Docker Images to ECR (5 min)

```bash
# Login to ECR
aws ecr get-login-password --region ap-south-1 | \
  docker login --username AWS --password-stdin \
  <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com

# Build and push API image (from monorepo root)
docker build -t <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/telephony-api:latest .
docker push <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/telephony-api:latest

# Build and push Worker image
docker build -f apps/workers/Dockerfile \
  -t <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/telephony-worker:latest .
docker push <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/telephony-worker:latest
```

ECS automatically pulls the images and starts containers. Wait ~2 minutes for health checks.

### Step 10: Add DNS CNAME for API (1 min)

In Squarespace DNS → Custom Records:
- Type: **CNAME**
- Name: `asr-api`
- Data: `telephony-alb-123456.ap-south-1.elb.amazonaws.com` (from terraform output)

### Step 11: Add GitHub Secret (1 min)

Go to `HrushiBorhade/voice-agent-platform` → Settings → Secrets and variables → Actions:
- Name: `AWS_ACCOUNT_ID`
- Value: your 12-digit AWS account ID

### Step 12: Verify Everything (2 min)

```bash
# Test the API
curl https://asr-api.annoteapp.com/health
# Expected: {"status":"ok","uptime":42,"activeCaptures":0}

# Subscribe to alerts
aws sns subscribe \
  --topic-arn <sns_alerts_topic_arn> \
  --protocol email \
  --notification-endpoint your@email.com
# Confirm the subscription email that arrives
```

### Step 13: Deploy Frontend to Vercel (2 min)

1. Vercel dashboard → Project Settings → Environment Variables
2. Add: `NEXT_PUBLIC_API_URL` = `https://asr-api.annoteapp.com`
3. Redeploy
4. In Vercel → Domains → Add `asr.annoteapp.com`
5. In Squarespace DNS → CNAME → Name: `asr` → Data: `cname.vercel-dns.com`

### Step 14: Deploy LiveKit Agents (2 min)

```bash
cd apps/agents
lk agent create
```

### Step 15: End-to-End Test

```
1. Visit https://asr.annoteapp.com
2. Login with phone number → OTP via WhatsApp
3. Create a new capture → enter two phone numbers
4. Start capture → both phones ring
5. Consent agent asks for permission
6. Recording starts → LiveKit egress saves to S3
7. Recording ends → webhook → BullMQ job queued
8. Worker picks up → Gemini transcribes → ffmpeg slices → uploads clips
9. Frontend shows utterances with audio playback + CSV download
```

---

## 10. Day 2 Operations

### Making Code Changes

```
Push to main:
  ├── apps/api/**      → deploy-api.yml runs → new API in ~3 min
  ├── apps/workers/**  → deploy-worker.yml runs → new worker in ~3 min
  ├── apps/web/**      → Vercel auto-deploys
  └── infra/**         → nothing (manual terraform apply)
```

### Changing Infrastructure

```bash
# Edit infra/environments/prod/main.tf
cd infra/environments/prod
terraform plan    # Preview changes
terraform apply   # Apply (type yes)
```

### Viewing Logs

```bash
# API logs
aws logs tail /aws/ecs/telephony --follow --filter-pattern "ERROR"

# Worker logs
aws logs tail /aws/ecs/telephony --follow --filter-pattern "[WORKER]"
```

### SSH Into a Running Container (ECS Exec)

```bash
aws ecs execute-command \
  --cluster telephony-cluster \
  --task <task-id> \
  --container api \
  --interactive \
  --command "/bin/sh"
```

### If Something Breaks

| Problem | What Happens | Fix |
|---------|-------------|-----|
| API returns 5xx | CloudWatch alarm → SNS email | Check logs, check RDS/Redis connectivity |
| Deploy fails | Circuit breaker auto-rolls back | Check GitHub Actions logs, fix code, push again |
| Database issue | Performance Insights shows slow queries | Check RDS console, add indexes |
| Redis down | BullMQ retries 3x with exponential backoff | Check ElastiCache console |
| OTP not sent | AuthKey API failure logged | Check Vercel function logs |

### Updating Secrets

```bash
aws secretsmanager put-secret-value \
  --secret-id telephony/prod/app-secrets \
  --secret-string '{ ... updated values ... }'

# Force ECS to pick up new secrets (restarts containers)
aws ecs update-service --cluster telephony-cluster --service telephony-api --force-new-deployment
aws ecs update-service --cluster telephony-cluster --service background-worker --force-new-deployment
```

---

## 11. Cost Estimate

| Resource | Monthly Cost |
|----------|-------------|
| ECS API (2 tasks, 0.5 vCPU, 1 GB) | ~$30 |
| ECS Worker (1 task, 1 vCPU, 2 GB) | ~$22 |
| NAT Gateway (single AZ) | ~$35 |
| ALB | ~$20 |
| RDS db.t4g.micro | ~$15 |
| ElastiCache Redis t4g.micro | ~$13 |
| S3 + ECR + CloudWatch + Secrets | ~$10 |
| S3 VPC Gateway Endpoint | **$0** |
| Route53 | **$0** (not used) |
| ACM Certificate | **$0** (free) |
| **Total** | **~$145/mo** |

Covered by AWS Activate startup credits ($25K-$100K).

---

## 12. Troubleshooting

### terraform init fails with "bucket does not exist"

You haven't run bootstrap yet, or the ACCOUNT_ID placeholder in `backend.tf` wasn't replaced.

```bash
aws sts get-caller-identity --query Account --output text
# Replace ACCOUNT_ID in infra/environments/prod/backend.tf with this value
```

### terraform apply hangs at ACM validation

Expected! Add the CNAME record in Squarespace DNS and wait 2-5 minutes. See Step 4.

### ECS tasks fail to start with ResourceInitializationError

Secrets Manager isn't populated yet (Step 7), or the execution role doesn't have `secretsmanager:GetSecretValue`. We've already configured `task_exec_secret_arns` to handle this.

### Health checks failing (ALB returns 502)

1. Check the container is actually running: `aws ecs describe-services --cluster telephony-cluster --services telephony-api`
2. Check container logs: `aws logs tail /aws/ecs/telephony --follow`
3. Verify the health endpoint works: the API must respond 200 on `GET /health`

### GitHub Actions deploy fails at "Configure AWS credentials"

1. Verify `AWS_ACCOUNT_ID` secret is set in GitHub repo settings
2. Verify the OIDC trust policy matches your repo name exactly
3. Only `main` branch can deploy (by design)

---

## File Reference

```
infra/
├── bootstrap/                           # Run once for state backend
│   ├── main.tf                          # S3 bucket + DynamoDB table
│   ├── variables.tf                     # Region
│   └── outputs.tf                       # Bucket name, table name
│
├── environments/prod/
│   ├── main.tf                          # ALL infrastructure (~870 lines)
│   ├── variables.tf                     # Project name, domain, GitHub repo
│   ├── outputs.tf                       # Endpoints, ARNs, DNS names
│   ├── versions.tf                      # Terraform + AWS provider versions
│   ├── terraform.tfvars                 # Actual values
│   └── backend.tf                       # S3 remote state config
│
└── .terraform-version                   # tfenv compatibility

.github/workflows/
├── ci.yml                               # Typecheck + build (existing)
├── deploy-api.yml                       # OIDC → ECR → ECS API
├── deploy-worker.yml                    # OIDC → ECR → ECS Worker
└── terraform-ci.yml                     # fmt + validate on PRs
```

### DNS Records to Add in Squarespace (3 total)

| Type | Name | Value | When |
|------|------|-------|------|
| CNAME | `_abc123.asr-api` | `_xyz789.acm-validations.aws.` | During terraform apply (Step 4) |
| CNAME | `asr-api` | `telephony-alb-xxx.ap-south-1.elb.amazonaws.com` | After deploy (Step 10) |
| CNAME | `asr` | `cname.vercel-dns.com` | For frontend (Step 13) |
