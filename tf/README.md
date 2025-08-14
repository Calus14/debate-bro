# Terraform Infrastructure for Debate Bro Bot

This directory contains the infrastructure configuration for deploying the Debate Bro Discord bot to AWS ECS using Fargate.

## Prerequisites

- Terraform >= 1.3
- AWS CLI configured
- AWS account with proper IAM permissions

## Required Variables

Pass these in during plan/apply:

```hcl
variable "bucket_name" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "environment" {
  type = string
}
```

## Usage

### Initialize

```bash
terraform init
```

### Plan

```bash
terraform plan -out=tfplan \
  -var="bucket_name=debate-bro-recordings-802539608101-dev" \
  -var="aws_region=us-east-2" \
  -var="environment=dev"
```

### Apply

```bash
terraform apply tfplan
```

## Outputs

- `bucket_name` – Name of the created S3 bucket
- `ecs_cluster_name`, `ecs_service_name`
- `bot_sg_id` – Security group used
- `task_definition_arn` – ECS task definition

## Notes

- The Discord token is stored securely in SSM and injected via ECS task definition.
- The S3 bucket name is passed via environment variables.

Do NOT commit:
- `tfplan`
- `terraform.tfstate`
- `.terraform/`