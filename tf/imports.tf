# ECR repo created previously
import {
  to = aws_ecr_repository.bot_repo
  id = "discord-debate-bro"
}

# CloudWatch log group created previously
import {
  to = aws_cloudwatch_log_group.bot_logs
  id = "/ecs/discord-debate-bro"
}

# IAM exec role created previously
import {
  to = aws_iam_role.ecs_task_execution_role
  id = "ecsTaskExecutionRole"
}