# ─────────────────────────────────────────────────────────────────────
# VPC — 2 AZs, 3 subnet tiers, single NAT Gateway
# ─────────────────────────────────────────────────────────────────────

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.project}-${var.environment}"
  cidr = "10.0.0.0/16"

  azs              = ["${var.region}a", "${var.region}b"]
  public_subnets   = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnets  = ["10.0.11.0/24", "10.0.12.0/24"]
  database_subnets = ["10.0.21.0/24", "10.0.22.0/24"]

  # Single NAT Gateway — $35/mo (vs $70 for one-per-AZ)
  enable_nat_gateway = true
  single_nat_gateway = true

  # DNS — required for RDS endpoint resolution and ECS service discovery
  enable_dns_hostnames = true
  enable_dns_support   = true

  # Auto-create DB subnet group for RDS
  create_database_subnet_group       = true
  create_database_subnet_route_table = true

  # Lock down default VPC resources (security best practice)
  manage_default_security_group = true
  manage_default_route_table    = true
  manage_default_network_acl    = true
}

# ─────────────────────────────────────────────────────────────────────
# S3 VPC Gateway Endpoint — FREE, bypasses NAT for all S3 traffic
# Without this, every recording upload/download costs $0.045/GB via NAT
# ─────────────────────────────────────────────────────────────────────

resource "aws_vpc_endpoint" "s3" {
  vpc_id       = module.vpc.vpc_id
  service_name = "com.amazonaws.${var.region}.s3"

  route_table_ids = concat(
    module.vpc.private_route_table_ids,
    module.vpc.database_route_table_ids
  )
}

# ─────────────────────────────────────────────────────────────────────
# ECS Security Groups — standalone to avoid circular deps
# (RDS SG and Redis SG reference these, and ECS references Redis/RDS)
# ─────────────────────────────────────────────────────────────────────

resource "aws_security_group" "ecs_api" {
  name        = "${var.project}-ecs-api"
  vpc_id      = module.vpc.vpc_id
  description = "ECS API service"

  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [module.alb.security_group_id]
    description     = "From ALB on port 8080"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }
}

resource "aws_security_group" "ecs_worker" {
  name        = "${var.project}-ecs-worker"
  vpc_id      = module.vpc.vpc_id
  description = "ECS background worker service"

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }
}

# ─────────────────────────────────────────────────────────────────────
# ACM Certificate — asr-api.annoteapp.com
# DNS validation done manually in Squarespace (no Route53)
# ─────────────────────────────────────────────────────────────────────

resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Blocks until the CNAME is added in Squarespace DNS and ACM validates
resource "aws_acm_certificate_validation" "api" {
  certificate_arn = aws_acm_certificate.api.arn
}

# ─────────────────────────────────────────────────────────────────────
# ALB — public-facing, terminates SSL, forwards to ECS on port 8080
# Module manages its own security group (no standalone SG needed)
# ─────────────────────────────────────────────────────────────────────

module "alb" {
  source  = "terraform-aws-modules/alb/aws"
  version = "~> 9.0"

  name    = "${var.project}-alb"
  vpc_id  = module.vpc.vpc_id
  subnets = module.vpc.public_subnets

  # Security group — managed by the module
  security_group_ingress_rules = {
    all_http = {
      from_port   = 80
      to_port     = 80
      ip_protocol = "tcp"
      cidr_ipv4   = "0.0.0.0/0"
      description = "HTTP (redirects to HTTPS)"
    }
    all_https = {
      from_port   = 443
      to_port     = 443
      ip_protocol = "tcp"
      cidr_ipv4   = "0.0.0.0/0"
      description = "HTTPS"
    }
  }

  security_group_egress_rules = {
    all = {
      ip_protocol = "-1"
      cidr_ipv4   = module.vpc.vpc_cidr_block
      description = "To VPC"
    }
  }

  # Listeners
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

