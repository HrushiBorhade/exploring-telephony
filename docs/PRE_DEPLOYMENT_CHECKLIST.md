# Pre-Deployment Checklist

> Everything that needs to be done before running `terraform apply`.

---

## Code Changes — Done

| Item | Status | Notes |
|------|--------|-------|
| Port 3001 → 8080 | Done | All files, Docker, compose, env |
| Remove OpenTelemetry | Done | 96 packages removed |
| Split agents to `apps/agents/` | Done | API image 334MB → no agent deps |
| Backend production review | Done | trust proxy, body limits, 404 handler, etc. |
| esbuild bundled Dockerfile | Done | API: 351MB, single server.js |
| BullMQ + Redis pipeline | Done | Replaces inline Deepgram transcription |
| Gemini STT integration | Done | Structured output with emotion + language |
| S3 structured paths | Done | `captures/{id}/participant-a/clips/...` |
| CSV export for SOTA Labs | Done | 9 columns, uploaded to `captures/{id}/dataset.csv` |
| Worker Dockerfile | Done | 558MB with ffmpeg |
| DB migration (datasetCsvUrl) | Done | Column added via drizzle-kit push |
| Atomic webhook handler | Done | Race condition fixed |
| Code review + simplification | Done | 4 minor cleanups |
| Tests | Done | 10/10 passing |

## Code Changes — Pending

| Item | Status | Notes |
|------|--------|-------|
| Frontend UI updates | Done | Processing status, utterance clips, CSV download, layout redesign |
| Update `apps/web/src/lib/types.ts` | Done | Added `processing`, `datasetCsvUrl`, `Utterance` |
| Vercel frontend config | **TODO** | Set `NEXT_PUBLIC_API_URL` to `https://asr-api.annoteapp.com` (after Terraform) |

## Infrastructure — Not Started

| Item | Status | Notes |
|------|--------|-------|
| AWS account + credentials | **TODO** | Need AWS account with admin access |
| Terraform installed | **TODO** | `brew install terraform` |
| Bootstrap (S3 + DynamoDB state) | **TODO** | One-time: `terraform init && apply` |
| Main Terraform apply | **TODO** | VPC, ALB, ECS, RDS, S3, ECR, Redis, Secrets |
| Squarespace DNS: ACM validation CNAME | **TODO** | Manual: add CNAME from Terraform output |
| Squarespace DNS: `asr-api` CNAME | **TODO** | Manual: point to ALB DNS name |
| Squarespace DNS: `asr` CNAME | **TODO** | Manual: point to Vercel |
| Secrets Manager: populate values | **TODO** | Manual: `aws secretsmanager put-secret-value` |
| First Docker push to ECR | **TODO** | `docker push` API + worker images |
| GitHub OIDC: verify trust policy | **TODO** | Set your repo name in tfvars |
| DB migration on RDS | **TODO** | `drizzle-kit push` against RDS endpoint |
| LiveKit agents deploy | **TODO** | `lk agent create` in `apps/agents/` |

## Credentials Needed

| Credential | Where to Get It | Where It Goes |
|------------|----------------|---------------|
| AWS Access Key (for Terraform only) | IAM Console | `~/.aws/credentials` |
| Domain: annoteapp.com | Already have (Squarespace) | DNS records |
| LiveKit Cloud keys | Already have (in .env) | Secrets Manager |
| Gemini API key | Already have (rotate first!) | Secrets Manager |
| S3 keys | Already have (in .env) | Secrets Manager |
| GitHub repo name | Your repo | `terraform.tfvars` |

## Order of Operations

```
1. Finish frontend UI updates (this session or next)
2. Install Terraform: brew install terraform
3. Run bootstrap: cd infra/bootstrap && terraform apply
4. Run main Terraform: cd infra/environments/prod && terraform apply
   → Terraform outputs ACM validation CNAME + ALB DNS name
5. Add ACM validation CNAME in Squarespace DNS
   → Wait for Terraform to complete (ACM validates in 2-5 min)
6. Populate Secrets Manager:
   aws secretsmanager put-secret-value --secret-id telephony/prod/app-secrets \
     --secret-string '{"DATABASE_URL":"...", "LIVEKIT_URL":"...", ...}'
7. Push Docker images to ECR:
   docker tag telephony-api-test <account>.dkr.ecr.ap-south-1.amazonaws.com/telephony-api:latest
   docker push <account>.dkr.ecr.ap-south-1.amazonaws.com/telephony-api:latest
   (same for worker)
8. ECS starts the services → health checks pass
9. Add asr-api CNAME in Squarespace → points to ALB
10. Verify: curl https://asr-api.annoteapp.com/health
11. Deploy frontend to Vercel with NEXT_PUBLIC_API_URL=https://asr-api.annoteapp.com
12. Add asr CNAME in Squarespace → points to Vercel
13. Deploy agents: cd apps/agents && lk agent create
14. Test end-to-end: create capture → start → consent → recording → processing → completed
```
