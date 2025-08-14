# Debate Bro Discord Bot

This is a Discord bot that records voice channel sessions, uploads the output (WAV and JSON) to an S3 bucket, and is deployed using AWS ECS with Terraform infrastructure as code.

## Local Development

1. Clone the repository.
2. Set up `.env` file:
   ```env
   DISCORD_TOKEN=your-token-here
   S3_BUCKET_NAME=your-bucket-name
   AWS_REGION=us-east-2
   ```
3. Install dependencies and run:
   ```bash
   npm install
   node src/index.js
   ```

## Deployment with Terraform + AWS ECS

### Prerequisites

- AWS CLI configured (`aws configure`)
- Docker installed and running
- Terraform >= 1.3
- Logged into ECR (`aws ecr get-login-password`)

### Environment Variables

These values are injected into ECS tasks:

- `DISCORD_TOKEN` – pulled securely from AWS SSM.
- `S3_BUCKET_NAME` – passed from Terraform as environment variable.
- `AWS_REGION` – passed from Terraform.

### Terraform Deployment

From `tf/` directory:

```bash
terraform init
terraform plan -out=tfplan \
  -var="bucket_name=debate-bro-recordings-YOUR-ID-dev" \
  -var="aws_region=us-east-2" \
  -var="environment=dev"
terraform apply tfplan
```

> NOTE: Don’t commit `tfplan` or `terraform.tfstate` to Git.

### Docker Build + Push

```bash
# Rebuild and push latest image
docker build -t debate-bro .
aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin 802539608101.dkr.ecr.us-east-2.amazonaws.com/discord-debate-bro
docker tag debate-bro:latest 802539608101.dkr.ecr.us-east-2.amazonaws.com/discord-debate-bro:latest
docker push 802539608101.dkr.ecr.us-east-2.amazonaws.com/discord-debate-bro:latest
```

Trigger a new ECS deployment:
```bash
aws ecs update-service \
  --cluster discord-debate-bro \
  --service discord-debate-bro \
  --force-new-deployment \
  --region us-east-2
```

### Logs

```bash
ecsLogs() {
  aws logs tail /ecs/discord-debate-bro --follow --region us-east-2
}
```