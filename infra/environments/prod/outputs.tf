# ─── VPC ─────────────────────────────────────────────────────────────

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "private_subnets" {
  description = "Private subnet IDs (ECS tasks)"
  value       = module.vpc.private_subnets
}

output "database_subnets" {
  description = "Database subnet IDs (RDS)"
  value       = module.vpc.database_subnets
}

# ─── ACM ─────────────────────────────────────────────────────────────

output "acm_validation_record" {
  description = "Add this CNAME in Squarespace DNS to validate the ACM certificate"
  value = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      type  = dvo.resource_record_type
      name  = dvo.resource_record_name
      value = dvo.resource_record_value
    }
  }
}

# ─── ALB ─────────────────────────────────────────────────────────────

output "alb_dns_name" {
  description = "Add CNAME in Squarespace: asr-api → this value"
  value       = module.alb.dns_name
}

output "alb_security_group_id" {
  description = "ALB security group ID (referenced by ECS ingress)"
  value       = module.alb.security_group_id
}

# ─── RDS ─────────────────────────────────────────────────────────────

output "rds_endpoint" {
  description = "RDS instance endpoint (host:port)"
  value       = module.rds.db_instance_endpoint
}

output "rds_master_secret_arn" {
  description = "Secrets Manager ARN for auto-managed master password"
  value       = module.rds.db_instance_master_user_secret_arn
}

# ─── S3 ──────────────────────────────────────────────────────────────

output "recordings_bucket_name" {
  description = "S3 bucket name for recordings"
  value       = module.s3_recordings.s3_bucket_id
}

output "recordings_bucket_arn" {
  description = "S3 bucket ARN for IAM policies"
  value       = module.s3_recordings.s3_bucket_arn
}

# ─── Redis ───────────────────────────────────────────────────────────

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint for REDIS_HOST env var"
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
}

# ─── ECR ─────────────────────────────────────────────────────────────

output "ecr_api_repository_url" {
  description = "ECR repository URL for API images"
  value       = aws_ecr_repository.api.repository_url
}

output "ecr_worker_repository_url" {
  description = "ECR repository URL for worker images"
  value       = aws_ecr_repository.worker.repository_url
}

# ─── ECS ─────────────────────────────────────────────────────────────

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "ecs_api_service_name" {
  description = "ECS API service name (for deploy workflow)"
  value       = "telephony-api"
}

output "ecs_worker_service_name" {
  description = "ECS worker service name (for deploy workflow)"
  value       = "background-worker"
}

# ─── GitHub OIDC ─────────────────────────────────────────────────────

output "github_actions_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC deploy"
  value       = aws_iam_role.github_actions.arn
}

# ─── Monitoring ──────────────────────────────────────────────────────

output "sns_alerts_topic_arn" {
  description = "SNS topic ARN — subscribe your email for alerts"
  value       = aws_sns_topic.alerts.arn
}
