ACCOUNT_ID=802539608101
REGION=us-east-2
REPO=discord-debate-bro            # reuse this
TAG=transcribe-v1                   # clear tag for the lambda image
URI=$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG

aws ecr get-login-password --region $REGION \
| docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

# If you're on Apple Silicon, keep --platform=linux/amd64
docker build --platform=linux/amd64 -t $REPO:$TAG .
docker tag  $REPO:$TAG $URI
docker push $URI