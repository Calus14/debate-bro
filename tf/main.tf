#############################################
# Root config only (no resources in here)   #
#############################################

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  # Nice-to-have: default tags applied to all AWS resources
  default_tags {
    tags = {
      Environment = var.environment
      Project     = "debate-bro"
    }
  }
}