  # Target group — ECS tasks register as IP targets
  target_groups = {
    ecs-api = {
      protocol             = "HTTP"
      port                 = 8080
      target_type          = "ip"
      deregistration_delay = 30
      create_attachment    = false

      health_check = {
        enabled             = true
        path                = "/health"
        port                = "traffic-port"
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

# ─────────────────────────────────────────────────────────────────────
# RDS Security Group — PostgreSQL from ECS only
# Standalone SG because RDS module doesn't manage its own
# ─────────────────────────────────────────────────────────────────────

module "rds_sg" {
  source  = "terraform-aws-modules/security-group/aws"
  version = "~> 5.0"

  name        = "${var.project}-rds"
  vpc_id      = module.vpc.vpc_id
  description = "RDS - PostgreSQL from ECS only"

  ingress_with_source_security_group_id = [
    {
      rule                     = "postgresql-tcp"
      source_security_group_id = aws_security_group.ecs_api.id
      description              = "PostgreSQL from API tasks"
    },
    {
      rule                     = "postgresql-tcp"
      source_security_group_id = aws_security_group.ecs_worker.id
      description              = "PostgreSQL from worker tasks"
    },
  ]
}

# ─────────────────────────────────────────────────────────────────────
# RDS PostgreSQL 17 — encrypted, backed up, Performance Insights
# ─────────────────────────────────────────────────────────────────────

module "rds" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 6.0"

  identifier = "${var.project}-db"

  engine                = "postgres"
  engine_version        = "17"
  family                = "postgres17"
  major_engine_version  = "17"
  instance_class        = "db.t4g.micro"
  allocated_storage     = 20
  max_allocated_storage = 100

  db_name  = "telephony"
  username = "telephony"
  port     = 5432

  # Secrets Manager auto-manages the master password
  manage_master_user_password = true

  # Networking
  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [module.rds_sg.security_group_id]
  publicly_accessible    = false
  multi_az               = false

  # Backups — 1hr gap before maintenance window
  backup_retention_period = 7
  backup_window           = "02:00-03:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  # Encryption + protection
  storage_encrypted                = true
  deletion_protection              = true
  skip_final_snapshot              = false
  final_snapshot_identifier_prefix = "${var.project}-final"

  # Monitoring
  create_monitoring_role                = true
  monitoring_interval                   = 60
  monitoring_role_name                  = "${var.project}-rds-monitoring"
  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  # Logs
  create_cloudwatch_log_group     = true
  enabled_cloudwatch_logs_exports = ["postgresql"]
}

# ─────────────────────────────────────────────────────────────────────
# S3 — recordings bucket with lifecycle, versioning, CORS
# ─────────────────────────────────────────────────────────────────────

module "s3_recordings" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.0"

  bucket = "${var.project}-recordings-${var.environment}-475568920420"

  # Block ACL-based public access, but allow bucket policies (for captures/ public-read)
  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false

  versioning = {
    status = true
  }

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

      noncurrent_version_expiration = {
        days = 90
      }
    },
    {
      id      = "abort-incomplete-uploads"
      enabled = true

      abort_incomplete_multipart_upload_days = 7
    },
  ]

  cors_rule = [
    {
      allowed_headers = ["*"]
      allowed_methods = ["GET", "HEAD"]
      allowed_origins = ["https://${var.frontend_domain}"]
      expose_headers  = ["ETag", "Content-Length"]
      max_age_seconds = 3600
    },
  ]

