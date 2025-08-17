#!/bin/bash
set -euo pipefail

ACCOUNT_ID=802539608101
REGION=us-east-2
REPO=discord-transcribe
TAG=latest
LAMBDA_NAME=debate-bro-transcribe

URI=$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG

echo "🔑 Logging in to Amazon ECR..."
aws ecr get-login-password --region $REGION \
  | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

echo "🚀 Building Docker image for Lambda..."
# If you're on Apple Silicon, keep --platform=linux/amd64
docker build --platform=linux/amd64 -t $REPO:$TAG .

echo "🏷️ Tagging image as $URI"
docker tag $REPO:$TAG $URI

echo "📤 Pushing image to ECR..."
docker push $URI

echo "🔎 Fetching image digest..."
DIGEST=$(aws ecr describe-images \
  --region $REGION \
  --repository-name $REPO \
  --image-ids imageTag=$TAG \
  --query 'imageDetails[0].imageDigest' \
  --output text)

ECR_BASE="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO"

echo "🔄 Updating Lambda function $LAMBDA_NAME to new image..."
aws lambda update-function-code \
  --function-name $LAMBDA_NAME \
  --image-uri "${ECR_BASE}:latest" \
  --publish \
  --region $REGION

echo "✅ Lambda $LAMBDA_NAME updated successfully!"