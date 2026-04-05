# Terraform Infrastructure Plan — Exploring Telephony

> Region: `ap-south-1` (Mumbai) | All modules from `terraform-aws-modules` (latest versions)
> Updated: 2026-04-05 — Incorporates production review fixes

---

## Local Dev Setup (Post-Changes)

```bash
# Terminal 1: API server (port 8080)
pnpm dev:api

# Terminal 2: Next.js frontend (port 3000, proxies /api/* to localhost:8080)
pnpm dev:web

# Terminal 3: Consent agent worker (connects to LiveKit Cloud)
pnpm dev:consent-agent

# Terminal 4: Announce agent worker (connects to LiveKit Cloud)
pnpm dev:announce-agent
```

---

## Production Architecture

```
                         Internet
                            │
                    ┌───────┴───────┐
                    │   Route53     │
                    │ api.your.com  │
                    └───────┬───────┘
                            │
                    ┌───────┴───────┐
                    │  ACM (SSL)    │
                    │  *.your.com   │
                    └───────┬───────┘
                            │
              ┌─────────────┴─────────────┐
              │    ALB (public subnets)    │
              │  :443 → target group      │
              │  :80  → redirect to 443   │
              └─────────────┬─────────────┘
                            │
              ┌─────────────┴─────────────┐
              │  ECS Fargate Service       │
              │  (private subnets)         │
              │                            │
              │  telephony-api:8080        │
              │  2-10 tasks, auto-scaling  │
              └─────────────┬─────────────┘
                            │
              ┌─────────────┴─────────────┐
              │  RDS PostgreSQL 17         │
              │  (database subnets)        │
              │  db.t4g.micro              │
              │  encrypted, backed up      │
              └───────────────────────────┘

              ┌───────────────────────────┐
              │  S3 Bucket                │
              │  telephony-recordings     │
              │  VPC Gateway Endpoint     │
              │  (bypasses NAT — FREE)    │
              └───────────────────────────┘

              ┌───────────────────────────┐
              │  ECR Repository           │
              │  telephony-api            │
              │  image scanning, lifecycle│
              └───────────────────────────┘

Separately deployed (NOT in Terraform):
  - Next.js frontend → Vercel
  - LiveKit agents   → LiveKit Cloud (lk agent create)
```

---

## File Structure

```
infra/
├── bootstrap/                    # Step 1: Run once manually
│   ├── main.tf                   # S3 bucket + DynamoDB table for state
│   ├── variables.tf
│   └── outputs.tf
│
├── environments/
│   └── prod/
│       ├── main.tf               # All modules wired together
│       ├── variables.tf
│       ├── outputs.tf
│       ├── versions.tf           # Pin Terraform + provider versions
│       ├── terraform.tfvars      # Production values
│       └── backend.tf            # S3 remote state config
│
└── .github/
    └── workflows/
        └── deploy-api.yml        # GitHub Actions: ECR push + ECS deploy
```

> No `modules/` directory — we use terraform-aws-modules directly (no thin wrappers needed for a single-environment setup). If you add staging later, extract shared config into modules.

---

## Implementation Steps

### Phase 1: Foundation

#### Step 1 — Remote State Backend

```hcl
# infra/bootstrap/main.tf
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "ap-south-1"
}

resource "aws_s3_bucket" "terraform_state" {
  bucket = "telephony-terraform-state-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "terraform_locks" {
  name         = "telephony-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
```

Run once:
```bash
cd infra/bootstrap && terraform init && terraform apply
```

---

#### Step 2 — Provider + Versions + Backend

```hcl
# infra/environments/prod/versions.tf
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      Terraform   = "true"
      ManagedBy   = "terraform"
    }
  }
}
```

```hcl
# infra/environments/prod/backend.tf
terraform {
  backend "s3" {
    bucket         = "telephony-terraform-state-ACCOUNT_ID"
    key            = "prod/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "telephony-terraform-locks"
    encrypt        = true
  }
}
```

---

#### Step 3 — VPC + Networking + S3 VPC Endpoint

