# Remote state stored in S3, locked via DynamoDB.
# The bucket is created by bootstrap/ — run that first.
# Replace ACCOUNT_ID with your actual AWS account ID.

terraform {
  backend "s3" {
    bucket         = "telephony-terraform-state-ACCOUNT_ID"
    key            = "prod/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "telephony-terraform-locks"
    encrypt        = true
  }
}
