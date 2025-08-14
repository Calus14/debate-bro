resource "aws_iam_role" "ecs_task_execution_role" {
  name = "ecsTaskExecutionRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Action = "sts:AssumeRole",
      Effect = "Allow",
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_exec_ssm" {
  name = "ecs-exec-ssm"
  role = aws_iam_role.ecs_task_execution_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      { Effect = "Allow", Action = ["ssm:GetParameter","ssm:GetParameters"], Resource = "*" },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = "*" }
    ]
  })
}

# + Create a Task Role your app will assume inside the container
resource "aws_iam_role" "bot_task_role" {
  name = "${var.app_name}-task-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Action = "sts:AssumeRole",
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# + Allow writes to your recordings bucket
resource "aws_iam_role_policy" "bot_task_s3" {
  name = "discord-echo-bot-s3"
  role = aws_iam_role.bot_task_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.recordings.arn },
      { Effect = "Allow", Action = ["s3:PutObject","s3:PutObjectAcl"], Resource = "${aws_s3_bucket.recordings.arn}/*" }
    ]
  })
}