```hcl
# infra/environments/prod/main.tf — VPC section

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.project}-${var.environment}"
  cidr = "10.0.0.0/16"

  azs              = ["ap-south-1a", "ap-south-1b"]
  public_subnets   = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnets  = ["10.0.11.0/24", "10.0.12.0/24"]
  database_subnets = ["10.0.21.0/24", "10.0.22.0/24"]

  # NAT Gateway — single for cost ($35/mo vs $70/mo for multi-AZ)
  enable_nat_gateway = true
  single_nat_gateway = true

  # DNS — required for RDS endpoint resolution and service discovery
  enable_dns_hostnames = true
  enable_dns_support   = true

  # Auto-create DB subnet group for RDS
  create_database_subnet_group       = true
  create_database_subnet_route_table = true

  # Lock down default resources (security best practice)
  manage_default_security_group = true
  manage_default_route_table    = true
  manage_default_network_acl    = true
}

# S3 VPC Gateway Endpoint — FREE, bypasses NAT for all S3 traffic
# Without this, every recording upload/download goes through NAT at $0.045/GB
resource "aws_vpc_endpoint" "s3" {
  vpc_id       = module.vpc.vpc_id
  service_name = "com.amazonaws.ap-south-1.s3"

  route_table_ids = concat(
    module.vpc.private_route_table_ids,
    module.vpc.database_route_table_ids
  )
}
```

---

#### Step 4 — RDS Security Group

```hcl
# RDS SG — only resource that needs a standalone SG
# (ALB and ECS modules create their own SGs inline)
module "rds_sg" {
  source  = "terraform-aws-modules/security-group/aws"
  version = "~> 5.0"

  name        = "${var.project}-rds"
  vpc_id      = module.vpc.vpc_id
  description = "RDS - PostgreSQL from ECS only"

  ingress_with_source_security_group_id = [
    {
      from_port                = 5432
      to_port                  = 5432
      protocol                 = "tcp"
      source_security_group_id = module.ecs.services["telephony-api"].security_group_id
      description              = "PostgreSQL from ECS tasks"
    },
  ]
}
```

---

### Phase 2: SSL + Load Balancer

#### Step 5 — ACM Certificate (No Route53 — DNS managed in Squarespace)

```hcl
# Domain annoteapp.com is managed by Squarespace DNS.
# NO Route53 zone needed. ACM validation is done manually in Squarespace.
# See docs/DNS_DOMAIN_GUIDE.md for full details.

resource "aws_acm_certificate" "api" {
  domain_name       = "asr-api.annoteapp.com"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# This blocks until you add the validation CNAME in Squarespace DNS
resource "aws_acm_certificate_validation" "api" {
  certificate_arn = aws_acm_certificate.api.arn
}

# MANUAL STEP: After running terraform apply, add these records in Squarespace DNS
output "acm_validation_record" {
  description = "Add this CNAME in Squarespace DNS → Custom Records → Add Record"
  value = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      type  = dvo.resource_record_type
      name  = dvo.resource_record_name
      value = dvo.resource_record_value
    }
  }
}

output "alb_dns_name" {
  description = "After deploy, add CNAME in Squarespace: asr-api → this value"
  value       = module.alb.dns_name
}
```

---

#### Step 6 — ALB (manages its own security group)

```hcl
module "alb" {
  source  = "terraform-aws-modules/alb/aws"
  version = "~> 9.0"

  name    = "${var.project}-alb"
  vpc_id  = module.vpc.vpc_id
  subnets = module.vpc.public_subnets

  # ALB creates and manages its own SG (no separate SG module needed)
  security_group_ingress_rules = {
    all_http = {
      from_port   = 80
      to_port     = 80
      ip_protocol = "tcp"
      cidr_ipv4   = "0.0.0.0/0"
    }
    all_https = {
      from_port   = 443
      to_port     = 443
      ip_protocol = "tcp"
      cidr_ipv4   = "0.0.0.0/0"
    }
  }
  security_group_egress_rules = {
    all = {
      ip_protocol = "-1"
      cidr_ipv4   = module.vpc.vpc_cidr_block
    }
  }

  listeners = {
    http_redirect = {
      port     = 80
      protocol = "HTTP"
      redirect = {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
    https = {
      port            = 443
      protocol        = "HTTPS"
      ssl_policy      = "ELBSecurityPolicy-TLS13-1-2-Res-2021-06"
      certificate_arn = aws_acm_certificate.api.arn

      forward = {
        target_group_key = "ecs-api"
      }
    }
  }

  target_groups = {
    ecs-api = {
      protocol             = "HTTP"
      port                 = 8080
      target_type          = "ip"
      deregistration_delay = 30

      health_check = {
        enabled             = true
        path                = "/health"
        port                = "8080"
        protocol            = "HTTP"
        healthy_threshold   = 2
        unhealthy_threshold = 3
        interval            = 30
        timeout             = 5
        matcher             = "200"
      }
    }
  }
}
```

