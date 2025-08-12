# Discord Voice Logger Bot Deployment

This project contains a Discord bot with audio recording functionality, along with Terraform scripts for deploying it on AWS ECS Fargate.

---

## 🛠️ Prerequisites

- **AWS CLI** — [Install & Configure](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
    - Run `aws configure` with an IAM user with `AdministratorAccess`

- **Terraform** — [Install Terraform](https://developer.hashicorp.com/terraform/downloads)
    - Recommended version `>= 1.3.0`

- **Docker** — [Install Docker](https://docs.docker.com/get-docker/)

---

## 🚀 Deployment Steps

1. **Initialize Terraform**
   ```
   cd tf/
   terraform init
   ```

2. **Deploy AWS Infrastructure**
   ```
   terraform apply
   ```
    - This will create:
        - ECR Repository
        - ECS Cluster
        - VPC, Subnet, Internet Gateway, Security Group
        - ECS Task Definition
        - CloudWatch Log Group
        - ECS Service

3. **Build & Push Docker Image**
   ```
   # Authenticate Docker to AWS ECR
   aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin <your-aws-account-id>.dkr.ecr.us-east-2.amazonaws.com

   # Build Docker Image
   docker build -t discord-bot .

   # Tag Docker Image for ECR
   docker tag discord-bot:latest <your-aws-account-id>.dkr.ecr.us-east-2.amazonaws.com/discord-echo-bot:latest

   # Push to ECR
   docker push <your-aws-account-id>.dkr.ecr.us-east-2.amazonaws.com/discord-echo-bot:latest
   ```

4. **(Optional) Redeploy ECS Service**
    - If you update the image tag, ECS can auto-pick it if using `latest`
    - Otherwise, update the task definition and run `terraform apply` again

5. **Monitor Logs**
    - Go to **CloudWatch → Log Groups → `/ecs/discord-echo-bot`**

---

## 📝 Notes

- Local testing can be done with `docker-compose.yml` using `.env.local`
- ECS Fargate keeps the bot running in a managed container
- CI/CD can be added using CodePipeline + ECR triggers later

---
