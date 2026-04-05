variable "project" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "telephony"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-south-1"
}

variable "domain_name" {
  description = "Root domain (DNS managed in Squarespace, not Route53)"
  type        = string
  default     = "annoteapp.com"
}

variable "api_domain" {
  description = "Subdomain for the API (CNAME in Squarespace → ALB)"
  type        = string
  default     = "asr-api.annoteapp.com"
}

variable "frontend_domain" {
  description = "Subdomain for the frontend (CNAME in Squarespace → Vercel)"
  type        = string
  default     = "asr.annoteapp.com"
}

variable "github_repo" {
  description = "GitHub repository in owner/repo format for OIDC trust"
  type        = string
}