---

### Phase 3: Database + Storage

#### Step 7 — RDS PostgreSQL

```hcl
module "rds" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 6.0"

  identifier = "${var.project}-db"

  engine               = "postgres"
  engine_version       = "17"
  family               = "postgres17"
  major_engine_version = "17"
  instance_class       = "db.t4g.micro"
  allocated_storage    = 20
  max_allocated_storage = 100

  db_name  = "telephony"
  username = "telephony"
  port     = 5432

  manage_master_user_password = true   # Secrets Manager auto-manages password

  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [module.rds_sg.security_group_id]
  publicly_accessible    = false
  multi_az               = false       # Flip to true for HA ($30/mo → $60/mo)

  backup_retention_period = 7
  backup_window           = "02:00-03:00"       # 1hr gap before maintenance
  maintenance_window      = "Mon:04:00-Mon:05:00"

  storage_encrypted                   = true
  deletion_protection                 = true
  skip_final_snapshot                 = false
  final_snapshot_identifier_prefix    = "${var.project}-final"

  create_monitoring_role              = true
  monitoring_interval                 = 60
  monitoring_role_name                = "${var.project}-rds-monitoring"
  performance_insights_enabled        = true

  create_cloudwatch_log_group         = true
  enabled_cloudwatch_logs_exports     = ["postgresql"]
}
```

---

#### Step 8 — S3 Recordings Bucket

```hcl
module "s3_recordings" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.0"

  bucket = "${var.project}-recordings-${var.environment}"

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true

  versioning = { enabled = true }

  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        sse_algorithm = "AES256"
      }
    }
  }

  lifecycle_rule = [
    {
      id      = "recordings-lifecycle"
      enabled = true
      transition = [
        { days = 30, storage_class = "STANDARD_IA" },
        { days = 90, storage_class = "GLACIER" },
      ]
      noncurrent_version_expiration = { days = 90 }
    }
  ]

  cors_rule = [
    {
      allowed_headers = ["*"]
      allowed_methods = ["GET", "HEAD"]
      allowed_origins = ["https://${var.frontend_domain}"]
      max_age_seconds = 3600
    }
  ]
}
```

---

### Phase 4: Compute + Registry

#### Step 9 — ECR Repository

```hcl
resource "aws_ecr_repository" "api" {
  name                 = "${var.project}-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
```

---

#### Step 10 — ECS Fargate Service

