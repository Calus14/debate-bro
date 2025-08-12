terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Configure the AWS provider. The region is taken from the variable aws_region.
provider "aws" {
  region = var.aws_region
}

# Create a private S3 bucket to store recordings and metadata.
resource "aws_s3_bucket" "recordings" {
  bucket = var.bucket_name
  acl    = "private"

  tags = {
    Name        = "discord-voice-logger-recordings"
    Environment = var.environment
  }
}

# Export the bucket name after creation.
output "bucket_name" {
  description = "Name of the bucket created for storing recordings."
  value       = aws_s3_bucket.recordings.id
}
