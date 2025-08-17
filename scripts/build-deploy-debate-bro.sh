#!/bin/bash
set -euo pipefail

# Config
REGION="us-east-2"
ACCOUNT_ID="802539608101"
REPO_NAME="discord-debate-bro"
CLUSTER_NAME="discord-debate-bro"
SERVICE_NAME="discord-debate-bro"
IMAGE_NAME="debate-bro"
TAG="latest"

ECR_URL="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:${TAG}"

echo "🚀 Building Docker image: ${IMAGE_NAME}:${TAG}"
docker build -t "${IMAGE_NAME}:${TAG}" .

echo "🔑 Logging in to Amazon ECR..."
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "🏷️ Tagging image for ECR: ${ECR_URL}"
docker tag "${IMAGE_NAME}:${TAG}" "${ECR_URL}"

echo "📤 Pushing image to ECR..."
docker push "${ECR_URL}"

echo "🔄 Forcing new ECS deployment..."
aws ecs update-service \
  --cluster "${CLUSTER_NAME}" \
  --service "${SERVICE_NAME}" \
  --force-new-deployment \
  --region "${REGION}"

echo "✅ Deployment triggered successfully!"