  # Public-read for processed outputs (captures/); raw egress (recordings/) stays private
  attach_policy = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadCaptures"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "arn:aws:s3:::${var.project}-recordings-${var.environment}-475568920420/captures/*"
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────
# ElastiCache Redis — BullMQ job queue + future rate limiting
# ─────────────────────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.project}-redis"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "redis" {
  name        = "${var.project}-redis"
  vpc_id      = module.vpc.vpc_id
  description = "Redis - from ECS tasks only"

  ingress {
    from_port = 6379
    to_port   = 6379
    protocol  = "tcp"
    security_groups = [
      aws_security_group.ecs_api.id,
      aws_security_group.ecs_worker.id,
    ]
    description = "Redis from ECS"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id         = "${var.project}-redis"
  engine             = "redis"
  engine_version     = "7.1"
  node_type          = "cache.t4g.micro"
  num_cache_nodes    = 1
  port               = 6379
  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  snapshot_retention_limit = 1
  maintenance_window       = "Mon:05:00-Mon:06:00"

  # Encryption at rest is enabled by default for Redis 7.1+
  # Transit encryption requires aws_elasticache_replication_group
  # For single-node BullMQ, engine-level encryption suffices
}

# ─────────────────────────────────────────────────────────────────────
# ECR — container registries for API and worker images
# ─────────────────────────────────────────────────────────────────────

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

resource "aws_ecr_repository" "worker" {
  name                 = "${var.project}-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "worker" {
  repository = aws_ecr_repository.worker.name

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

# ─────────────────────────────────────────────────────────────────────
# Secrets Manager — app secrets (populated manually after first apply)
# ─────────────────────────────────────────────────────────────────────
# After terraform apply, populate with:
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
#     "GEMINI_API_KEY": "..."
#   }'

resource "aws_secretsmanager_secret" "app_secrets" {
  name = "${var.project}/${var.environment}/app-secrets"
}

# ─────────────────────────────────────────────────────────────────────
# ECS Fargate Cluster — Container Insights enabled
# ─────────────────────────────────────────────────────────────────────

module "ecs" {
  source  = "terraform-aws-modules/ecs/aws"
  version = "~> 6.0"

  cluster_name = "${var.project}-cluster"

  # Container Insights enabled by default in module v6.12+

  cluster_configuration = {
    execute_command_configuration = {
      logging = "OVERRIDE"
      log_configuration = {
        cloud_watch_log_group_name = "/aws/ecs/${var.project}"
      }
    }
  }

  # 100% Fargate — no Spot for real-time telephony
  # FARGATE is available by default; just set the strategy
  default_capacity_provider_strategy = {
    FARGATE = {
      weight = 100
      base   = 2
    }
  }

  # ─── API Service ────────────────────────────────────────────────────

  services = {
    telephony-api = {
      cpu    = 512
      memory = 1024

      enable_execute_command = true

      deployment_circuit_breaker = {
        enable   = true
        rollback = true
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
            { name = "NODE_ENV", value = "production" },
            { name = "PORT", value = "8080" },
            { name = "S3_BUCKET", value = module.s3_recordings.s3_bucket_id },
            { name = "S3_REGION", value = var.region },
            { name = "FRONTEND_URL", value = "https://${var.frontend_domain}" },
            { name = "REDIS_HOST", value = aws_elasticache_cluster.redis.cache_nodes[0].address },
            { name = "REDIS_PORT", value = "6379" },
          ]

          secrets = [
            { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:DATABASE_URL::" },
            { name = "LIVEKIT_URL", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:LIVEKIT_URL::" },
            { name = "LIVEKIT_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:LIVEKIT_API_KEY::" },
            { name = "LIVEKIT_API_SECRET", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:LIVEKIT_API_SECRET::" },
            { name = "LIVEKIT_SIP_TRUNK_ID", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:LIVEKIT_SIP_TRUNK_ID::" },
            { name = "S3_ACCESS_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:S3_ACCESS_KEY::" },
            { name = "S3_SECRET_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:S3_SECRET_KEY::" },
            { name = "GEMINI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:GEMINI_API_KEY::" },
          ]

          readonlyRootFilesystem = false

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

      # Use standalone SG to break circular dep with Redis/RDS
      create_security_group = false
      security_group_ids    = [aws_security_group.ecs_api.id]

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

      # Execution role — ECS uses this to pull images + inject secrets
      task_exec_secret_arns = [aws_secretsmanager_secret.app_secrets.arn]

      # Task role — the running container assumes this for S3 access
      tasks_iam_role_statements = [
        {
          actions = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
          resources = [
            module.s3_recordings.s3_bucket_arn,
            "${module.s3_recordings.s3_bucket_arn}/*",
          ]
        },
      ]
    }

    # ─── Worker Service ─────────────────────────────────────────────────

    background-worker = {
      cpu    = 1024
      memory = 2048

      enable_execute_command = true

      deployment_circuit_breaker = {
        enable   = true
        rollback = true
      }

      container_definitions = {
        worker = {
          cpu       = 1024
          memory    = 2048
          essential = true
          image     = "${aws_ecr_repository.worker.repository_url}:latest"

          environment = [
            { name = "NODE_ENV", value = "production" },
            { name = "REDIS_HOST", value = aws_elasticache_cluster.redis.cache_nodes[0].address },
            { name = "REDIS_PORT", value = "6379" },
            { name = "S3_BUCKET", value = module.s3_recordings.s3_bucket_id },
            { name = "S3_REGION", value = var.region },
          ]

          secrets = [
            { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:DATABASE_URL::" },
            { name = "GEMINI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:GEMINI_API_KEY::" },
            { name = "S3_ACCESS_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:S3_ACCESS_KEY::" },
            { name = "S3_SECRET_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:S3_SECRET_KEY::" },
          ]

          readonlyRootFilesystem = false

          enable_cloudwatch_logging = true
        }
      }

      # No ALB — worker has no inbound HTTP traffic
      subnet_ids = module.vpc.private_subnets

      # Use standalone SG to break circular dep with Redis/RDS
      create_security_group = false
      security_group_ids    = [aws_security_group.ecs_worker.id]

      enable_autoscaling       = true
      autoscaling_min_capacity = 1
      autoscaling_max_capacity = 3

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

      # Execution role — ECS uses this to pull images + inject secrets
      task_exec_secret_arns = [aws_secretsmanager_secret.app_secrets.arn]

      # Task role — the running container assumes this for S3 access
      tasks_iam_role_statements = [
        {
          actions = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
          resources = [
            module.s3_recordings.s3_bucket_arn,
            "${module.s3_recordings.s3_bucket_arn}/*",
          ]
        },
      ]
    }
  }
}

# ─────────────────────────────────────────────────────────────────────
# GitHub OIDC — allows GitHub Actions to assume AWS roles (no keys)
# ─────────────────────────────────────────────────────────────────────

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
        Sid      = "ECRAuth"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "ECRPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        Resource = [
          aws_ecr_repository.api.arn,
          aws_ecr_repository.worker.arn,
        ]
      },
      {
        Sid      = "ECSUpdate"
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = "*"
        Condition = {
          ArnEquals = {
            "ecs:cluster" = module.ecs.cluster_arn
          }
        }
      },
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────
# CloudWatch Alarms + SNS — operational alerts
# ─────────────────────────────────────────────────────────────────────

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
  alarm_description   = "ECS API CPU > 80% for 10 minutes"

  dimensions = {
    ClusterName = module.ecs.cluster_name
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
  alarm_description   = "ALB target 5XX count > 10 in 5 minutes"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = module.alb.arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${var.project}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_sns_topic.alerts.arn]
  alarm_description   = "RDS CPU > 80% for 10 minutes"

  dimensions = {
    DBInstanceIdentifier = module.rds.db_instance_identifier
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
  alarm_description   = "RDS free storage < 2GB"

  dimensions = {
    DBInstanceIdentifier = module.rds.db_instance_identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "redis_cpu_high" {
  alarm_name          = "${var.project}-redis-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_sns_topic.alerts.arn]
  alarm_description   = "Redis CPU > 80% for 10 minutes"

  dimensions = {
    CacheClusterId = aws_elasticache_cluster.redis.cluster_id
  }
}
