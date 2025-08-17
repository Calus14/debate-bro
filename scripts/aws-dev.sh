# scripts/aws-dev.sh
# Usage: source scripts/aws-dev.sh   (don't run it)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "This script defines aliases/functions. Run:  source scripts/aws-dev.sh"; exit 1
fi

# ---- project env ----
export REGION=us-east-2
export ACCOUNT_ID=802539608101
export CLUSTER=discord-debate-bro
export SERVICE=discord-debate-bro
export LAMBDA=debate-bro-transcribe
export BUCKET=debate-bro-recordings-802539608101-dev
export ECR_REPO=discord-debate-bro
export ECR_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO"

# ---- sanity ----
alias aws-whoami='aws sts get-caller-identity'
alias aws-region='echo ${AWS_REGION:-$REGION}'

# ---- ECR ----
alias ecr-login='aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com'
alias ecr-repos='aws ecr describe-repositories --region $REGION --query "repositories[].{name:repositoryName,uri:repositoryUri}" --output table'
alias ecr-images='aws ecr list-images --region $REGION --repository-name $ECR_REPO --query "imageIds[].imageTag" --output table'
ecr-push() { local TAG=${1:?tag}; docker tag $ECR_REPO:$TAG $ECR_URI:$TAG && docker push $ECR_URI:$TAG; }

# ---- ECS ----
alias ecs-svc='aws ecs describe-services --cluster $CLUSTER --services $SERVICE --region $REGION --query "services[0].{status:status,desired:desiredCount,running:runningCount,td:taskDefinition}" --output table'
alias ecs-deploy='aws ecs update-service --cluster $CLUSTER --service $SERVICE --region $REGION --force-new-deployment'
alias ecs-ps='aws ecs list-tasks --cluster $CLUSTER --service-name $SERVICE --region $REGION --desired-status RUNNING'
ecs-tasks() { aws ecs describe-tasks --cluster $CLUSTER --region $REGION --tasks "$@" --query "tasks[].{Last:lastStatus,Desired:desiredStatus,Stopped:stoppedReason,TaskArn:taskArn}" --output table; }
alias ecs-td='TD=$(aws ecs describe-services --cluster $CLUSTER --services $SERVICE --region $REGION --query "services[0].taskDefinition" --output text); aws ecs describe-task-definition --task-definition $TD --region $REGION --query "taskDefinition.containerDefinitions[0].{Name:name,Image:image,Env:environment,Logs:logConfiguration.options}"'

# ---- ECS logs (CloudWatch) ----
alias ecs-logs='aws logs tail /ecs/discord-debate-bro --region $REGION --follow --since 24h'

# ---- Lambda ----
alias lambda-get='aws lambda get-function-configuration --function-name $LAMBDA --region $REGION'
lambda-update() { local TAG=${1:?tag}; aws lambda update-function-code --function-name $LAMBDA --image-uri $ECR_URI:$TAG --region $REGION; }
alias lambda-logs='aws logs tail /aws/lambda/$LAMBDA --region $REGION --follow --since 1h'
alias lambda-limits='aws lambda get-account-settings --region $REGION --query "AccountLimit"'
lambda-invoke() { local KEY=${1:?s3-key}; aws lambda invoke --function-name $LAMBDA --region $REGION --payload "{\"Records\":[{\"s3\":{\"bucket\":{\"name\":\"$BUCKET\"},\"object\":{\"key\":\"$KEY\"}}}]}" out.json && cat out.json && rm out.json; }

# ---- S3 ----
alias s3-nc='aws s3api get-bucket-notification-configuration --bucket $BUCKET --region $REGION'
s3-ls-call() { local G=$1 C=$2 CALL=$3; aws s3 ls s3://$BUCKET/guild/$G/channel/$C/call/$CALL/ --recursive; }
s3-head() { local KEY=${1:?key}; aws s3api head-object --bucket $BUCKET --key "$KEY" --region $REGION; }
s3-presign() { local KEY=${1:?key}; aws s3 presign s3://$BUCKET/$KEY --expires-in 3600 --region $REGION; }
s3-put-meta() { local G=$1 C=$2 CALL=$3 PART=${4:-0001}; aws s3 cp part-$PART.metadata s3://$BUCKET/guild/$G/channel/$C/call/$CALL/part-$PART.metadata; }
s3-put-wav()  { local G=$1 C=$2 CALL=$3 PART=${4:-0001}; aws s3 cp part-$PART.wav      s3://$BUCKET/guild/$G/channel/$C/call/$CALL/part-$PART.wav; }

# ---- quick cheat sheet ----
cat <<'EOS'
Loaded AWS dev helpers:

ECR:  ecr-login | ecr-repos | ecr-images | ecr-push <tag>
ECS:  ecs-svc | ecs-deploy | ecs-ps | ecs-tasks <taskArns...> | ecs-td | ecs-logs
LMB:  lambda-get | lambda-update <tag> | lambda-logs | lambda-limits | lambda-invoke <s3 key>
S3:   s3-nc | s3-ls-call <g> <c> <call> | s3-head <key> | s3-presign <key> | s3-put-meta <g> <c> <call> [part] | s3-put-wav <g> <c> <call> [part]

Env:  REGION=$REGION  ACCOUNT_ID=$ACCOUNT_ID  CLUSTER=$CLUSTER  SERVICE=$SERVICE
      LAMBDA=$LAMBDA  BUCKET=$BUCKET  ECR_REPO=$ECR_REPO  ECR_URI=$ECR_URI
Tip:  source scripts/aws-dev.sh   (to reload in a new shell)
EOS

aws-cheat() {
  cat <<EOS
AWS dev helpers (project: debate-bro)

ENV:
  REGION=$REGION  ACCOUNT_ID=$ACCOUNT_ID
  CLUSTER=$CLUSTER  SERVICE=$SERVICE
  LAMBDA=$LAMBDA  BUCKET=$BUCKET
  ECR_REPO=$ECR_REPO  ECR_URI=$ECR_URI

ECR:  ecr-login | ecr-repos | ecr-images | ecr-push <tag>
ECS:  ecs-svc | ecs-deploy | ecs-ps | ecs-tasks <taskArns...> | ecs-td | ecs-logs
LMB:  lambda-get | lambda-update <tag> | lambda-logs | lambda-limits | lambda-invoke <s3 key>
S3:   s3-nc | s3-ls-call <g> <c> <call> | s3-head <key> | s3-presign <key> | s3-put-meta <g> <c> <call> [part] | s3-put-wav <g> <c> <call> [part]

Tip: source scripts/aws-dev.sh  (to reload in a new shell)
EOS
}