```hcl
module "ecs" {
  source  = "terraform-aws-modules/ecs/aws"
  version = "~> 6.0"

  cluster_name = "${var.project}-cluster"

  # Container Insights — per-task CPU/memory/network metrics
  cluster_settings = [{
    name  = "containerInsights"
    value = "enabled"
  }]

  cluster_configuration = {
    execute_command_configuration = {
      logging = "OVERRIDE"
      log_configuration = {
        cloud_watch_log_group_name = "/aws/ecs/${var.project}"
      }
    }
  }

  # 100% Fargate — no Spot for real-time telephony API
  # (Spot can interrupt with 30s notice, unacceptable for active calls)
  cluster_capacity_providers = ["FARGATE"]
  default_capacity_provider_strategy = {
    FARGATE = {
      weight = 100
      base   = 2
    }
  }

  services = {
    telephony-api = {
      cpu    = 512
      memory = 1024

      enable_execute_command = true

      # Deployment safety — auto-rollback on failed deploys
      deployment_configuration = {
        minimum_healthy_percent = 100
        maximum_percent         = 200
        deployment_circuit_breaker = {
          enable   = true
          rollback = true
        }
      }

      container_definitions = {
        api = {
          cpu       = 512
          memory    = 1024
          essential = true
          image     = "${aws_ecr_repository.api.repository_url}:latest"

          portMappings = [{
            name          = "api"
            containerPort = 8080
            hostPort      = 8080
            protocol      = "tcp"
          }]

          healthCheck = {
            command     = ["CMD-SHELL", "wget -qO- http://localhost:8080/health || exit 1"]
            interval    = 30
            retries     = 3
            startPeriod = 60
            timeout     = 5
          }

          environment = [
            { name = "NODE_ENV",     value = "production" },
            { name = "PORT",         value = "8080" },
            { name = "S3_BUCKET",    value = module.s3_recordings.s3_bucket_id },
            { name = "S3_REGION",    value = var.region },
            { name = "FRONTEND_URL", value = "https://asr.annoteapp.com" },
          ]

          secrets = [
            { name = "DATABASE_URL",         valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:DATABASE_URL::" },
            { name = "LIVEKIT_URL",          valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:LIVEKIT_URL::" },
            { name = "LIVEKIT_API_KEY",      valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:LIVEKIT_API_KEY::" },
            { name = "LIVEKIT_API_SECRET",   valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:LIVEKIT_API_SECRET::" },
            { name = "LIVEKIT_SIP_TRUNK_ID", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:LIVEKIT_SIP_TRUNK_ID::" },
            { name = "S3_ACCESS_KEY",        valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:S3_ACCESS_KEY::" },
            { name = "S3_SECRET_KEY",        valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:S3_SECRET_KEY::" },
            { name = "DEEPGRAM_API_KEY",     valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:DEEPGRAM_API_KEY::" },
          ]

          readonlyRootFilesystem = false   # Needs writable /recordings cache

          linuxParameters = {
            capabilities = { drop = ["NET_RAW"] }
          }

          enable_cloudwatch_logging = true
        }
      }

      load_balancer = {
        service = {
          target_group_arn = module.alb.target_groups["ecs-api"].arn
          container_name   = "api"
          container_port   = 8080
        }
      }

      subnet_ids = module.vpc.private_subnets

      # ECS creates its own SG (no separate SG module needed)
      security_group_ingress_rules = {
        alb = {
          description                  = "From ALB on port 8080"
          from_port                    = 8080
          ip_protocol                  = "tcp"
          referenced_security_group_id = module.alb.security_group_id
        }
      }
      security_group_egress_rules = {
        all = {
          ip_protocol = "-1"
          cidr_ipv4   = "0.0.0.0/0"
        }
      }

      enable_autoscaling       = true
      autoscaling_min_capacity = 2
      autoscaling_max_capacity = 10

      autoscaling_policies = {
        cpu = {
          policy_type = "TargetTrackingScaling"
          target_tracking_scaling_policy_configuration = {
            predefined_metric_specification = {
              predefined_metric_type = "ECSServiceAverageCPUUtilization"
            }
            target_value       = 70
            scale_in_cooldown  = 300
            scale_out_cooldown = 60
          }
        }
      }

      # IAM — task role with S3 access (for recordings the app fetches directly)
      tasks_iam_role_statements = [
        {
          actions   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
          resources = [
            module.s3_recordings.s3_bucket_arn,
            "${module.s3_recordings.s3_bucket_arn}/*"
          ]
        }
      ]
    }
  }
}
```

---

#### Step 11 — Secrets Manager

```hcl
resource "aws_secretsmanager_secret" "app_secrets" {
  name = "${var.project}/${var.environment}/app-secrets"
}

# After first terraform apply, populate secrets:
# aws secretsmanager put-secret-value \
#   --secret-id telephony/prod/app-secrets \
#   --secret-string '{
#     "DATABASE_URL": "postgresql://telephony:<password>@<rds-endpoint>:5432/telephony",
#     "LIVEKIT_URL": "wss://your-app.livekit.cloud",
#     "LIVEKIT_API_KEY": "...",
#     "LIVEKIT_API_SECRET": "...",
#     "LIVEKIT_SIP_TRUNK_ID": "ST_...",
#     "S3_ACCESS_KEY": "...",
#     "S3_SECRET_KEY": "...",
#     "DEEPGRAM_API_KEY": "..."
#   }'
```

> Note: S3_ACCESS_KEY/SECRET_KEY are needed because LiveKit's egress service (which records calls) requires explicit S3 credentials — it can't use IAM roles since it runs on LiveKit Cloud, not in our VPC. For our own S3 access (downloads, transcription uploads), the ECS task IAM role handles auth automatically.

---

### Phase 5: CI/CD

#### Step 12 — GitHub OIDC + IAM Role

```hcl
# GitHub OIDC Provider — allows GitHub Actions to assume AWS roles without stored keys
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["ffffffffffffffffffffffffffffffffffffffff"]
}

resource "aws_iam_role" "github_actions" {
  name = "${var.project}-github-actions-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/main"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "ecr-ecs-deploy"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = "*"
      }
    ]
  })
}
```

---

#### Step 13 — GitHub Actions Workflow

