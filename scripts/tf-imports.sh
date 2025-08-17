#!/usr/bin/env bash
set -euo pipefail

# Require running from debate-bro/tf
REQ_PARENT="debate-bro"
REQ_DIR="tf"
CUR_DIR="$(basename "$PWD")"
CUR_PARENT="$(basename "$(dirname "$PWD")")"

if [[ "$CUR_DIR" != "$REQ_DIR" || "$CUR_PARENT" != "$REQ_PARENT" ]]; then
  echo "❌ Please run this script from ${REQ_PARENT}/${REQ_DIR}. Current directory: $PWD" >&2
  exit 1
fi

# (optional) sanity check that Terraform files exist
for f in main.tf variables.tf; do
  [[ -f "$f" ]] || { echo "❌ Missing $f in $PWD"; exit 1; }
done

# --------- CONFIG (edit if your names change) ----------
ACCOUNT="802539608101"
REGION="us-east-2"

BUCKET="debate-bro-recordings-802539608101-dev"

LAMBDA_FN="debate-bro-transcribe"
LOG_GROUP="/aws/lambda/${LAMBDA_FN}"

ECR_REPO="discord-transcribe"

CLUSTER_NAME="discord-debate-bro"
SERVICE_NAME="discord-debate-bro"

VPC_ID="vpc-08fba34ffe898f8fb"
SG_NAME="discord-debate-bro-sg"

TRANSCRIBE_S3_POLICY_NAME="debate-bro-transcribe-s3"

# Resource addresses in your TF
RES_BUCKET="aws_s3_bucket.recordings"
RES_LAMBDA_FN="aws_lambda_function.transcription_lambda"
RES_LAMBDA_PERM_MAIN="aws_lambda_permission.allow_s3_invoke"                     # Sid: AllowS3Invoke
RES_LAMBDA_PERM_ALT="aws_lambda_permission.allow_s3_invoke_transcription"        # Sid: AllowS3InvokeTranscription (only if present in TF)
RES_LOG_GROUP="aws_cloudwatch_log_group.transcribe"
RES_ECR="aws_ecr_repository.transcribe_repo"
RES_IAM_LAMBDA_EXEC="aws_iam_role.lambda_exec"            # debate-bro-transcribe-lambda-exec
RES_IAM_BOT_TASK="aws_iam_role.bot_task_role"             # discord-debate-bro-task-role
RES_IAM_TRANSCRIBE="aws_iam_role.transcribe"              # debate-bro-transcribe-role
RES_SG="aws_security_group.bot_sg"
RES_ECS_SVC="aws_ecs_service.ecs_service"
RES_IAM_POLICY_TRANSCRIBE_S3="aws_iam_policy.transcribe_lambda_s3"

# --------- Helpers ----------
in_state() {
  local addr="$1"
  terraform state list 2>/dev/null | grep -qx "$addr"
}

has_resource_in_config() {
  # Quick check: does a resource block with this address appear in any .tf file?
  # (Not bulletproof, but avoids noisy import errors if the resource isn't defined.)
  local addr="$1"
  # addr looks like "aws_iam_role.lambda_exec"
  local type="${addr%%.*}"
  local name="${addr#*.}"
  grep -R "resource[[:space:]]*\"$type\"[[:space:]]*\"$name\"" ./*.tf >/dev/null 2>&1
}

import_if_needed() {
  local addr="$1"
  local id="$2"
  if ! has_resource_in_config "$addr"; then
    echo "⚠️  Skipping $addr — not found in current Terraform config."
    return 0
  fi
  if in_state "$addr"; then
    echo "✅ $addr already in state — skip."
  else
    echo "📦 Importing $addr -> $id"
    terraform import "$addr" "$id"
  fi
}

# --------- Preflight ----------
export AWS_REGION="${REGION}"
echo "Using AWS_REGION=${AWS_REGION}"
terraform init -input=false >/dev/null

# --------- Lookups ----------
# Find SG id by name + VPC
echo "🔎 Resolving Security Group id for ${SG_NAME} in ${VPC_ID}…"
SG_ID="$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [[ -z "${SG_ID}" || "${SG_ID}" == "None" ]]; then
  echo "⚠️  Could not resolve Security Group id for ${SG_NAME} in ${VPC_ID}. Will skip SG import."
fi

# --------- Imports ----------
import_if_needed "$RES_BUCKET"             "$BUCKET"
import_if_needed "$RES_ECR"                "$ECR_REPO"

import_if_needed "$RES_IAM_LAMBDA_EXEC"    "debate-bro-transcribe-lambda-exec"
import_if_needed "$RES_IAM_BOT_TASK"       "discord-debate-bro-task-role"
import_if_needed "$RES_IAM_TRANSCRIBE"     "debate-bro-transcribe-role"

import_if_needed "$RES_LOG_GROUP"          "$LOG_GROUP"
[[ -n "${SG_ID:-}" && "${SG_ID:-}" != "None" ]] && import_if_needed "$RES_SG" "$SG_ID" || true

import_if_needed "$RES_LAMBDA_FN"          "$LAMBDA_FN"

# Lambda Permissions (only attempt if address exists in your TF)
import_if_needed "$RES_LAMBDA_PERM_MAIN"   "${LAMBDA_FN}/AllowS3Invoke"
import_if_needed "$RES_LAMBDA_PERM_ALT"    "${LAMBDA_FN}/AllowS3InvokeTranscription"

# ECS Service (cluster-name/service-name)
import_if_needed "$RES_ECS_SVC"            "${CLUSTER_NAME}/${SERVICE_NAME}"

import_if_needed "$RES_IAM_POLICY_TRANSCRIBE_S3" \
  "arn:aws:iam::${ACCOUNT}:policy/${TRANSCRIBE_S3_POLICY_NAME}"

echo "🎉 Done. Current state:"
terraform state list || true