```yaml
# .github/workflows/deploy-api.yml
name: Deploy API to ECS

on:
  push:
    branches: [main]
    paths: ['apps/api/**', 'packages/**', 'Dockerfile']

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/telephony-github-actions-deploy
          aws-region: ap-south-1

      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build \
            -t $ECR_REGISTRY/telephony-api:$IMAGE_TAG \
            -t $ECR_REGISTRY/telephony-api:latest .
          docker push $ECR_REGISTRY/telephony-api:$IMAGE_TAG
          docker push $ECR_REGISTRY/telephony-api:latest

      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster telephony-cluster \
            --service telephony-api \
            --force-new-deployment \
            --region ap-south-1

      - name: Wait for deployment
        run: |
          aws ecs wait services-stable \
            --cluster telephony-cluster \
            --services telephony-api \
            --region ap-south-1
```

---

### Phase 6: Monitoring

#### Step 14 — CloudWatch Alarms

```hcl
resource "aws_sns_topic" "alerts" {
  name = "${var.project}-alerts"
}

resource "aws_cloudwatch_metric_alarm" "ecs_cpu_high" {
  alarm_name          = "${var.project}-ecs-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions = {
    ClusterName = "${var.project}-cluster"
    ServiceName = "telephony-api"
  }
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.project}-alb-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions = {
    LoadBalancer = module.alb.arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_storage_low" {
  alarm_name          = "${var.project}-rds-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 2000000000
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = module.rds.db_instance_identifier
  }
}
```

---

## Variables

```hcl
# infra/environments/prod/variables.tf
variable "project"         { default = "telephony" }
variable "environment"     { default = "prod" }
variable "region"          { default = "ap-south-1" }
variable "domain_name"     { default = "annoteapp.com" }
variable "frontend_domain" { default = "asr.annoteapp.com" }
variable "github_repo"     { type = string }               # e.g. "yourorg/exploring-telephony"
```

```hcl
# infra/environments/prod/terraform.tfvars
github_repo     = "yourorg/exploring-telephony"  # Change to your actual repo
```

---

## Implementation Order

| Step | What | Time |
|------|------|------|
| 1 | Bootstrap (S3 + DynamoDB) | 5 min |
| 2 | Provider + versions + backend | 1 min |
| 3 | VPC + S3 VPC Endpoint | 3 min |
| 4 | RDS Security Group | 1 min |
| 5 | ACM Certificate (manual DNS validation in Squarespace) | 5 min |
| 6 | ALB | 3 min |
| 7 | RDS PostgreSQL | 10 min |
| 8 | S3 Bucket | 1 min |
| 9 | ECR Repository | 1 min |
| 10 | ECS Fargate | 5 min |
| 11 | Secrets Manager | 2 min |
| 12 | GitHub OIDC + IAM | 1 min |
| 13 | GitHub Actions workflow | Config |
| 14 | CloudWatch Alarms | 2 min |

Steps 2-14 run in one `terraform apply` after bootstrap (~30 min total).

---

## Cost Estimate (ap-south-1)

| Resource | Monthly Cost |
|----------|-------------|
| ECS Fargate (2 tasks, 0.5 vCPU, 1GB) | ~$30 |
| NAT Gateway (single AZ) | ~$35 |
| ALB | ~$20 |
| RDS db.t4g.micro (free tier yr 1) | ~$15 |
| S3 VPC Gateway Endpoint | **$0** |
| S3 recordings (< 10GB) | ~$1 |
| ECR (< 5GB) | ~$1 |
| Route53 | **$0** (not used — DNS on Squarespace) |
| CloudWatch | ~$5 |
| Secrets Manager (8 secrets) | ~$3 |
| **Total** | **~$111/mo** |

Free with AWS Activate startup credits ($25K-$100K).

---

## Review Fixes Applied

| # | Issue | Fix |
|---|-------|-----|
| 1 | No S3 VPC Endpoint (NAT cost leak) | Added `aws_vpc_endpoint` for S3 (free) |
| 2 | Duplicate security groups | Removed standalone ALB/ECS SGs, modules manage their own |
| 3 | No `default_tags` on provider | Added provider-level tags |
| 4 | GitHub OIDC role missing | Added OIDC provider + IAM role + deploy policy |
| 5 | No Container Insights | Added `containerInsights = "enabled"` |
| 6 | Fargate Spot for real-time API | Changed to 100% Fargate (no Spot) |
| 7 | No deployment circuit breaker | Added with auto-rollback |
| 8 | Missing `id: login-ecr` in GH Actions | Fixed |
| 9 | No `versions.tf` | Added with pinned versions |
| 10 | Backup/maintenance window overlap | Shifted backup to 02:00-03:00 |
| 11 | S3 keys note | Documented why they're needed (LiveKit egress) |
